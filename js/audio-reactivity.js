/**
 * JOER — опциональная аудио-реактивность (T-06, расширено в T-09).
 *
 * ВАЖНО: как только <audio> подключён к Web Audio-графу, браузер требует
 * CORS-заголовков от потока. У большинства радиостанций их нет, а цена ошибки —
 * тишина вместо музыки. Поэтому:
 *
 *   1. Подключаемся только когда поддержка CORS подтверждена:
 *      - станция помечена `cors: true` в каталоге (после `npm run audit:cors`), или
 *      - проба `probeStreamCors()` увидела нужные заголовки (результат кэшируется).
 *    Явный `cors: false` запрещает подключение навсегда.
 *   2. Всё в try/catch: любая ошибка → немедленный отказ и фолбэк.
 *   3. Если анализатор молчит (нули) — считаем, что данных нет, и просим
 *      приложение пересоздать <audio> уже без Web Audio-графа.
 *
 * Сцена в atmosphere.js выглядит полноценно и без реактивности: это украшение,
 * а не опора.
 */

import { readJSON, write } from "./storage.js";

const PROBE_TIMEOUT_MS = 2500;
const CACHE_KEY = "joer:cors-cache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const SILENT_FRAMES_LIMIT = 90; // ~1.5 с тишины при 60 fps

/* ------------------------------------------------------------------
   Кэш результатов проб (localStorage → память)
   ------------------------------------------------------------------ */

const memoryCache = new Map();

function cacheRead(url) {
  if (memoryCache.has(url)) return memoryCache.get(url);
  const data = readJSON(CACHE_KEY, null);
  const entry = data?.entries?.[url];
  if (!Array.isArray(entry)) return null;
  const [ok, at] = entry;
  if (typeof at !== "number" || Date.now() - at > CACHE_TTL_MS) return null;
  return Boolean(ok);
}

function cacheWrite(url, ok) {
  memoryCache.set(url, ok);
  const data = readJSON(CACHE_KEY, { v: 1, entries: {} });
  const entries = data && typeof data === "object" && data.entries ? data.entries : {};
  entries[url] = [ok, Date.now()];
  write(CACHE_KEY, { v: 1, entries });
}

/** Чисто синхронная справка: известна ли уже поддержка CORS для URL. */
export function knownCorsSupport(url) {
  return cacheRead(url);
}

/* ------------------------------------------------------------------
   Проба потока на CORS
   ------------------------------------------------------------------ */

/**
 * Можно ли безопасно подключить поток к Web Audio-графу.
 *
 * Делаем обычный GET в режиме cors и сразу обрываем тело: простой cross-origin
 * запрос без спец-заголовков не требует preflight, а браузер отдаст ответ
 * только если сервер прислал Access-Control-Allow-Origin. Результат кэшируется.
 *
 * Возвращает true/false. Сетевая ошибка = false (звук и так играет без графа).
 */
export async function probeStreamCors(url, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (typeof url !== "string" || !url.startsWith("https://")) return false;
  const cached = cacheRead(url);
  if (cached !== null) return cached;
  if (typeof fetch !== "function") return false;

  let ok = false;
  let timer = null;
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      signal: controller?.signal,
    });
    ok = Boolean(
      response &&
        response.status > 0 &&
        response.status < 400 &&
        (response.type === "cors" || response.headers?.get?.("access-control-allow-origin")),
    );
    try {
      await response?.body?.cancel?.();
    } catch {
      /* тело могло уже закрыться */
    }
  } catch {
    // TypeError в cors-режиме = заголовков нет; AbortError = таймаут. Оба — «нет».
    ok = false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  cacheWrite(url, ok);
  return ok;
}

/* ------------------------------------------------------------------
   Статус станции
   ------------------------------------------------------------------ */

/**
 * true — подключаться можно; false — нельзя; null — неизвестно (стоит проба).
 * Каталог может явно пометить станцию полем `cors`.
 */
