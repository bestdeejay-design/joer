/**
 * JOER — футер-плеер: DOM-слой над js/player.js (T-03).
 *
 * Никакой логики воспроизведения здесь нет: только отражение состояния,
 * понятные подписи и доступность (aria-label/aria-pressed/aria-expanded).
 */

import { STATE } from "../player.js";

const STATUS_BY_STATE = {
  [STATE.IDLE]: "Выберите станцию — и мир вокруг изменится",
  [STATE.LOADING]: "Буферизация…",
  [STATE.PLAYING]: "В эфире",
  [STATE.PAUSED]: "Пауза",
  [STATE.ERROR]: "Поток недоступен",
};

export function createPlayerView({ root, player, onRetry, onNext, onPrevious }) {
  const el = {
    player: root,
    toggle: root.querySelector("#player-toggle"),
    station: root.querySelector("#player-station"),
    status: root.querySelector("#player-status"),
    sub: root.querySelector("#player-sub"),
    prev: root.querySelector("#player-prev"),
    next: root.querySelector("#player-next"),
    more: root.querySelector("#player-more"),
    mute: root.querySelector("#player-mute"),
    volume: root.querySelector("#player-volume"),
    volumeValue: root.querySelector("#player-volume-value"),
    error: root.querySelector("#player-error"),
    errorText: root.querySelector("#player-error-text"),
    retry: root.querySelector("#player-retry"),
    skip: root.querySelector("#player-skip"),
  };

  const setIcon = (button, id) => {
    const use = button?.querySelector("use");
    if (use) use.setAttribute("href", `#${id}`);
  };

  function render(detail = {}) {
    const { state, station, volume, muted, message, exhausted, suggestion } = detail;

    el.player.dataset.state = state ?? STATE.IDLE;

    if (el.station) el.station.textContent = station?.name ?? "JOER";
    if (el.sub) {
      el.sub.textContent = station ? `${station.provider} · ${station.genres?.slice(0, 2).join(" / ") || "радио"}` : "";
      el.sub.hidden = !station;
    }

    if (el.status) {
      el.status.textContent = message || STATUS_BY_STATE[state ?? STATE.IDLE] || "";
    }

    if (el.toggle) {
      const canPlay = Boolean(station) || state === STATE.PLAYING;
      el.toggle.disabled = !canPlay;
      const isPlaying = state === STATE.PLAYING || state === STATE.LOADING;
      setIcon(el.toggle, isPlaying ? "i-pause" : "i-play");
      el.toggle.classList.toggle("is-playing", isPlaying);
      el.toggle.setAttribute(
        "aria-label",
        !canPlay ? "Плеер пуст" : isPlaying ? `Пауза: ${station?.name ?? ""}` : `Играть: ${station?.name ?? "последнюю станцию"}`,
      );
    }

    const hasStation = Boolean(station);
    if (el.prev) el.prev.disabled = !hasStation;
    if (el.next) el.next.disabled = !hasStation;

    if (typeof volume === "number" && el.volume) {
      const percent = Math.round(volume * 100);
      if (document.activeElement !== el.volume) el.volume.value = String(percent);
      if (el.volumeValue) el.volumeValue.textContent = muted ? "—" : `${percent}%`;
    }

    if (el.mute) {
      el.mute.setAttribute("aria-pressed", String(Boolean(muted)));
      el.mute.setAttribute("aria-label", muted ? "Включить звук" : "Выключить звук");
      el.mute.classList.toggle("is-muted", Boolean(muted));
    }

    if (el.error) {
      el.error.hidden = state !== STATE.ERROR;
    }
    if (el.errorText && state === STATE.ERROR) {
      el.errorText.textContent = exhausted
        ? "Потоки этой группы не отвечают: попробовали зеркала и соседние станции. Нажмите «Повторить» или выберите другое настроение."
        : "Поток оборвался.";
    }
    if (el.skip) el.skip.hidden = !suggestion;
    if (el.skip && suggestion) el.skip.textContent = `Включить «${suggestion.name}»`;
  }

  /* --- обработчики --- */
  el.toggle?.addEventListener("click", () => player.toggle());
  el.prev?.addEventListener("click", () => onPrevious?.());
  el.next?.addEventListener("click", () => onNext?.());
  el.retry?.addEventListener("click", () => onRetry?.());
  el.skip?.addEventListener("click", () => {
    const suggestion = player.lastSuggestion;
    if (suggestion) player.play(suggestion);
    else onNext?.();
  });
  el.mute?.addEventListener("click", () => player.toggleMute());
  el.volume?.addEventListener("input", (event) => player.setVolume(Number(event.target.value) / 100));
  el.volume?.addEventListener("change", (event) => player.setVolume(Number(event.target.value) / 100));

  // Раскрытие панели громкости на узких экранах
  el.more?.addEventListener("click", () => {
    const expanded = el.more.getAttribute("aria-expanded") === "true";
    el.more.setAttribute("aria-expanded", String(!expanded));
    el.player.classList.toggle("is-expanded", !expanded);
    if (!expanded) el.volume?.focus();
  });

  player.addEventListener("change", (event) => {
    if (event.detail?.suggestion) player.lastSuggestion = event.detail.suggestion;
    render(event.detail);
  });

  render({ state: player.state, station: player.station, volume: player.volume, muted: player.muted });

  return { render };
}
