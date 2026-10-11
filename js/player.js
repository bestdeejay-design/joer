/**
 * JOER — аудиодвижок (T-03).
 *
 * Один <audio>, понятные состояния, реконнект с backoff, Media Session.
 * Никакого Web Audio в основном тракте: звук не должен ломаться никогда
 * (опциональная реактивность подключается отдельно — см. js/audio-reactivity.js).
 *
 * События (EventTarget):
 *   "change"    — любой срез состояния: { state, station, volume, muted, attempt, message }
 *   "exhausted" — попытки реконнекта исчерпаны: { station, suggestion }
 */

import { prefs } from "./storage.js";

export const STATE = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  PLAYING: "playing",
  PAUSED: "paused",
  ERROR: "error",
});

/** Backoff реконнекта: 1s → 2s → 4s (docs/ARCHITECTURE.md). */
export const RECONNECT_DELAYS = [1000, 2000, 4000];
/** Сколько ждём звук в состоянии "waiting", прежде чем считать поток зависшим. */
export const STALL_TIMEOUT_MS = 12000;

export class Player extends EventTarget {
  constructor({
    createAudio,
    storage = prefs,
    suggestNext = () => null,
    reconnectDelays = RECONNECT_DELAYS,
    stallTimeout = STALL_TIMEOUT_MS,
    autoAdvance = true,
    maxAutoAdvances = 4,
  } = {}) {
    super();
    this.createAudio = createAudio || (() => new Audio());
    this.storage = storage;
    this.suggestNext = suggestNext;
    this.reconnectDelays = reconnectDelays;
    this.stallTimeout = stallTimeout;
    this.autoAdvance = autoAdvance;
    this.maxAutoAdvances = maxAutoAdvances;

    this.state = STATE.IDLE;
    this.station = null;
    this.attempt = 0;
    this.autoAdvances = 0;
    this.message = "";

    this.volume = storage.volume;
    this.muted = storage.muted;

    this.audio = null;
    this.reconnectTimer = null;
    this.stallTimer = null;
    this.intentionalPause = false;
    this.urlCandidates = [];
    this.urlIndex = 0;
    this.listenersBound = false;
  }

  /* --------------------------------------------------------------
     Публичный API
     -------------------------------------------------------------- */

