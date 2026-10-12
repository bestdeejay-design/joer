/**
 * JOER — стилизованный эквалайзер атмосферы (T-10).
 *
 * Вертикальная композиция у левого края, которая рисуется ВНУТРИ canvas-слоя
 * атмосферы (тот же z-index, под контентом, без своего rAF и без offscreen-буферов).
 *
 * Источник данных — тот же спектр, что у сцен (`rhythm.spectrum`, 32 полосы 0…1):
 * реальный `AnalyserNode` в реактивном режиме, синтез `rhythm.js` — без CORS.
 * Модуль ничего не знает про Web Audio: только числа на входе, штрихи на выходе.
 *
 * У каждой сцены свой рисунок (не «бар-чарт другого цвета»):
 *   waves (lounge)   — нити-струны, амплитуда от mid, блики-«лампочки бара»;
 *   rings (club)     — жёсткие неоновые бары, резкий пик на кик, вертикальный bloom;
 *   bokeh (romantic) — мягкие «свечи»-столбцы, качание на mid, двойной отклик «сердца»;
 *   stars (space)    — разреженная точечная матрица (точка = полоса), метеор на высоких;
 *   vinyl (velvet)   — сегментные ретро-столбики с VU-инерцией, стрелка пика и зерно.
 */

import { SPECTRUM_BANDS } from "./rhythm.js";

/** Брейкпоинт, ниже которого эквалайзер ужимается в узкую кромку. */
export const EQ_COMPACT_BREAKPOINT = 720;
/** Максимальная ширина кромки на узких экранах (критерий T-10). */
export const EQ_COMPACT_MAX = 40;

/* Значения токенов (css/tokens.css) — canvas не читает CSS-шкалу отступов на каждом кадре. */
const TOKENS = {
  sp3: 12,
  sp4: 16,
  sp8: 32,
  headerH: 64,
  playerH: 88,
  contentMax: 1180,
};

/** Целевая «живость» эквалайзера по состоянию плеера. */
const LIVE_BY_STATE = { playing: 1, loading: 0.35, error: 0.1, paused: 0, idle: 0 };

/* ------------------------------------------------------------------
   Хелперы
   ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function mix(a, b, k) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Детерминированный шум 0…1 — зерно без Math.random в цикле. */
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Значение «ряда» эквалайзера из 32 полос. index 0 — верх, rows-1 — низ:
 * бас внизу, верхние частоты наверху (как у стойки VU-метров).
 */
export function sampleBands(bands, rows, index) {
  const n = bands.length;
  const fromBottom = rows - 1 - index;
  const start = Math.floor((fromBottom / rows) * n);
  const end = Math.max(start + 1, Math.floor(((fromBottom + 1) / rows) * n));
  let sum = 0;
  let peak = 0;
  for (let i = start; i < end; i += 1) {
    sum += bands[i];
    if (bands[i] > peak) peak = bands[i];
  }
  // Смесь среднего и пика: широкие ряды не «замыливаются»
  return clamp((sum / (end - start)) * 0.6 + peak * 0.4, 0, 1);
}

/* ------------------------------------------------------------------
   Раскладка
   ------------------------------------------------------------------ */

/**
 * Прямоугольник эквалайзера для вьюпорта w×h (CSS-пиксели).
 *  - ≥ 720px: полоса 60–80% высоты между хедером и плеером, в свободном поле
 *    слева от контента; если поля нет — приглушается (рисуется под карточками).
 *  - < 720px: узкая кромка ≤ 40px, целиком внутри боковых полей `.shell`
 *    (padding-inline: clamp(16px, 4vw, 32px)) — карточки не перекрываются.
 */
