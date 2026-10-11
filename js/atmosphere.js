/**
 * JOER — атмосферный движок (T-06).
 *
 * Canvas-слой под контентом. Сцена выбирается по теме, «живость» — по энергии
 * станции, состоянию плеера и пользовательской интенсивности.
 *
 * Гарантии (docs/ARCHITECTURE.md):
 *  - базовая анимация процедурная и не зависит от Web Audio;
 *  - вкладка скрыта → rAF остановлен (CPU ~0);
 *  - prefers-reduced-motion → статичная композиция, один кадр на сцену;
 *  - DPR ≤ 2, кап fps 60 (адаптивно 30 на слабых устройствах);
 *  - смена сцены — кроссфейд ~800 мс, без скачков.
 */

const DPR_LIMIT = 2;
const CROSSFADE_MS = 800;
const FRAME_BUDGET_FAST = 1000 / 60;
const FRAME_BUDGET_SLOW = 1000 / 30;

/** Целевая «живость» по состоянию плеера. */
const MOTION_BY_STATE = {
  playing: 1,
  loading: 0.45,
  paused: 0.1,
  idle: 0.16,
  error: 0.28,
};

/* ------------------------------------------------------------------
   Цвет
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

/* ------------------------------------------------------------------
   Сцены
   ------------------------------------------------------------------ */