export function stationSupportsReactivity(station) {
  if (!station) return null;
  if (station.cors === true) return true;
  if (station.cors === false) return false;
  return null;
}

/* ------------------------------------------------------------------
   Анализатор
   ------------------------------------------------------------------ */

/**
 * Строит Web Audio-граф вокруг <audio> и отдаёт уровни частот.
 *
 * Перед вызовом у элемента должен стоять `crossOrigin`, а ресурс — быть
 * загружен заново (см. player.freshAudio / app.attachReactivity).
 *
 * onLevels(levels) получает { bass, mid, high, overall, spectrum } (0..1)
 * либо null при dispose. onFallback(error) — сигнал немедленно вернуться
 * к процедурной сцене и пересоздать <audio> без графа.
 */
export function createReactivity(audio, { onLevels, onFallback } = {}) {
  if (!audio) return null;

  const Ctor =
    (typeof AudioContext !== "undefined" && AudioContext) ||
    (typeof webkitAudioContext !== "undefined" && webkitAudioContext) ||
    null;
  if (!Ctor) return null;

  let context = null;
  let analyser = null;
  let source = null;
  let bins = null;
  let raf = null;
  let disposed = false;
  let silentFrames = 0;

  try {
    context = new Ctor();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    bins = new Uint8Array(analyser.frequencyBinCount);
  } catch (error) {
    try {
      context?.close?.();
    } catch {
      /* контекст и не открылся */
    }
    onFallback?.(error);
    return null;
  }

  const sampleRate = context.sampleRate || 44100;
  const binHz = sampleRate / (analyser.fftSize || 2048);

  /** Средний уровень полосы в герцах, нормированный 0..1. */
  const bandHz = (fromHz, toHz) => {
    const start = Math.max(0, Math.floor(fromHz / binHz));
    const end = Math.min(bins.length, Math.max(start + 1, Math.ceil(toHz / binHz)));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += bins[i];
    return sum / ((end - start) * 255);
  };

  // Лог-спектр для эквалайзера сцен: 32 полосы от 40 Гц до 16 кГц
  const spectrum = new Float32Array(32);
  const spectrumEdges = Array.from({ length: spectrum.length + 1 }, (_, i) => {
    const t0 = i / spectrum.length;
    return 40 * Math.pow(16000 / 40, t0);
  });

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);

    analyser.getByteFrequencyData(bins);

    // Полосы в гертах: бас «качает», средние гонят дрейф, верха мерцают
    const bass = bandHz(30, 200);
    const mid = bandHz(200, 2000);
    const high = bandHz(2000, 12000);
    const overall = bandHz(30, 12000);

    for (let i = 0; i < spectrum.length; i += 1) {
      spectrum[i] = bandHz(spectrumEdges[i], spectrumEdges[i + 1]);
    }

    const levels = { bass, mid, high, overall, spectrum };

    if (overall < 0.002) {
      silentFrames += 1;
      // ~1.5 с тишины — значит график не отдаёт данные (поток без CORS). Уходим.
      if (silentFrames > SILENT_FRAMES_LIMIT) {
        dispose();
        onFallback?.(new Error("analyser is silent — вероятно, поток без CORS"));
        return;
      }
    } else {
      silentFrames = 0;
    }

    onLevels?.(levels);
  }

  // На iOS контекст может подвеситься вне жеста — будим при касании.
  const wake = () => context.resume?.()?.catch?.(() => {});

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener?.("pointerdown", wake);
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    try {
      source?.disconnect();
      analyser?.disconnect();
    } catch {
      /* уже отключено */
    }
    try {
      context?.close?.();
    } catch {
      /* контекст уже закрыт */
    }
    onLevels?.(null);
  }

  if (context.state === "suspended") wake();
  window.addEventListener?.("pointerdown", wake, { once: true, passive: true });

  tick();

  return { dispose, element: audio, get context() { return context; } };
}

export default createReactivity;
