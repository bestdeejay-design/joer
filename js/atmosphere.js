/**
 * JOER — атмосферный движок (T-06, апгрейд T-09).
 *
 * Canvas-слой под контентом. Сцена выбирается по теме, «живость» — по энергии
 * станции, состоянию плеера и пользовательской интенсивности.
 *
 * Что поверх базовой сцены (T-09):
 *  - ритмический слой (js/rhythm.js): удары музыки либо музыкальный псевдо-ритм;
 *  - полосы спектра по ролям: bass → масштаб/пинок, mid → дрейф, high → мерцание;
 *  - bloom-пасс (даунскейл + аддитивное наложение) — «дорогое» свечение;
 *  - параллакс от курсора/скролла (~14 px), «протирка» светом при смене сцены;
 *  - режимы качества (low/med/high) и «спокойный режим» (calm).
 *
 * Гарантии (docs/ARCHITECTURE.md):
 *  - базовая анимация процедурная и не зависит от Web Audio;
 *  - вкладка скрыта → rAF остановлен (CPU ~0);
 *  - prefers-reduced-motion → статичная композиция, один кадр на сцену;
 *  - DPR ≤ 2, кап fps 60 (адаптивно 30 на слабых устройствах);
 *  - смена сцены — кроссфейд ~800 мс с easing, без скачков.
 */

import { Rhythm } from "./rhythm.js";

const DPR_LIMIT = 2;
const CROSSFADE_MS = 800;
const FRAME_BUDGET_FAST = 1000 / 60;
const FRAME_BUDGET_SLOW = 1000 / 30;
const PARALLAX_PX = 14;

/** Целевая «живость» по состоянию плеера. */
const MOTION_BY_STATE = {
  playing: 1,
  loading: 0.45,
  paused: 0.1,
  idle: 0.16,
  error: 0.28,
};

/** Режимы качества: bloom и плотность эффектов. */
export const QUALITY_LEVELS = ["low", "med", "high"];

const BLOOM_BY_QUALITY = {
  low: { strength: 0, div: 4, passes: 0 },
  med: { strength: 0.38, div: 4, passes: 1 },
  high: { strength: 0.55, div: 3, passes: 2 },
};

/* ------------------------------------------------------------------
   Цвет и мелкие хелперы
   ------------------------------------------------------------------ */

function parseColor(input, fallback = [139, 124, 246]) {
  const value = String(input ?? "").trim();
  if (!value) return fallback;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const int = Number.parseInt(full.slice(0, 6), 16);
    if (Number.isFinite(int)) return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1].split(/[,\s/]+/).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) return parts.slice(0, 3);
  }

  return fallback;
}

