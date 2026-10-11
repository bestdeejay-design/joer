/**
 * JOER — опциональная аудио-реактивность (T-06).
 *
 * ВАЖНО: как только <audio> подключён к Web Audio-графу, браузер требует
 * CORS-заголовков от потока. У радиостанций их почти никогда нет, а цена ошибки —
 * тишина вместо музыки. Поэтому:
 *
 *   1. Подключаемся только если станция явно помечена `cors: true` в каталоге.
 *   2. Всё в try/catch: любая ошибка → немедленный отказ и фолбэк.
 *   3. Если анализатор молчит (нули) — считаем, что данных нет, и просим
 *      приложение пересоздать <audio> уже без Web Audio-графа.
 *
 * Сцена в atmosphere.js выглядит полноценно и без реактивности: это украшение,
 * а не опора. В текущем каталоге станций с `cors: true` нет — слой спит.
 */

export function stationSupportsReactivity(station) {
  return station?.cors === true;
}

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
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    bins = new Uint8Array(analyser.frequencyBinCount);
  } catch (error) {
    onFallback?.(error);
    return null;
  }

  const band = (from, to) => {
    const start = Math.floor(from * bins.length);
    const end = Math.max(start + 1, Math.floor(to * bins.length));
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += bins[i];
    return sum / ((end - start) * 255);
  };

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);

    analyser.getByteFrequencyData(bins);
    const levels = {
      bass: band(0, 0.08),
      mid: band(0.08, 0.35),
      high: band(0.35, 1),
      overall: band(0, 1),
    };

    if (levels.overall < 0.002) {
      silentFrames += 1;
      // ~1.5 с тишины — значит график не отдаёт данные (поток без CORS). Уходим.
      if (silentFrames > 90) {
        dispose();
        onFallback?.(new Error("analyser is silent — вероятно, поток без CORS"));
        return;
      }
    } else {
      silentFrames = 0;
    }

    onLevels?.(levels);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
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

  if (context.state === "suspended") context.resume?.()?.catch?.(() => {});
  tick();

  return { dispose, get context() { return context; } };
}

export default createReactivity;