  /** Запустить станцию. Повторный вызов для играющей станции — no-op (idempotent). */
  async play(station) {
    if (station && station.id === this.station?.id) {
      if (this.state === STATE.PLAYING || this.state === STATE.LOADING) return;
      return this.resume();
    }

    if (station) {
      // Явный выбор пользователем — сбрасываем счётчик авто-переходов.
      this.station = station;
      this.attempt = 0;
      this.autoAdvances = 0;
      this.urlCandidates = Player.hostVariants(station.url);
      this.urlIndex = 0;
      this.storage.lastStation = station.id;
      this.dispatchEvent(new CustomEvent("stationchange", { detail: { station } }));
    }

    if (!this.station) return;

    this.clearTimers();
    this.intentionalPause = false;
    this.setState(STATE.LOADING, "Подключаемся к потоку…");

    try {
      await this.start();
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /** Продолжить текущую станцию (после паузы или ошибки). */
  async resume() {
    if (!this.station) return;
    this.clearTimers();
    this.intentionalPause = false;
    this.setState(STATE.LOADING, "Подключаемся к потоку…");
    try {
      await this.start();
    } catch (error) {
      this.handleFailure(error);
    }
  }

  pause() {
    if (!this.audio) return;
    this.intentionalPause = true;
    this.clearTimers();
    try {
      this.audio.pause();
    } catch {
      /* элемент мог быть уничтожен */
    }
    this.setState(STATE.PAUSED, "Пауза");
  }

  /** Универсальный переключатель: play ↔ pause. */
  async toggle(station) {
    const target = station ?? this.station;
    if (this.state === STATE.PLAYING || this.state === STATE.LOADING) {
      this.pause();
      return;
    }
    await this.play(target);
  }

  stop() {
    this.clearTimers();
    this.intentionalPause = true;
    try {
      this.audio?.pause();
      if (this.audio) this.audio.removeAttribute("src");
      this.audio?.load?.();
    } catch {
      /* ignore */
    }
    this.setState(STATE.IDLE, "");
  }

  setVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value)));
    if (!Number.isFinite(next)) return;
    this.volume = next;
    this.storage.volume = next;
    if (this.audio) this.audio.volume = next;
    if (next > 0 && this.muted) this.setMuted(false);
    this.emit();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.storage.muted = this.muted;
    if (this.audio) this.audio.muted = this.muted;
    this.emit();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  /**
   * Пересоздать <audio> без Web Audio-графа.
   * Аварийный выход из аудио-реактивности: звук важнее визуальных эффектов.
   */
  async recreateAudio() {
    const wasActive = this.state === STATE.PLAYING || this.state === STATE.LOADING;
    this.detachAudio();
    if (wasActive && this.station) return this.resume();
    return undefined;
  }

  destroy() {
    this.clearTimers();
    this.detachAudio();
  }

  /* --------------------------------------------------------------
     Внутренности
     -------------------------------------------------------------- */

  ensureAudio() {
    if (this.audio) return this.audio;
    const audio = this.createAudio();
    audio.preload = "none";
    audio.volume = this.volume;
    audio.muted = this.muted;
    this.bindAudio(audio);
    this.audio = audio;
    return audio;
  }

  detachAudio() {
    if (!this.audio) return;
    for (const [type, handler] of this.audioHandlers ?? []) {
      this.audio.removeEventListener(type, handler);
    }
    this.audio = null;
    this.audioHandlers = null;
  }

  bindAudio(audio) {
    const on = (type, handler) => {
      audio.addEventListener(type, handler);
      (this.audioHandlers ??= []).push([type, handler]);
    };

    on("playing", () => {
      this.clearTimers();
      this.attempt = 0;
      this.intentionalPause = false;
      this.updateMediaSession();
      this.setState(STATE.PLAYING, "");
    });

    on("play", () => {
      if (this.state !== STATE.PLAYING) this.setState(STATE.LOADING, "Буферизация…");
    });

    on("waiting", () => {
      this.setState(STATE.LOADING, "Буферизация…");
      this.armStallWatchdog();
    });

    on("pause", () => {
      if (this.intentionalPause || this.state === STATE.IDLE) return;
      this.setState(STATE.PAUSED, "Пауза");
    });

    on("stalled", () => {
      this.armStallWatchdog();
    });

    on("ended", () => {
      // Живой поток не должен «заканчиваться» — трактуем как обрыв.
      if (!this.intentionalPause) this.handleFailure(new Error("stream ended"));
    });

    on("error", () => {
      if (this.intentionalPause || !this.station) return;
      const mediaError = audio.error;
      this.handleFailure(new Error(`media error ${mediaError?.code ?? "unknown"}`));
    });

    on("volumechange", () => {
      if (typeof audio.volume === "number") this.volume = audio.volume;
      this.muted = Boolean(audio.muted);
    });
  }

  /** Старт потока. Бросает исключение, если не получилось. */
  start() {
    const audio = this.ensureAudio();
    const candidates = this.urlCandidates.length ? this.urlCandidates : [this.station.url];
    let url = candidates[this.urlIndex % candidates.length];
    // Одно зеркало (не SomaFM) — на ретраях добавляем cache-bust.
    if (candidates.length === 1 && this.attempt > 0) url = this.cacheBust(url);
    audio.src = url;
    audio.volume = this.volume;
    audio.muted = this.muted;
    audio.load?.();
    const result = audio.play?.();
    return result && typeof result.then === "function" ? result : Promise.resolve();
  }

  cacheBust(url) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set("_joer", String(Date.now()));
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /** Зеркала потока: у SomaFM несколько ice-хостов — при сбое пробуем другие. */
  static hostVariants(url) {
    const match = String(url).match(/^(https:\/\/)(ice\d+)(\.somafm\.com\/.*)$/i);
    if (!match) return [url];
    const alternates = ["ice1", "ice2", "ice4", "ice6"].filter((host) => host !== match[2].toLowerCase());
    return [url, ...alternates.map((host) => match[1] + host + match[3])];
  }

  handleFailure(error) {
    if (error?.name === "AbortError") return; // пауза во время загрузки — это нормально
    if (error?.name === "NotAllowedError") {
      this.setState(STATE.PAUSED, "Браузер ждёт вашего жеста — нажмите «Играть»");
      return;
    }

    if (this.attempt >= this.reconnectDelays.length) {
      const failed = this.station;
      const suggestion = this.suggestNext(failed);

      // Фолбэк: если поток мёртв, сами переходим на следующую станцию группы.
      if (
        this.autoAdvance &&
        suggestion &&
        suggestion.id !== failed?.id &&
        this.autoAdvances < this.maxAutoAdvances
      ) {
        this.autoAdvances += 1;
        this.station = suggestion;
        this.attempt = 0;
        this.urlCandidates = Player.hostVariants(suggestion.url);
        this.urlIndex = 0;
        this.storage.lastStation = suggestion.id;
        this.setState(
          STATE.LOADING,
          `«${failed?.name ?? "Поток"}» молчит — включаю «${suggestion.name}» (${this.autoAdvances}/${this.maxAutoAdvances})…`,
        );
        this.dispatchEvent(new CustomEvent("stationchange", { detail: { station: suggestion, auto: true } }));
        this.start().catch((retryError) => this.handleFailure(retryError));
        return;
      }

      this.setState(STATE.ERROR, "Потоки в этой группе не отвечают", { exhausted: true, suggestion });
      this.dispatchEvent(new CustomEvent("exhausted", { detail: { station: failed, suggestion, autoAdvances: this.autoAdvances } }));
      return;
    }

    const delay = this.reconnectDelays[this.attempt];
    this.attempt += 1;
    this.urlIndex += 1; // следующий ретрай — на другом зеркале/с cache-bust
    this.setState(STATE.LOADING, `Переподключение ${this.attempt}/${this.reconnectDelays.length}…`, { retryIn: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.resume();
    }, delay);
  }

  armStallWatchdog() {
    if (this.stallTimer) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (this.state !== STATE.PLAYING && !this.intentionalPause) {
        this.handleFailure(new Error("stream stalled"));
      }
    }, this.stallTimeout);
  }

  clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.reconnectTimer = null;
    this.stallTimer = null;
  }

  setState(state, message = "", extra = {}) {
    this.state = state;
    this.message = message;
    this.emit(extra);
  }

  emit(extra = {}) {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: {
          state: this.state,
          station: this.station,
          volume: this.volume,
          muted: this.muted,
          attempt: this.attempt,
          attempts: this.reconnectDelays.length,
          message: this.message,
          ...extra,
        },
      }),
    );
  }

  /* --------------------------------------------------------------
     Media Session — лок-скрин и медиа-клавиши
     -------------------------------------------------------------- */

  updateMediaSession() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      const station = this.station;
      if (!station) return;
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: station.name,
          artist: station.provider,
          album: `JOER · ${station.genres?.slice(0, 3).join(", ") || "интернет-радио"}`,
          artwork: this.artwork ?? [],
        });
      }
      navigator.mediaSession.playbackState = this.state === STATE.PLAYING ? "playing" : "paused";
    } catch {
      /* Media Session — опциональный слой */
    }
  }

  bindMediaSession(handlers = {}) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const map = {
      play: handlers.play,
      pause: handlers.pause,
      stop: handlers.stop,
      nexttrack: handlers.next,
      previoustrack: handlers.previous,
    };
    for (const [action, handler] of Object.entries(map)) {
      if (typeof handler !== "function") continue;
      try {
        navigator.mediaSession.setActionHandler(action, () => handler());
      } catch {
        /* действие может не поддерживаться */
      }
    }
  }
}

export default Player;