function rgba([r, g, b], alpha) {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function mix(a, b, k) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOutCubic(k) {
  const t = clamp(k, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Мягкое свечение — спрайт вместо дорогого shadowBlur в цикле. */
function makeGlowSprite(color, size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, rgba(color, 0.85));
  gradient.addColorStop(0.35, rgba(color, 0.28));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

/** Радиальные бары спектра вокруг центра — «визуал = музыка». */
function drawSpectrumRing(ctx, cx, cy, rInner, rOuter, spectrum, palette, alpha, rotation = 0) {
  if (!spectrum || alpha <= 0.002) return;
  const bars = spectrum.length;
  const step = (Math.PI * 2) / bars;
  for (let i = 0; i < bars; i += 1) {
    const value = clamp(spectrum[i], 0, 1);
    const angle = rotation + i * step - Math.PI / 2;
    const len = (rOuter - rInner) * (0.12 + value * 0.88);
    const x0 = cx + Math.cos(angle) * rInner;
    const y0 = cy + Math.sin(angle) * rInner;
    const x1 = cx + Math.cos(angle) * (rInner + len);
    const y1 = cy + Math.sin(angle) * (rInner + len);
    ctx.strokeStyle = rgba(mix(palette.accent, palette.accent2, i / bars), alpha * (0.35 + value * 0.65));
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------
   Сцены. Параметры кадра: t, dt, w, h, alpha, motion, pulse, kick,
   hat, sparkle, bass, mid, high, speed, bpm, spectrum, palette, sprites.
   ------------------------------------------------------------------ */

const scenes = {
  /** Лаунж: медленные неоновые волны, отражение и блик горизонта. */
  waves: {
    parallaxScale: 0.6,
    init(scene) {
      const random = seededRandom(7);
      scene.layers = Array.from({ length: 4 }, (_, index) => ({
        amplitude: 18 + index * 16,
        frequency: 0.0032 - index * 0.00042,
        speed: 0.16 + index * 0.06,
        phase: random() * Math.PI * 2,
        offset: 0.62 + index * 0.09,
        width: 2.4 - index * 0.4,
      }));
      scene.motes = Array.from({ length: 9 }, () => ({
        x: random(),
        y: random(),
        r: 12 + random() * 40,
        speed: 0.008 + random() * 0.02,
        phase: random() * Math.PI * 2,
      }));
    },
    draw(ctx, { t, w, h, alpha, motion, pulse, kick, bass, mid, high, palette, sprites }) {
      const horizon = h * 0.78;

      ctx.globalCompositeOperation = "lighter";
      for (const layer of this.layers) {
        const baseY = h * layer.offset;
        // bass «качает» амплитуду, mid гонит дрейф
        const amp = layer.amplitude * (0.5 + motion * 0.9) * (1 + pulse * 0.25) * (1 + bass * 0.55);
        const drift = 1 + mid * 0.55;
        const waveY = (x, y0) =>
          y0 +
          Math.sin(x * layer.frequency + t * layer.speed * drift + layer.phase) * amp +
          Math.sin(x * layer.frequency * 2.3 + t * layer.speed * 1.7 * drift) * amp * 0.28;

        for (let pass = 0; pass < 2; pass += 1) {
          const color = pass === 0 ? palette.accent : palette.accent2;
          ctx.beginPath();
          for (let x = -20; x <= w + 20; x += 14) {
            const y = waveY(x, baseY);
            if (x === -20) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(color, (pass === 0 ? 0.09 : 0.16) * alpha);
          ctx.lineWidth = pass === 0 ? layer.width * 7 : layer.width;
          ctx.stroke();
        }

        // Отражение под горизонтом — тусклая зеркальная волна
        ctx.beginPath();
        for (let x = -20; x <= w + 20; x += 14) {
          const y = horizon + (horizon - waveY(x, baseY)) * 0.22;
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(palette.accent2, 0.07 * alpha);
        ctx.lineWidth = layer.width * 1.4;
        ctx.stroke();
      }

      // Блик у горизонта — вспыхивает с киком
      const glint = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 26);
      glint.addColorStop(0, rgba(palette.accent2, 0));
      glint.addColorStop(0.5, rgba(palette.accent2, (0.05 + kick * 0.12 + pulse * 0.03) * alpha));
      glint.addColorStop(1, rgba(palette.accent2, 0));
      ctx.fillStyle = glint;
      ctx.fillRect(0, horizon - 26, w, 52);

      if (sprites?.[0]) {
        for (const mote of this.motes) {
          const x = ((mote.x + t * mote.speed * 0.05) % 1.15) * w - 40;
          const y = h * mote.y + Math.sin(t * 0.3 + mote.phase) * 24;
          const size = mote.r * 2.4 * (1 + high * 0.25);
          ctx.globalAlpha = (0.16 + motion * 0.12) * alpha * (0.75 + high * 0.6);
          ctx.drawImage(sprites[mote.r > 34 ? 1 : 0], x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Клуб: кик-кольца, лучи из центра и эквалайзер по окружности. */
  rings: {
    parallaxScale: 1.2,
    init(scene) {
      scene.rings = [];
      scene.sparks = [];
      scene.lastKickBeat = -1;
      const random = seededRandom(21);
      scene.sparkSeeds = Array.from({ length: 26 }, () => ({
        x: random(),
        y: random(),
        h: 20 + random() * 90,
        speed: 0.6 + random() * 1.4,
      }));
      scene.rays = Array.from({ length: 16 }, (_, i) => ({
        angle: (i / 16) * Math.PI * 2,
        width: 1.4 + (i % 3),
      }));
    },
    draw(ctx, { t, dt, w, h, alpha, motion, palette, pulse, kick, hat, bass, speed, beatCount, spectrum, sprites }) {
      const cx = w * 0.5;
      const cy = h * 0.66;
      const maxR = Math.hypot(w, h) * 0.62;

      // Кик рождает кольцо — удар в такт (или по таймеру, когда кик «тихий»)
      if (motion > 0.12) {
        const spawnedByKick = kick > 0.5 && this.lastKickBeat !== beatCount;
        if (spawnedByKick) {
          this.lastKickBeat = beatCount;
          this.rings.push({ r: 8, life: 0, strong: 1 });
        }
        this.spawn = (this.spawn ?? 0) + dt;
        const period = 1.9 / (0.7 + speed * 0.5);
        if (this.spawn > period) {
          this.spawn = 0;
          this.rings.push({ r: 8, life: 0, strong: 0.35 });
        }
      }

      ctx.globalCompositeOperation = "lighter";

      // Лучи из центра — длина от баса
      const rayLen = maxR * (0.16 + bass * 0.42) * (0.5 + motion * 0.8);
      for (const ray of this.rays) {
        const cos = Math.cos(ray.angle + t * 0.06);
        const sin = Math.sin(ray.angle + t * 0.06);
        ctx.strokeStyle = rgba(palette.accent, (0.05 + bass * 0.1) * alpha);
        ctx.lineWidth = ray.width;
        ctx.beginPath();
        ctx.moveTo(cx + cos * 40, cy + sin * 26);
        ctx.lineTo(cx + cos * (40 + rayLen), cy + sin * (26 + rayLen * 0.55));
        ctx.stroke();
      }

      this.rings = this.rings.filter((ring) => ring.r < maxR);
      for (const ring of this.rings) {
        ring.r += dt * (120 + speed * 130) * (0.4 + motion);
        ring.life = Math.min(1, ring.r / maxR);
        const strength = ring.strong ?? 1;
        const a = (1 - ring.life) * (0.42 + pulse * 0.2) * strength;
        const color = mix(palette.accent, palette.accent2, ring.life);
        ctx.beginPath();
        ctx.ellipse(cx, cy, ring.r, ring.r * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color, a * alpha);
        ctx.lineWidth = 3.4 * (1 - ring.life * 0.6) * (0.7 + strength * 0.6);
        ctx.stroke();
      }

      // Стаккато: короткие вертикальные штрихи — под хэт
      const beat = (t * (1.6 + speed)) % 1;
      const beatAlpha = Math.pow(1 - beat, 3) * motion * 0.75 * (0.55 + hat * 0.7);
      if (beatAlpha > 0.01) {
        for (const spark of this.sparkSeeds) {
          const x = spark.x * w;
          const y = spark.y * h * 0.9;
          ctx.strokeStyle = rgba(spark.x > 0.5 ? palette.accent : palette.accent2, beatAlpha * 0.9 * alpha);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + spark.h * (0.3 + beat));
          ctx.stroke();
        }
      }

      // Эквалайзер по окружности
      drawSpectrumRing(ctx, cx, cy, 120 + pulse * 10, 300 + bass * 120, spectrum, palette, 0.5 * alpha, t * 0.12);

      // Центральный пульс — вспышка на кик
      const glow = sprites?.[0];
      if (glow) {
        const size = (200 + pulse * 150 + kick * 120) * (0.85 + motion * 0.5);
        ctx.globalAlpha = (0.45 + pulse * 0.25 + kick * 0.3) * alpha;
        ctx.drawImage(glow, cx - size / 2, cy - size / 2, size, size);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Романтика: световые протечки, «сердце» на удар, парящие искры. */
  bokeh: {
    parallaxScale: 1.4,
    init(scene) {
      const random = seededRandom(33);
      scene.orbs = Array.from({ length: 26 }, () => ({
        x: random(),
        y: random(),
        r: 18 + random() * 110,
        vx: (random() - 0.5) * 0.012,
        vy: -0.006 - random() * 0.014,
        warm: random() > 0.45,
        phase: random() * Math.PI * 2,
      }));
      scene.sparks = Array.from({ length: 14 }, () => ({
        x: random(),
        y: random(),
        speed: 0.02 + random() * 0.05,
        phase: random() * Math.PI * 2,
      }));
      scene.heart = 0;
      scene.heartEcho = 0;
      scene.echoDelay = -1;
      scene.lastHeartBeat = -1;
    },
    draw(ctx, { t, dt, w, h, alpha, motion, palette, kick, mid, high, sparkle, beatCount, sprites }) {
      // Двойной пульс-«сердце»: основной удар + мягкое эхо через ~220 мс
      if (kick > 0.45 && this.lastHeartBeat !== beatCount) {
        this.lastHeartBeat = beatCount;
        this.heart = 1;
        this.echoDelay = 0.22;
        this.heartEcho = 0;
      }
      this.heart *= Math.exp(-dt * 5.2);
      if (this.echoDelay > 0) {
        this.echoDelay -= dt;
        if (this.echoDelay <= 0) this.heartEcho = 0.62;
      }
      this.heartEcho *= Math.exp(-dt * 5.2);
      const heart = Math.max(this.heart, this.heartEcho);

      ctx.globalCompositeOperation = "lighter";

      // Тёплые light-leaks — крупные мягкие протечки света
      const leakPhase = t * 0.07;
      const leaks = [
        { sprite: 0, x: (0.22 + Math.sin(leakPhase) * 0.1) * w, y: (0.3 + Math.cos(leakPhase * 0.8) * 0.08) * h, size: w * 0.9 },
        { sprite: 1, x: (0.78 + Math.cos(leakPhase * 0.9) * 0.1) * w, y: (0.72 + Math.sin(leakPhase * 0.6) * 0.1) * h, size: w * 0.75 },
      ];
      for (const leak of leaks) {
        const sprite = sprites?.[leak.sprite];
        if (!sprite) continue;
        const size = leak.size * (0.9 + Math.sin(t * 0.2 + leak.sprite * 2) * 0.08 + heart * 0.12);
        ctx.globalAlpha = (0.1 + mid * 0.12 + heart * 0.1) * alpha;
        ctx.drawImage(sprite, leak.x - size / 2, leak.y - size / 2, size, size);
      }

      for (const orb of this.orbs) {
        orb.x += orb.vx * motion * 0.4 * (1 + mid * 0.6);
        orb.y += orb.vy * motion * 0.4 * (1 + mid * 0.6);
        if (orb.y < -0.2) {
          orb.y = 1.2;
          orb.x = Math.random();
        }
        if (orb.x < -0.2) orb.x = 1.2;
        if (orb.x > 1.2) orb.x = -0.2;

        const breathe = 0.75 + Math.sin(t * 0.4 + orb.phase) * 0.16;
        const size = orb.r * 3.1 * breathe * (1 + heart * 0.16);
        const x = orb.x * w;
        const y = orb.y * h;
        const sprite = sprites?.[orb.warm ? 0 : 1];
        if (!sprite) continue;
        ctx.globalAlpha = (orb.r > 70 ? 0.2 : 0.34) * (0.6 + motion * 0.7) * alpha;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }

      // Парящие искры — скорость и яркость от верхних частот
      for (const spark of this.sparks) {
        spark.y -= spark.speed * motion * dt * 6 * (1 + high * 1.6);
        spark.x += Math.sin(t * 0.6 + spark.phase) * 0.0006;
        if (spark.y < -0.05) {
          spark.y = 1.05;
          spark.x = Math.random();
        }
        const twinkle = 0.5 + Math.sin(t * 2 + spark.phase * 3) * 0.5;
        ctx.fillStyle = rgba(palette.accent2, (0.12 + sparkle * 0.3) * twinkle * alpha);
        ctx.beginPath();
        ctx.arc(spark.x * w, spark.y * h, 1.4 + high * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Космос: параллакс-глубина, метеоры, туманности и мерцание. */
  stars: {
    parallaxScale: 1.6,
    init(scene) {
      const random = seededRandom(99);
      scene.layers = [
        { count: 130, depth: 0.25, size: 1.1 },
        { count: 80, depth: 0.6, size: 1.7 },
        { count: 42, depth: 1, size: 2.4 },
      ].map((layer) => ({
        ...layer,
        items: Array.from({ length: layer.count }, () => ({
          x: random(),
          y: random(),
          phase: random() * Math.PI * 2,
          twinkle: 0.4 + random() * 0.6,
        })),
      }));
      scene.nebulae = Array.from({ length: 3 }, () => ({
        x: random(),
        y: random(),
        r: 180 + random() * 260,
        warm: random() > 0.5,
        drift: (random() - 0.5) * 0.006,
      }));
      scene.meteor = null;
      scene.meteorTimer = 4 + random() * 8;
      scene.lastMeteorBeat = -1;
    },
    draw(ctx, { t, dt, w, h, alpha, motion, palette, pulse, kick, mid, high, beatCount, sprites, parallax }) {
      const px = parallax?.x ?? 0;
      const py = parallax?.y ?? 0;
      ctx.globalCompositeOperation = "lighter";

      for (const cloud of this.nebulae) {
        cloud.x = (cloud.x + cloud.drift * dt * motion + 1) % 1;
        const sprite = sprites?.[cloud.warm ? 1 : 2];
        if (!sprite) continue;
        const size = cloud.r * 2.1;
        // Туманности дышат от средних частот
        ctx.globalAlpha = (0.2 + pulse * 0.08 + mid * 0.1) * alpha;
        ctx.drawImage(sprite, cloud.x * w - size / 2 + px * 0.6, cloud.y * h - size / 2 + py * 0.6, size, size);
      }

      for (const layer of this.layers) {
        // Параллакс-глубина: ближние звёзды смещаются сильнее
        const lx = px * (0.35 + layer.depth * 1.15);
        const ly = py * (0.35 + layer.depth * 1.15);
        for (const star of layer.items) {
          star.x -= layer.depth * 0.006 * dt * motion * 6;
          if (star.x < -0.02) star.x = 1.02;
          const twinkle = 0.45 + Math.sin(t * (0.6 + layer.depth) + star.phase) * 0.35 * star.twinkle * (0.7 + high * 1.1);
          const a = Math.max(0, twinkle) * (0.7 + motion * 0.5);
          const size = layer.size * 1.35 * (1 + pulse * 0.3 + kick * 0.2);
          ctx.fillStyle = rgba(layer.depth > 0.8 ? palette.accent2 : [255, 255, 255], a * alpha);
          ctx.beginPath();
          ctx.arc(star.x * w + lx, star.y * h + ly, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Метеоры: редкие сами, чаще — на сильный кик
      this.meteorTimer -= dt * (0.4 + motion);
      const kickLaunch = kick > 0.72 && this.lastMeteorBeat !== beatCount;
      if (kickLaunch) this.lastMeteorBeat = beatCount;
      if ((this.meteorTimer <= 0 || kickLaunch) && !this.meteor) {
        this.meteor = {
          x: Math.random() * w * 0.8,
          y: Math.random() * h * 0.4,
          life: 0,
          trail: kickLaunch ? 170 : 110,
        };
        this.meteorTimer = 9 + Math.random() * 12;
      }
      if (this.meteor) {
        const meteor = this.meteor;
        meteor.life += dt * 1.6;
        const x = meteor.x + meteor.life * 260;
        const y = meteor.y + meteor.life * 130;
        const a = Math.max(0, 0.5 - Math.abs(meteor.life - 0.5) * 0.8);
        const gradient = ctx.createLinearGradient(x, y, x - meteor.trail, y - meteor.trail * 0.5);
        gradient.addColorStop(0, rgba(palette.accent2, a * alpha));
        gradient.addColorStop(1, rgba(palette.accent2, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - meteor.trail, y - meteor.trail * 0.5);
        ctx.stroke();
        if (meteor.life > 1.2) this.meteor = null;
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Винил: пластинка в темпе, тонарм, треск пыли, блик этикетки. */
  vinyl: {
    parallaxScale: 0.8,
    init(scene) {
      const random = seededRandom(55);
      scene.dust = Array.from({ length: 60 }, () => ({
        a: random() * Math.PI * 2,
        r: 0.3 + random() * 0.7,
        s: 0.4 + random() * 1.2,
        seed: random(),
      }));
      scene.rotation = 0;
    },
    draw(ctx, { t, dt, w, h, alpha, motion, palette, pulse, kick, high, sparkle, bpm, speed, sprites }) {
      const cx = w * 0.86;
      const cy = h * 0.52;
      const radius = Math.min(w, h) * (0.62 + pulse * 0.02 + kick * 0.012);

      // Вращение синхронно темпу: один оборот за 8 долей ≈ пластинка 33⅓
      this.rotation += dt * (bpm / 60) * ((Math.PI * 2) / 8) * (0.25 + motion * 0.75) * (0.6 + speed * 0.25);
      const rotation = this.rotation;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Тело пластинки
      const body = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
      body.addColorStop(0, rgba(mix(palette.bg, palette.accent, 0.12), 0.5 * alpha));
      body.addColorStop(1, rgba(palette.bg, 0.05 * alpha));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();

      // Дорожки
      const grooves = 34;
      for (let i = 0; i < grooves; i += 1) {
        const k = i / grooves;
        const r = radius * (0.3 + k * 0.68);
        const shimmer = 0.05 + Math.sin(k * 26 + t * 0.6) * 0.03;
        ctx.strokeStyle = rgba(mix(palette.accent, palette.accent2, k), shimmer * (0.5 + motion) * alpha);
        ctx.lineWidth = i % 5 === 0 ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Этикетка
      const label = ctx.createLinearGradient(-radius * 0.24, -radius * 0.24, radius * 0.24, radius * 0.24);
      label.addColorStop(0, rgba(palette.accent, 0.5 * alpha));
      label.addColorStop(1, rgba(palette.accent2, 0.34 * alpha));
      ctx.fillStyle = label;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(palette.bg, 0.85 * alpha);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.035, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Тонарм: шарнир справа сверху, головка — у внешнего края дорожек
      const pivotX = w * 1.02;
      const pivotY = h * 0.18;
      const armAngle = -0.62 + Math.sin(t * 0.05) * 0.06 + Math.sin(rotation * 0.5) * 0.02;
      const armLen = Math.min(w, h) * 0.58;
      const headX = pivotX + Math.cos(armAngle) * armLen;
      const headY = pivotY - Math.sin(armAngle) * armLen * 0.85 + kick * 2.5;
      ctx.strokeStyle = rgba(palette.accent2, 0.34 * alpha);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.lineTo(headX, headY);
      ctx.stroke();
      ctx.fillStyle = rgba(palette.accent, 0.5 * alpha);
      ctx.beginPath();
      ctx.arc(pivotX, pivotY, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(mix(palette.accent, palette.accent2, 0.5), 0.6 * alpha);
      ctx.fillRect(headX - 9, headY - 6, 18, 12);
      ctx.lineCap = "butt";

      // Блик — поверх, не вращается вместе с пластинкой
      ctx.globalCompositeOperation = "lighter";
      const sweep = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      sweep.addColorStop(0, rgba(palette.accent, 0));
      sweep.addColorStop(0.48 + Math.sin(t * 0.25) * 0.05, rgba(palette.accent2, (0.07 + pulse * 0.04 + kick * 0.08) * alpha));
      sweep.addColorStop(1, rgba(palette.accent, 0));
      ctx.fillStyle = sweep;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Блик по этикетке — короткая вспышка на кик
      if (kick > 0.02) {
        const labelGlow = sprites?.[1];
        if (labelGlow) {
          const size = radius * (0.5 + kick * 0.35);
          ctx.globalAlpha = kick * 0.35 * alpha;
          ctx.drawImage(labelGlow, cx - size / 2, cy - size / 2, size, size);
        }
      }

      // Пылинки и «треск» — всполохи от верхних частот
      for (const speck of this.dust) {
        const a = speck.a + rotation * 0.4;
        const r = radius * speck.r;
        const crackle = sparkle > 0.45 && speck.seed > 1 - Math.min(0.5, sparkle * 0.5);
        const base = 0.08 + motion * 0.06 + high * 0.05;
        ctx.fillStyle = rgba(palette.accent, (crackle ? base + 0.3 : base) * alpha);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, speck.s * (crackle ? 1.8 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },
};

/* ------------------------------------------------------------------
   Движок
   ------------------------------------------------------------------ */

export class Atmosphere {
  constructor(canvas, { root = document.documentElement, quality, calm } = {}) {
    this.canvas = canvas;
    this.root = root;
    this.ctx = canvas?.getContext?.("2d", { alpha: true }) ?? null;
    this.disabled = !this.ctx;

    this.sceneId = "waves";
    this.nextSceneId = null;
    this.fade = 1;
    this.time = 0;
    this.clock = 0;
    this.raf = null;
    this.lastFrame = 0;
    this.frameBudget = FRAME_BUDGET_FAST;
    this.frameDt = 0.016;
    this.slowFrames = 0;
    this.energy = 3;
    this.intensity = 0.75;
    this.playerState = "idle";
    this.motion = 0.3;
    this.levels = { bass: 0, mid: 0, high: 0, overall: 0 };
    this.reactive = false;
    this.rhythm = new Rhythm();
    this.quality = Atmosphere.normalizeQuality(quality);
    this.calm = Boolean(calm);
    this.parallax = { x: 0, y: 0 };
    this.pointer = { x: 0, y: 0 };
    this.scrollBias = 0;
    this.bufferDiv = null;

    this.applyVisual();
    if (this.disabled) return;

    this.reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false, addEventListener() {} };
    this.palette = this.readPalette();
    this.sprites = {};

    this.paintSprites();
    this.active = this.prepareScene(this.sceneId);

    this.onVisibility = () => {
      if (document.hidden) this.stop();
      else this.start();
    };
    this.onResize = () => this.resize();
    this.onMotionChange = (event) => {
      this.reduceMotionValue = event.matches;
      if (event.matches) {
        this.stop();
        this.renderStatic();
      } else {
        this.start();
      }
    };
    this.onPointerMove = (event) => {
      const x = event.clientX ?? event.touches?.[0]?.clientX;
      const y = event.clientY ?? event.touches?.[0]?.clientY;
      if (typeof x === "number" && typeof y === "number") {
        this.pointer.x = clamp((x / Math.max(1, this.width || window.innerWidth)) * 2 - 1, -1, 1);
        this.pointer.y = clamp((y / Math.max(1, this.height || window.innerHeight)) * 2 - 1, -1, 1);
      }
    };
    this.onScroll = () => {
      this.scrollBias = clamp((window.scrollY || 0) / 900, -1, 1);
    };

    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    window.addEventListener("scroll", this.onScroll, { passive: true });
    this.reduceMotion.addEventListener?.("change", this.onMotionChange);
    this.reduceMotionValue = this.reduceMotion.matches;

    this.resize();
    this.onScroll();
  }

  static normalizeQuality(value) {
    return QUALITY_LEVELS.includes(value) ? value : "med";
  }

  /* --- Публичный API --- */

  setScene(sceneId) {
    if (!scenes[sceneId] || sceneId === this.sceneId) {
      this.palette = this.readPalette();
      this.paintSprites();
      if (this.reduceMotionValue) this.renderStatic();
      return;
    }
    this.palette = this.readPalette();
    this.outgoing = this.active;
    this.active = this.prepareScene(sceneId);
    this.sceneId = sceneId;
    this.fade = 0;
    this.paintSprites();
    if (this.reduceMotionValue) this.renderStatic();
  }

  setEnergy(energy) {
    const value = Number(energy);
    this.energy = Number.isFinite(value) ? Math.min(5, Math.max(1, value)) : 3;
  }

  setIntensity(value) {
    const next = Number(value);
    this.intensity = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : 0.75;
    this.applyVisual();
    if (this.reduceMotionValue) this.renderStatic();
  }

  /** Режим качества сцены: low (без bloom) → high (глубокий bloom). */
  setQuality(value) {
    this.quality = Atmosphere.normalizeQuality(value);
    if (this.reduceMotionValue) this.renderStatic();
  }

  /** «Спокойный режим»: уменьшает и движение, и амплитуду ритмических пиков. */
  setCalm(value) {
    this.calm = Boolean(value);
    if (this.reduceMotionValue) this.renderStatic();
  }

  /**
   * Мгновенная видимая отдача от ползунка: интенсивность управляет
   * «проявленностью» сцены (opacity canvas) — от почти незаметной дымки
   * до полного свечения. Скорость и амплитуда меняются отдельно.
   */
  applyVisual() {
    if (this.canvas?.style) {
      this.canvas.style.opacity = (0.22 + this.intensity * 0.78).toFixed(3);
    }
  }

  setPlayerState(state) {
    this.playerState = MOTION_BY_STATE[state] ? state : "idle";
  }

  /** Данные аудио-анализатора (опционально). Без них сцена живёт процедурно. */
  setLevels(levels) {
    if (!levels) {
      this.reactive = false;
      this.rhythm.setSpectrum(null);
      return;
    }
    this.reactive = true;
    for (const key of ["bass", "mid", "high", "overall"]) {
      const value = Number(levels[key]);
      if (Number.isFinite(value)) this.levels[key] = Math.min(1, Math.max(0, value));
    }
    this.rhythm.setSpectrum(levels.spectrum ?? null);
  }

  start() {
    if (this.disabled || this.raf !== null || this.reduceMotionValue) return;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("scroll", this.onScroll);
    this.reduceMotion?.removeEventListener?.("change", this.onMotionChange);
  }

  /* --- Внутренности --- */

  prepareScene(id) {
    const scene = { id, ...scenes[id] };
    scene.init?.(scene);
    return scene;
  }

  readPalette() {
    const styles = getComputedStyle(this.root);
    const read = (name, fallback) => parseColor(styles.getPropertyValue(name), fallback);
    return {
      accent: read("--accent", [139, 124, 246]),
      accent2: read("--accent-2", [94, 234, 212]),
      glow1: read("--glow-1", [139, 124, 246]),
      glow2: read("--glow-2", [94, 234, 212]),
      bg: read("--bg-0", [11, 15, 30]),
    };
  }

  paintSprites() {
    const { accent, accent2, glow1, glow2 } = this.palette;
    const common = [makeGlowSprite(accent), makeGlowSprite(accent2)].filter(Boolean);
    this.sprites = {
      waves: common,
      rings: [makeGlowSprite(mix(accent, accent2, 0.4))].filter(Boolean),
      bokeh: [makeGlowSprite(glow1), makeGlowSprite(glow2)].filter(Boolean),
      stars: [makeGlowSprite(accent), makeGlowSprite(glow2), makeGlowSprite(glow1)].filter(Boolean),
      vinyl: common,
    };
  }

  resize() {
    if (this.disabled) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.sceneCanvas = null; // переcоздадим под новый размер
    if (this.reduceMotionValue) this.renderStatic();
  }

  /** Скорость сцены: энергия станции × интенсивность. Диапазон широкий, чтобы
   *  ползунок читался: на нуле сцена почти стоит, на максимуме — полная живость. */
  get speed() {
    return (0.5 + this.energy * 0.1) * (0.18 + this.intensity * 1.25);
  }

  updateMotion(dt) {
    const target = MOTION_BY_STATE[this.playerState] ?? 0.3;
    const scaled = target * (0.08 + this.intensity * 0.92) * (this.calm ? 0.7 : 1);
    // Плавное приближение: никакого «скачка» при паузе/воспроизведении
    this.motion += (scaled - this.motion) * Math.min(1, dt * 1.6);
  }

  updateParallax(dt) {
    const k = Math.min(1, dt * 2.2);
    this.parallax.x += (this.pointer.x - this.parallax.x) * k;
    this.parallax.y += (this.pointer.y * 0.7 + this.scrollBias * 0.6 - this.parallax.y) * k;
  }

  /** Offscreen-буферы: сцена + два промежуточных для bloom. */
  ensureBuffers() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cfg = BLOOM_BY_QUALITY[this.quality] ?? BLOOM_BY_QUALITY.med;
    if (
      this.sceneCanvas &&
      this.sceneCanvas.width === w &&
      this.sceneCanvas.height === h &&
      this.bufferDiv === cfg.div
    ) return;

    const make = (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };

    this.sceneCanvas = make(w, h);
    this.sceneCtx = this.sceneCanvas.getContext("2d");
    if (this.sceneCtx) this.sceneCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const aw = Math.max(8, Math.round(w / cfg.div));
    const ah = Math.max(8, Math.round(h / cfg.div));
    this.bloomA = make(aw, ah);
    this.bloomACtx = this.bloomA.getContext("2d");
    this.bloomB = make(Math.max(8, aw >> 1), Math.max(8, ah >> 1));
    this.bloomBCtx = this.bloomB.getContext("2d");
    this.bufferDiv = cfg.div;
  }

  bloomConfig() {
    return BLOOM_BY_QUALITY[this.quality] ?? BLOOM_BY_QUALITY.med;
  }

  /** Собрать картинку: сцена → offscreen → + аддитивный bloom на основной канвас. */
  composite(outgoing, fadeK) {
    const cfg = this.bloomConfig();
    const useBloom = cfg.strength > 0 && this.sceneCtx;
    const target = useBloom ? this.sceneCtx : this.ctx;
    const w = this.width;
    const h = this.height;

    target.clearRect(0, 0, w, h);
    this.paintScene(target, outgoing, 1 - fadeK);
    this.paintScene(target, this.active, outgoing ? fadeK : 1);
    if (outgoing && fadeK < 1) this.drawWipe(target, fadeK);

    if (!useBloom) return;

    const { bloomA, bloomACtx, bloomB, bloomBCtx } = this;
    bloomACtx.clearRect(0, 0, bloomA.width, bloomA.height);
    bloomACtx.globalCompositeOperation = "source-over";
    bloomACtx.drawImage(this.sceneCanvas, 0, 0, bloomA.width, bloomA.height);
    if (cfg.passes > 1 && bloomBCtx) {
      bloomBCtx.clearRect(0, 0, bloomB.width, bloomB.height);
      bloomBCtx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
      bloomACtx.globalCompositeOperation = "lighter";
      bloomACtx.globalAlpha = 0.55;
      bloomACtx.drawImage(bloomB, 0, 0, bloomA.width, bloomA.height);
      bloomACtx.globalAlpha = 1;
      bloomACtx.globalCompositeOperation = "source-over";
    }

    const ctx = this.ctx;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.sceneCanvas, 0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = cfg.strength * (this.calm ? 0.55 : 1);
    ctx.drawImage(bloomA, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  paintScene(target, scene, alpha) {
    if (!scene || alpha <= 0.002) return;
    const scale = scene.parallaxScale ?? 1;
    target.save();
    target.translate(this.parallax.x * PARALLAX_PX * scale, this.parallax.y * PARALLAX_PX * scale);
    scene.draw?.call(scene, target, { ...this.buildParams(alpha), sprites: this.sprites[scene.id] ?? [] });
    target.restore();
  }

  buildParams(alpha) {
    const calm = this.calm;
    const calmScale = (normal, softened) => (calm ? softened : normal);
    const bass = this.reactive ? this.levels.bass : this.rhythm.kick;
    const mid = this.reactive ? this.levels.mid : 0.28 + Math.sin(this.clock * 0.21) * 0.12;
    const high = this.reactive ? this.levels.high : this.rhythm.sparkle;

    return {
      t: this.time,
      dt: this.frameDt,
      w: this.width,
      h: this.height,
      alpha,
      motion: this.motion,
      // Calm сглаживает именно музыкальные пики, а не только общий glow.
      pulse: this.rhythm.pulse * calmScale(1, 0.72),
      kick: this.rhythm.kick * calmScale(1, 0.2),
      snare: this.rhythm.snare * calmScale(1, 0.55),
      hat: this.rhythm.hat * calmScale(1, 0.45),
      sparkle: this.rhythm.sparkle * calmScale(1, 0.35),
      // Роли полос: bass → пинок/масштаб, mid → дрейф, high → мерцание.
      bass: bass * calmScale(1, 0.65),
      mid: mid * calmScale(1, 0.75),
      high: high * calmScale(1, 0.45),
      speed: this.speed,
      bpm: this.rhythm.bpm,
      beatPhase: this.rhythm.beatPhase,
      beatCount: this.rhythm.beatCount,
      spectrum: this.rhythm.spectrum,
      reactive: this.reactive,
      palette: this.palette,
      levels: this.levels,
      parallax: this.parallax,
    };
  }

  /** «Протирка» светом при смене сцены — мотив перехода, а не голый кроссфейд. */
  drawWipe(target, k) {
    const { width: w, height: h } = this;
    const sweep = (k * 1.5 - 0.25) * w;
    const gradient = target.createLinearGradient(sweep - w * 0.35, -h * 0.2, sweep + w * 0.35, h * 1.2);
    const strength = Math.sin(Math.PI * clamp(k, 0, 1)) * (this.calm ? 0.06 : 0.12);
    gradient.addColorStop(0, rgba(this.palette.accent, 0));
    gradient.addColorStop(0.5, rgba(mix(this.palette.accent, this.palette.accent2, 0.5), strength));
    gradient.addColorStop(1, rgba(this.palette.accent2, 0));
    target.globalCompositeOperation = "lighter";
    target.fillStyle = gradient;
    target.fillRect(0, 0, w, h);
    target.globalCompositeOperation = "source-over";
  }

  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop);
    const elapsed = now - this.lastFrame;
    if (elapsed < this.frameBudget) return;

    const dt = Math.min(0.06, elapsed / 1000);
    this.frameDt = dt;
    this.lastFrame = now - (elapsed % this.frameBudget);

    // Адаптивный кап fps: если не успеваем — снижаем до 30
    if (elapsed > 26) {
      this.slowFrames += 1;
      if (this.slowFrames > 90) this.frameBudget = FRAME_BUDGET_SLOW;
    } else if (this.slowFrames > 0) {
      this.slowFrames -= 1;
    }

    this.clock += dt;
    this.time += dt * this.speed;
    this.updateMotion(dt);
    this.updateParallax(dt);
    this.rhythm.update(dt, {
      reactive: this.reactive,
      bass: this.levels.bass,
      mid: this.levels.mid,
      high: this.levels.high,
      energy: this.energy,
      intensity: this.intensity,
      motion: this.motion,
    });

    if (this.fade < 1) this.fade = Math.min(1, this.fade + (dt * 1000) / CROSSFADE_MS);

    this.draw(this.fade < 1 ? this.outgoing : null);
  };

  renderStatic() {
    if (this.disabled) return;
    this.motion = MOTION_BY_STATE[this.playerState] ?? 0.3;
    this.rhythm.update(0.016, {
      reactive: this.reactive,
      bass: this.levels.bass,
      mid: this.levels.mid,
      high: this.levels.high,
      energy: this.energy,
      intensity: this.intensity,
      motion: this.motion,
    });
    this.draw(null);
  }

  draw(outgoing) {
    const ctx = this.ctx;
    if (!ctx) return;

    this.ensureBuffers();
    const fadeK = easeInOutCubic(this.fade);
    this.composite(outgoing, outgoing ? fadeK : 1);
  }
}

export { scenes as atmosphereScenes };
export default Atmosphere;