export function equalizerLayout(w, h) {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  const gutter = clamp(width * 0.04, TOKENS.sp4, TOKENS.sp8);
  const compact = width < EQ_COMPACT_BREAKPOINT;

  const top = TOKENS.headerH + TOKENS.sp4;
  const bottom = height - TOKENS.playerH - TOKENS.sp4;
  const available = bottom - top;
  const ratio = compact ? 0.6 : 0.72;
  const minH = height * 0.6;
  const maxH = height * 0.8;
  const stripH = clamp(Math.min(height * ratio, Math.max(available, minH)), minH, maxH);
  const y = available >= stripH ? top + (available - stripH) / 2 : (height - stripH) / 2;

  if (compact) {
    // Кромка живёт в боковом поле: отступ 3px от края и ≥ 3px до контента
    const x = 3;
    const stripW = clamp(Math.floor(gutter - x * 2), 6, EQ_COMPACT_MAX);
    return { x, y, width: stripW, height: stripH, compact: true, gutter, fade: 0.7 };
  }

  const freeLeft = Math.max(0, (width - TOKENS.contentMax) / 2) + gutter;
  const x = TOKENS.sp4;
  const stripW = clamp(freeLeft - x - TOKENS.sp3, 44, 132);
  // Полоса заходит под карточки — делаем её тише, чтобы не спорить с текстом
  const fits = x + stripW <= freeLeft;
  return { x, y, width: stripW, height: stripH, compact: false, gutter, fade: fits ? 1 : 0.55 };
}

/* ------------------------------------------------------------------
   Сглаженные полосы: реальный/синтезированный спектр + «дыхание» на паузе
   ------------------------------------------------------------------ */

export class EqualizerBands {
  constructor(size = SPECTRUM_BANDS) {
    this.values = new Float32Array(size);
    this.live = 0;
    this.clock = 0;
  }

  /** Тихое «дыхание» — то, к чему полосы оседают на паузе (не мёртвый столбик). */
  breath(i) {
    const c = this.clock;
    return 0.09 + Math.sin(c * 0.8 + i * 0.45) * 0.045 + Math.sin(c * 0.31 + i * 1.3) * 0.03;
  }

  /**
   * Шаг сглаживания. spectrum — 32 полосы 0…1; state — состояние плеера;
   * calm — амплитуда ×0.5 вокруг дыхания; snap — без инерции (статичный кадр).
   */
  update(dt, { spectrum, state = "idle", calm = false, snap = false } = {}) {
    const step = clamp(Number(dt) || 0, 0, 0.1);
    this.clock += step;
    const liveTarget = LIVE_BY_STATE[state] ?? 0;
    this.live = snap ? liveTarget : this.live + (liveTarget - this.live) * Math.min(1, step * 1.4);

    const n = this.values.length;
    for (let i = 0; i < n; i += 1) {
      const rest = this.breath(i);
      // Перцептивная кривая: средние уровни читаются, пики не «залипают»
      const music = spectrum ? Math.pow(clamp(Number(spectrum[i]) || 0, 0, 1), 0.75) : 0;
      let target = rest + (Math.max(rest * 0.6, music) - rest) * this.live;
      if (calm) target = rest + (target - rest) * 0.5;
      target = clamp(target, 0, 1);
      if (snap) {
        this.values[i] = target;
      } else {
        // Быстрая атака, мягкое оседание
        const rate = target > this.values[i] ? 16 : 3.4;
        this.values[i] += (target - this.values[i]) * Math.min(1, step * rate);
      }
    }
    return this;
  }

  get mean() {
    let sum = 0;
    for (const v of this.values) sum += v;
    return sum / this.values.length;
  }
}

/* ------------------------------------------------------------------
   Стили по сценам. Кадр: ctx, frame → { energy, flashes }.
   frame: t, dt, clock, alpha, layout, bands, live, bass, mid, high, kick,
          pulse, beatCount, palette, sprites, low, calm.
   ------------------------------------------------------------------ */