const scenes = {
  /** Лаунж: медленные неоновые волны. */
  waves: {
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
    draw(ctx, { t, w, h, motion, palette, pulse, sprites }) {
      ctx.globalCompositeOperation = "lighter";
      for (const layer of this.layers) {
        const baseY = h * layer.offset;
        const amp = layer.amplitude * (0.5 + motion * 0.9) * (1 + pulse * 0.25);
        for (let pass = 0; pass < 2; pass += 1) {
          const color = pass === 0 ? palette.accent : palette.accent2;
          ctx.beginPath();
          for (let x = -20; x <= w + 20; x += 14) {
            const y =
              baseY +
              Math.sin(x * layer.frequency + t * layer.speed + layer.phase) * amp +
              Math.sin(x * layer.frequency * 2.3 + t * layer.speed * 1.7) * amp * 0.28;
            if (x === -20) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = rgba(color, pass === 0 ? 0.09 : 0.16);
          ctx.lineWidth = pass === 0 ? layer.width * 7 : layer.width;
          ctx.stroke();
        }
      }

      if (sprites?.[0]) {
        for (const mote of this.motes) {
          const x = ((mote.x + t * mote.speed * 0.05) % 1.15) * w - 40;
          const y = h * mote.y + Math.sin(t * 0.3 + mote.phase) * 24;
          const size = mote.r * 2.4;
          ctx.globalAlpha = 0.16 + motion * 0.12;
          ctx.drawImage(sprites[mote.r > 34 ? 1 : 0], x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Клуб: пульсирующие кольца и мягкое стаккато. */
  rings: {
    init(scene) {
      scene.rings = [];
      scene.sparks = [];
      const random = seededRandom(21);
      scene.sparkSeeds = Array.from({ length: 26 }, () => ({
        x: random(),
        y: random(),
        h: 20 + random() * 90,
        speed: 0.6 + random() * 1.4,
      }));
    },
    draw(ctx, { t, dt, w, h, motion, palette, pulse, speed, sprites }) {
      const cx = w * 0.5;
      const cy = h * 0.66;
      const maxR = Math.hypot(w, h) * 0.62;
      const period = 1.9 / (0.7 + speed * 0.5);

      if (motion > 0.12) {
        this.spawn = (this.spawn ?? 0) + dt;
        if (this.spawn > period) {
          this.spawn = 0;
          this.rings.push({ r: 8, life: 0 });
        }
      }

      ctx.globalCompositeOperation = "lighter";
      this.rings = this.rings.filter((ring) => ring.r < maxR);
      for (const ring of this.rings) {
        ring.r += dt * (120 + speed * 130) * (0.4 + motion);
        ring.life = Math.min(1, ring.r / maxR);
        const alpha = (1 - ring.life) * (0.22 + pulse * 0.12);
        const color = mix(palette.accent, palette.accent2, ring.life);
        ctx.beginPath();
        ctx.ellipse(cx, cy, ring.r, ring.r * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 2.4 * (1 - ring.life * 0.6);
        ctx.stroke();
      }

      // Стаккато: короткие вертикальные штрихи, мягко и не чаще ритма
      const beat = (t * (1.6 + speed)) % 1;
      const beatAlpha = Math.pow(1 - beat, 3) * motion * 0.4;
      if (beatAlpha > 0.01) {
        for (const spark of this.sparkSeeds) {
          const x = spark.x * w;
          const y = spark.y * h * 0.9;
          ctx.strokeStyle = rgba(spark.x > 0.5 ? palette.accent : palette.accent2, beatAlpha * 0.5);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + spark.h * (0.3 + beat));
          ctx.stroke();
        }
      }

      // Центральный пульс
      const glow = sprites?.[0];
      if (glow) {
        const size = (160 + pulse * 120) * (0.8 + motion * 0.5);
        ctx.globalAlpha = 0.3 + pulse * 0.2;
        ctx.drawImage(glow, cx - size / 2, cy - size / 2, size, size);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Романтика: мягкое боке и тёплый дрейф. */
  bokeh: {
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
    },
    draw(ctx, { t, w, h, motion, palette, sprites }) {
      ctx.globalCompositeOperation = "lighter";
      for (const orb of this.orbs) {
        orb.x += orb.vx * motion * 0.4;
        orb.y += orb.vy * motion * 0.4;
        if (orb.y < -0.2) {
          orb.y = 1.2;
          orb.x = Math.random();
        }
        if (orb.x < -0.2) orb.x = 1.2;
        if (orb.x > 1.2) orb.x = -0.2;

        const breathe = 0.75 + Math.sin(t * 0.4 + orb.phase) * 0.16;
        const size = orb.r * 2.6 * breathe;
        const x = orb.x * w;
        const y = orb.y * h;
        const sprite = sprites?.[orb.warm ? 0 : 1];
        if (!sprite) continue;
        ctx.globalAlpha = (orb.r > 70 ? 0.1 : 0.16) * (0.5 + motion * 0.7);
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Космос: звёздное поле, туманности, редкие метеоры. */
  stars: {
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
    },
    draw(ctx, { t, dt, w, h, motion, palette, pulse, sprites }) {
      ctx.globalCompositeOperation = "lighter";

      for (const cloud of this.nebulae) {
        cloud.x = (cloud.x + cloud.drift * dt * motion + 1) % 1;
        const sprite = sprites?.[cloud.warm ? 1 : 2];
        if (!sprite) continue;
        const size = cloud.r * 2;
        ctx.globalAlpha = 0.1 + pulse * 0.04;
        ctx.drawImage(sprite, cloud.x * w - size / 2, cloud.y * h - size / 2, size, size);
      }

      for (const layer of this.layers) {
        for (const star of layer.items) {
          star.x -= layer.depth * 0.006 * dt * motion * 6;
          if (star.x < -0.02) star.x = 1.02;
          const twinkle = 0.45 + Math.sin(t * (0.6 + layer.depth) + star.phase) * 0.35 * star.twinkle;
          const alpha = Math.max(0, twinkle) * (0.35 + motion * 0.5);
          const size = layer.size * (1 + pulse * 0.3);
          ctx.fillStyle = rgba(layer.depth > 0.8 ? palette.accent2 : [255, 255, 255], alpha);
          ctx.beginPath();
          ctx.arc(star.x * w, star.y * h, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Метеор — редкий, чтобы не тревожить
      this.meteorTimer -= dt * (0.4 + motion);
      if (this.meteorTimer <= 0 && !this.meteor) {
        this.meteor = { x: Math.random() * w * 0.8, y: Math.random() * h * 0.4, life: 0 };
        this.meteorTimer = 9 + Math.random() * 12;
      }
      if (this.meteor) {
        const meteor = this.meteor;
        meteor.life += dt * 1.6;
        const x = meteor.x + meteor.life * 260;
        const y = meteor.y + meteor.life * 130;
        const alpha = Math.max(0, 0.5 - Math.abs(meteor.life - 0.5) * 0.8);
        const gradient = ctx.createLinearGradient(x, y, x - 90, y - 45);
        gradient.addColorStop(0, rgba(palette.accent2, alpha));
        gradient.addColorStop(1, rgba(palette.accent2, 0));
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 90, y - 45);
        ctx.stroke();
        if (meteor.life > 1.2) this.meteor = null;
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    },
  },

  /** Винил: вращающаяся пластинка с тёплыми бликами. */
  vinyl: {
    init(scene) {
      const random = seededRandom(55);
      scene.dust = Array.from({ length: 60 }, () => ({
        a: random() * Math.PI * 2,
        r: 0.3 + random() * 0.7,
        s: 0.4 + random() * 1.2,
      }));
    },
    draw(ctx, { t, w, h, motion, palette, pulse, speed }) {
      const cx = w * 0.86;
      const cy = h * 0.52;
      const radius = Math.min(w, h) * (0.62 + pulse * 0.02);
      const rotation = t * (0.05 + speed * 0.05) * (0.3 + motion);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Тело пластинки
      const body = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
      body.addColorStop(0, rgba(mix(palette.bg, palette.accent, 0.12), 0.5));
      body.addColorStop(1, rgba(palette.bg, 0.05));
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
        ctx.strokeStyle = rgba(mix(palette.accent, palette.accent2, k), shimmer * (0.5 + motion));
        ctx.lineWidth = i % 5 === 0 ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Этикетка
      const label = ctx.createLinearGradient(-radius * 0.24, -radius * 0.24, radius * 0.24, radius * 0.24);
      label.addColorStop(0, rgba(palette.accent, 0.5));
      label.addColorStop(1, rgba(palette.accent2, 0.34));
      ctx.fillStyle = label;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(palette.bg, 0.85);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.035, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Блик — поверх, не вращается вместе с пластинкой
      ctx.globalCompositeOperation = "lighter";
      const sweep = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      sweep.addColorStop(0, rgba(palette.accent, 0));
      sweep.addColorStop(0.48 + Math.sin(t * 0.25) * 0.05, rgba(palette.accent2, 0.07 + pulse * 0.04));
      sweep.addColorStop(1, rgba(palette.accent, 0));
      ctx.fillStyle = sweep;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Пылинки в тёплом свете
      for (const speck of this.dust) {
        const a = speck.a + rotation * 0.4;
        const r = radius * speck.r;
        ctx.fillStyle = rgba(palette.accent, 0.08 + motion * 0.06);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, speck.s, 0, Math.PI * 2);
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
  constructor(canvas, { root = document.documentElement, quality } = {}) {
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
    this.slowFrames = 0;
    this.energy = 3;
    this.intensity = 0.75;
    this.playerState = "idle";
    this.motion = 0.3;
    this.levels = { bass: 0, mid: 0, high: 0, overall: 0 };
    this.reactive = false;
    this.quality = quality ?? (typeof navigator !== "undefined" && (navigator.deviceMemory ?? 8) <= 4 ? 0.6 : 1);

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

    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("resize", this.onResize);
    this.reduceMotion.addEventListener?.("change", this.onMotionChange);
    this.reduceMotionValue = this.reduceMotion.matches;

    this.resize();
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
      return;
    }
    this.reactive = true;
    for (const key of ["bass", "mid", "high", "overall"]) {
      const value = Number(levels[key]);
      if (Number.isFinite(value)) this.levels[key] = Math.min(1, Math.max(0, value));
    }
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
    if (this.reduceMotionValue) this.renderStatic();
  }

  /** Скорость сцены: энергия станции × интенсивность. Диапазон широкий, чтобы
   *  ползунок читался: на нуле сцена почти стоит, на максимуме — полная живость. */
  get speed() {
    return (0.5 + this.energy * 0.1) * (0.18 + this.intensity * 1.25);
  }

  /** Псевдо-ритм, когда аудио-реактивности нет. */
  synthPulse(t) {
    const bass = 0.5 + Math.sin(t * 1.1) * 0.28 + Math.sin(t * 2.7) * 0.1;
    return Math.min(1, Math.max(0, bass));
  }

  updateMotion(dt) {
    const target = MOTION_BY_STATE[this.playerState] ?? 0.3;
    const scaled = target * (0.08 + this.intensity * 0.92);
    // Плавное приближение: никакого «скачка» при паузе/воспроизведении
    this.motion += (scaled - this.motion) * Math.min(1, dt * 1.6);
  }

  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop);
    const elapsed = now - this.lastFrame;
    if (elapsed < this.frameBudget) return;

    const dt = Math.min(0.06, elapsed / 1000);
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

    if (this.fade < 1) this.fade = Math.min(1, this.fade + (dt * 1000) / CROSSFADE_MS);

    this.draw(this.fade < 1 ? this.outgoing : null);
  };

  renderStatic() {
    if (this.disabled) return;
    this.motion = MOTION_BY_STATE[this.playerState] ?? 0.3;
    this.draw(null);
  }

  draw(outgoing) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);

    const pulse = this.reactive
      ? Math.min(1, this.levels.bass * 0.7 + this.levels.overall * 0.4)
      : this.synthPulse(this.clock * (0.6 + this.motion));

    const params = {
      t: this.time,
      dt: 0.016,
      w: this.width,
      h: this.height,
      motion: this.motion,
      pulse,
      speed: this.speed,
      palette: this.palette,
      levels: this.levels,
    };

    const paint = (scene, alpha) => {
      ctx.globalAlpha = alpha;
      scene?.draw?.call(scene, ctx, { ...params, sprites: this.sprites[scene.id] ?? [] });
    };

    if (outgoing) paint(outgoing, 1 - this.fade);
    paint(this.active, outgoing ? this.fade : 1);
    ctx.globalAlpha = 1;
  }
}

export { scenes as atmosphereScenes };
export default Atmosphere;