const styles = {
  /** Lounge: тонкие струны, колебание от mid, бегущий блик-«лампочка». */
  waves: {
    init() {
      return {};
    },
    draw(ctx, state, f) {
      const { x, y, width: W, height: H, compact } = f.layout;
      const rows = compact ? 7 : 11;
      const gap = H / rows;
      const segments = compact ? 4 : 12;
      let energy = 0;

      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (let r = 0; r < rows; r += 1) {
        const v = sampleBands(f.bands, rows, r);
        energy += v;
        const cy = y + (r + 0.5) * gap;
        const color = mix(f.palette.accent2, f.palette.accent, r / Math.max(1, rows - 1));
        const amp = gap * 0.42 * (0.18 + v * 0.95) * (0.55 + f.mid * 0.9);
        const freq = 2.1 + r * 0.37;
        const phase = f.t * freq * 0.9 + r * 1.1;

        const passes = f.low ? 1 : 2;
        for (let pass = 0; pass < passes; pass += 1) {
          const glow = passes === 2 && pass === 0;
          ctx.beginPath();
          for (let s = 0; s <= segments; s += 1) {
            const k = s / segments;
            // Стоячая волна: концы струны закреплены, середина поёт
            const yy = cy + Math.sin(Math.PI * k) * Math.sin(phase + k * 2.4) * amp;
            if (s === 0) ctx.moveTo(x + k * W, yy);
            else ctx.lineTo(x + k * W, yy);
          }
          ctx.strokeStyle = rgba(color, (glow ? 0.07 : 0.2 + v * 0.45) * f.alpha);
          ctx.lineWidth = glow ? 5 : compact ? 1 : 1.2;
          ctx.stroke();
        }

        // Колки — крошечные точки на концах струн
        ctx.fillStyle = rgba(color, (0.25 + v * 0.3) * f.alpha);
        ctx.fillRect(x - 1, cy - 1, 2, 2);

        // Блик «лампочки бара» бежит по струне; громкость → яркость и вылет
        const k = 0.12 + ((Math.sin(f.t * 0.35 + r * 0.9) + 1) / 2) * 0.76 * (0.35 + v * 0.65);
        const by = cy + Math.sin(Math.PI * k) * Math.sin(phase + k * 2.4) * amp;
        const bx = x + k * W;
        const sprite = f.sprites?.[r % 2];
        if (!f.low && sprite) {
          const size = gap * (0.9 + v * 1.4);
          ctx.globalAlpha = (0.25 + v * 0.55) * f.alpha;
          ctx.drawImage(sprite, bx - size / 2, by - size / 2, size, size);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = rgba(f.palette.accent2, (0.35 + v * 0.4) * f.alpha);
          ctx.beginPath();
          ctx.arc(bx, by, compact ? 1.2 : 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.lineCap = "butt";
      ctx.globalCompositeOperation = "source-over";
      return { energy: energy / rows, flashes: 0 };
    },
  },

  /** Club: жёсткие неоновые бары, пиковые «шапки» прыгают на кик, вертикальный bloom. */
  rings: {
    init() {
      return { peaks: new Float32Array(24), lastBeat: -1, flash: 0 };
    },
    draw(ctx, state, f) {
      const { x, y, width: W, height: H, compact } = f.layout;
      const rows = compact ? 12 : 20;
      const gap = H / rows;
      const barH = Math.max(1, gap * 0.56);
      let energy = 0;
      let flashes = 0;

      // Резкий пик на кик (в спокойном режиме — без вспышек)
      if (!f.calm && f.kick > 0.5 && state.lastBeat !== f.beatCount) {
        state.lastBeat = f.beatCount;
        state.flash = 1;
      }
      state.flash *= Math.exp(-f.dt * 9);
      if (f.calm) state.flash = 0;
      const kickBoost = state.flash * f.live;
      if (kickBoost > 0.05) flashes += 1;

      ctx.globalCompositeOperation = "lighter";

      // Вертикальный bloom-столб у кромки — дышит на кик
      if (!f.low) {
        const column = ctx.createLinearGradient(0, y, 0, y + H);
        const c = mix(f.palette.accent, f.palette.accent2, 0.5);
        column.addColorStop(0, rgba(c, 0));
        column.addColorStop(0.5, rgba(c, (0.08 + kickBoost * 0.22) * f.alpha));
        column.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = column;
        ctx.fillRect(x - 2, y, compact ? 2 : 3, H);
      }

      for (let r = 0; r < rows; r += 1) {
        const v = sampleBands(f.bands, rows, r);
        energy += v;
        const isLow = r >= rows * 0.6;
        const boosted = clamp(v * (1 + (isLow ? kickBoost * 0.45 : kickBoost * 0.15)), 0, 1);
        const len = W * (0.06 + boosted * 0.94);
        const cy = y + (r + 0.5) * gap;
        const color = mix(f.palette.accent, f.palette.accent2, r / Math.max(1, rows - 1));

        // Шапка пика: мгновенно вверх, медленно вниз
        state.peaks[r] = Math.max(boosted, (state.peaks[r] ?? 0) - f.dt * 0.55);

        if (!f.low) {
          // Мягкий вертикальный ореол бара — «лёгкий bloom» без offscreen
          ctx.fillStyle = rgba(color, (0.05 + boosted * 0.08) * f.alpha);
          ctx.fillRect(x, cy - gap * 0.62, len, gap * 1.24);
        }
        ctx.fillStyle = rgba(color, (0.32 + boosted * 0.5) * f.alpha);
        ctx.fillRect(x, cy - barH / 2, len, barH);

        const px = x + W * (0.06 + state.peaks[r] * 0.94);
        ctx.fillStyle = rgba(f.palette.accent2, (0.55 + kickBoost * 0.4) * f.alpha);
        ctx.fillRect(px + 2, cy - barH / 2, compact ? 1 : 2, barH);
      }

      ctx.globalCompositeOperation = "source-over";
      return { energy: energy / rows, flashes };
    },
  },

  /** Romantic: мягкие свечи-столбцы света, качание на mid, двойной пульс «сердца». */
  bokeh: {
    init() {
      return { heart: 0, echo: 0, echoDelay: -1, lastBeat: -1 };
    },
    draw(ctx, state, f) {
      const { x, y, width: W, height: H, compact } = f.layout;
      const cols = compact ? 1 : clamp(Math.round(W / 22), 3, 6);
      const colW = W / cols;
      let energy = 0;
      let flashes = 0;

      // «Сердце»: удар + эхо через ~220 мс (как у сцены bokeh); calm — без вспышек
      if (!f.calm && f.kick > 0.45 && state.lastBeat !== f.beatCount) {
        state.lastBeat = f.beatCount;
        state.heart = 1;
        state.echoDelay = 0.22;
      }
      state.heart *= Math.exp(-f.dt * 5.2);
      if (state.echoDelay > 0) {
        state.echoDelay -= f.dt;
        if (state.echoDelay <= 0) state.echo = 0.62;
      }
      state.echo *= Math.exp(-f.dt * 5.2);
      if (f.calm) {
        state.heart = 0;
        state.echo = 0;
      }
      const heart = Math.max(state.heart, state.echo) * f.live;
      if (heart > 0.05) flashes += 1;

      const base = y + H;
      // Узкая кромка: одна свеча, её надо подсветить сильнее, чтобы читалась
      const boost = compact ? 1.6 : 1;
      ctx.globalCompositeOperation = "lighter";
      for (let c = 0; c < cols; c += 1) {
        // Колонка = группа полос; бас — в первой свече у края
        const start = Math.floor((c / cols) * f.bands.length);
        const end = Math.max(start + 1, Math.floor(((c + 1) / cols) * f.bands.length));
        let v = 0;
        for (let i = start; i < end; i += 1) v = Math.max(v, f.bands[i]);
        energy += v;

        const colH = H * (0.16 + v * 0.78) * (1 + heart * 0.12);
        const cx = x + (c + 0.5) * colW;
        const sway = Math.sin(f.t * (0.7 + c * 0.13) + c * 1.9) * 0.06 * (0.35 + f.mid * 1.2);
        const color = c % 2 === 0 ? f.palette.glow1 : f.palette.glow2;

        ctx.save();
        ctx.translate(cx, base);
        ctx.rotate(sway);
        const sprite = f.sprites?.[c % 2];
        if (!f.low && sprite) {
          // Растянутый мягкий спрайт — столб света с сильно размытыми краями
          const bodyW = colW * (1.5 + v * 0.6);
          ctx.globalAlpha = (0.22 + v * 0.4 + heart * 0.18) * boost * f.alpha;
          ctx.drawImage(sprite, -bodyW / 2, -colH * 1.08, bodyW, colH * 1.25);
          // Пламя-ядро у вершины
          const flame = colW * (0.7 + v * 0.7 + heart * 0.5);
          ctx.globalAlpha = (0.35 + v * 0.45 + heart * 0.25) * boost * f.alpha;
          ctx.drawImage(sprite, -flame / 2, -colH - flame / 2, flame, flame * 1.3);
          ctx.globalAlpha = 1;
        } else {
          // low: два плоских овала (ореол + тело) вместо спрайтов
          ctx.fillStyle = rgba(color, (0.07 + v * 0.1) * boost * f.alpha);
          ctx.beginPath();
          ctx.ellipse(0, -colH / 2, Math.max(1, colW * 0.46), colH / 2 + 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba(color, (0.16 + v * 0.26) * boost * f.alpha);
          ctx.beginPath();
          ctx.ellipse(0, -colH / 2, Math.max(1, colW * 0.24), colH / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // Фитиль — тонкая яркая черта
        ctx.fillStyle = rgba(f.palette.accent2, (0.3 + v * 0.4) * f.alpha);
        ctx.fillRect(-0.5, -colH - 3, 1, 5);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      return { energy: energy / cols, flashes };
    },
  },

  /** Space: разреженная точечная матрица — точка = полоса; метеор-вспышка на высоких. */
  stars: {
    init() {
      return { meteor: null, cooldown: 1.5 };
    },
    draw(ctx, state, f) {
      const { x, y, width: W, height: H, compact } = f.layout;
      const rows = compact ? 14 : 24;
      const gap = H / rows;
      const dots = compact ? 1 : clamp(Math.floor(W / 15), 3, 9);
      const step = dots > 1 ? W / (dots - 1) : 0;
      let energy = 0;
      let flashes = 0;

      ctx.globalCompositeOperation = "lighter";
      for (let r = 0; r < rows; r += 1) {
        const v = sampleBands(f.bands, rows, r);
        energy += v;
        const cy = y + (r + 0.5) * gap;
        const twinkle = 0.75 + Math.sin(f.clock * (1.3 + r * 0.17) + r * 2.3) * 0.25 * (0.6 + f.high);

        if (dots === 1) {
          ctx.fillStyle = rgba(r % 3 === 0 ? f.palette.accent2 : [255, 255, 255], (0.35 + v * 0.65) * twinkle * f.alpha);
          ctx.beginPath();
          ctx.arc(x + W / 2, cy, 1.1 + v * 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        const lit = v * dots;
        for (let d = 0; d < dots; d += 1) {
          const on = d < lit;
          const head = on && d + 1 >= lit;
          const dx = x + d * step;
          const a = on ? (0.3 + v * 0.45) * twinkle : 0.07;
          ctx.fillStyle = rgba(head ? f.palette.accent2 : [255, 255, 255], a * f.alpha);
          ctx.beginPath();
          ctx.arc(dx, cy, head ? 1.9 : on ? 1.3 : 0.9, 0, Math.PI * 2);
          ctx.fill();
          if (head && !f.low && f.sprites?.[0]) {
            const size = gap * (1.4 + v * 1.6);
            ctx.globalAlpha = (0.2 + v * 0.5) * twinkle * f.alpha;
            ctx.drawImage(f.sprites[r % 2 ? 1 : 0], dx - size / 2, cy - size / 2, size, size);
            ctx.globalAlpha = 1;
          }
        }
      }

      // Метеор по верхним частотам — в спокойном режиме не вспыхивает
      state.cooldown -= f.dt;
      if (!f.calm && !state.meteor && state.cooldown <= 0 && f.high * f.live > 0.42) {
        state.meteor = { y0: y + H * (0.05 + hash(f.clock) * 0.5), life: 0 };
        state.cooldown = 1.8;
      }
      if (f.calm) state.meteor = null;
      if (state.meteor) {
        const m = state.meteor;
        m.life += f.dt * 1.8;
        const k = clamp(m.life, 0, 1);
        const hx = x + W * (1.1 - k * 1.2);
        const hy = m.y0 + k * H * 0.35;
        const trail = Math.min(W * 0.9, 90);
        const a = Math.sin(Math.PI * k) * 0.8 * f.alpha;
        const gradient = ctx.createLinearGradient(hx, hy, hx + trail, hy - trail * 0.35);
        gradient.addColorStop(0, rgba(f.palette.accent2, a));
        gradient.addColorStop(1, rgba(f.palette.accent2, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + trail, hy - trail * 0.35);
        ctx.stroke();
        flashes += 1;
        if (m.life >= 1) state.meteor = null;
      }

      ctx.globalCompositeOperation = "source-over";
      return { energy: energy / rows, flashes };
    },
  },

  /** Velvet: сегментные ретро-столбики тёплого золота с VU-инерцией, стрелка пика, зерно. */
  vinyl: {
    init() {
      return { vu: new Float32Array(16), peaks: new Float32Array(16), grainSeed: 0 };
    },
    draw(ctx, state, f) {
      const { x, y, width: W, height: H, compact } = f.layout;
      const rows = compact ? 8 : 12;
      const gap = H / rows;
      const barH = Math.max(2, gap * 0.5);
      const segW = compact ? 3 : 6;
      const segGap = compact ? 1 : 2;
      const segments = Math.max(2, Math.floor((W + segGap) / (segW + segGap)));
      let energy = 0;

      for (let r = 0; r < rows; r += 1) {
        const target = sampleBands(f.bands, rows, r);
        // VU-баллистика: медленный подъём, мягкое падение; стрелка пика сползает ещё медленнее
        const current = state.vu[r];
        const rate = target > current ? 3.2 : 1.3;
        state.vu[r] = f.snap ? target : current + (target - current) * Math.min(1, f.dt * rate);
        state.peaks[r] = f.snap ? target : Math.max(state.vu[r], state.peaks[r] - f.dt * 0.12);
        const v = state.vu[r];
        energy += v;

        const cy = y + (r + 0.5) * gap;
        const lit = Math.round(v * segments);
        for (let s = 0; s < segments; s += 1) {
          const k = s / Math.max(1, segments - 1);
          // Тёплое золото → «красная зона» темы на последних сегментах
          const color = k > 0.78 ? f.palette.accent2 : mix(mix(f.palette.accent, f.palette.bg, 0.25), f.palette.accent, k / 0.78);
          const on = s < lit;
          ctx.fillStyle = rgba(color, (on ? 0.42 + v * 0.38 : 0.06) * f.alpha);
          ctx.fillRect(x + s * (segW + segGap), cy - barH / 2, segW, barH);
        }

        // Стрелка пика — тонкая вертикальная риска
        const peakX = x + Math.min(segments - 1, Math.round(state.peaks[r] * segments)) * (segW + segGap) + segW;
        ctx.fillStyle = rgba(f.palette.accent, 0.6 * f.alpha);
        ctx.fillRect(peakX, cy - barH / 2 - 1, 1, barH + 2);
      }

      // Шкала слева — риски как на старом пульте
      ctx.fillStyle = rgba(f.palette.accent, 0.22 * f.alpha);
      ctx.fillRect(x - 4, y, 1, H);
      for (let r = 0; r <= rows; r += 3) ctx.fillRect(x - 7, y + r * gap, 4, 1);

      // Лёгкое зерно — детерминированные пылинки, обновление ~12 раз в секунду
      const frameSeed = Math.floor(f.clock * 12);
      const grains = f.low ? 6 : compact ? 8 : 22;
      for (let i = 0; i < grains; i += 1) {
        const gx = x + hash(frameSeed * 31 + i) * W;
        const gy = y + hash(frameSeed * 17 + i * 7) * H;
        ctx.fillStyle = rgba(mix(f.palette.accent, [255, 236, 200], 0.4), (0.08 + hash(i + frameSeed) * 0.14) * f.alpha);
        ctx.fillRect(gx, gy, 1, 1);
      }

      return { energy: energy / rows, flashes: 0 };
    },
  },
};

export const EQUALIZER_STYLES = Object.keys(styles);

/** Состояние стиля (пики, инерция, «сердце», метеор) — живёт вместе со сценой. */
export function createEqualizerState(styleId) {
  return styles[styleId]?.init?.() ?? {};
}

/**
 * Нарисовать эквалайзер стиля styleId. Возвращает сводку кадра для тестов/отладки:
 * { style, energy (средний уровень рядов), flashes (вспышки кадра), ops }.
 */
export function drawEqualizer(ctx, styleId, state, frame) {
  const style = styles[styleId];
  if (!style || !ctx || frame.alpha <= 0.002) return null;
  const alpha = frame.alpha * (frame.layout?.fade ?? 1);
  ctx.save();
  const result = style.draw(ctx, state, { ...frame, alpha }) ?? { energy: 0, flashes: 0 };
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return { style: styleId, alpha, ...result };
}
