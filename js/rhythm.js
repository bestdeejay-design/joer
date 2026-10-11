/**
 * JOER — ритмический слой атмосферы (T-09).
 *
 * Один источник «пульса» для всех сцен:
 *  - реактивный режим: onset-детектор по басу — кик/пульс попадают в удары музыки;
 *  - процедурный режим: музыкальный паттерн (кик/снейр/хэт) с темпом от `energy`
 *    станции — вместо ровной синусоиды, чтобы сцена выглядела «под запись».
 *
 * Модуль не знает про canvas и Web Audio: только числа на входе, конверты на выходе.
 */

export const SPECTRUM_BANDS = 32;

/** Затухание конвертов, 1/с. */
const DECAY_KICK = 6.2;
const DECAY_SNARE = 7.5;
const DECAY_HAT = 11;

export class Rhythm {
  constructor() {
    this.time = 0;

    // Темп и позиция в такте
    this.bpm = 96;
    this.beatCount = 0;
    this.beatPhase = 0;
    this.halfPhase = 0;

    // Конверты событий 0..1
    this.kick = 0;
    this.snare = 0;
    this.hat = 0;

    // Сводные сигналы для сцен
    this.pulse = 0.3;
    this.sparkle = 0;

    // Спектр (32 полосы, 0..1) — реальный или синтезированный
    this.spectrum = new Float32Array(SPECTRUM_BANDS);
    this.spectrumSource = null;

    // Состояние onset-детектора
    this.prevBass = 0;
    this.fluxAvg = 0.02;
    this.sinceOnset = 1;
    this.onsetIntervals = 0.5;
  }

  /** Данные анализатора (реальный спектр, 0..1 на полосу). */
  setSpectrum(values) {
    this.spectrumSource = values && values.length ? values : null;
  }

  /**
   * Шаг ритма. dt — секунды; словарь — срез уровней и настроек.
   * Возвращает this для цепочки вызовов.
   */
  update(dt, { reactive = false, bass = 0, mid = 0, high = 0, energy = 3, intensity = 1, motion = 1 } = {}) {
    const step = Math.min(0.1, Math.max(0, dt));
    this.time += step;

    if (reactive) {
      this.updateReactive(step, bass, mid, high);
    } else {
      this.updateProcedural(step, energy, intensity);
    }

    // Общие конверты; motion «усыпляет» ритм на паузе вместе со сценой
    const alive = 0.12 + motion * 0.88;
    this.kick *= Math.exp(-step * DECAY_KICK);
    this.snare *= Math.exp(-step * DECAY_SNARE);
    this.hat *= Math.exp(-step * DECAY_HAT);

    const breath = 0.16 + Math.sin(this.time * 0.7) * 0.06 + Math.sin(this.time * 0.23) * 0.05;
    this.pulse = Math.min(1, (breath + this.kick * 0.85 + this.snare * 0.3) * alive);
    this.sparkle = Math.min(1, (this.hat * 0.8 + Math.max(0, high) * (reactive ? 0.5 : 0.15)) * alive);

    if (reactive && this.spectrumSource) {
      this.adoptSpectrum(step);
    } else {
      this.synthesizeSpectrum(step);
    }

    return this;
  }

  /* --------------------------------------------------------------
     Реактивный режим: удары вычитаются из реального баса
     -------------------------------------------------------------- */

  updateReactive(dt, bass, mid, high) {
    const level = Math.min(1, Math.max(0, bass));
    const flux = Math.max(0, level - this.prevBass);
    this.prevBass = level;
    this.fluxAvg += (flux - this.fluxAvg) * Math.min(1, dt * 2.2);
    this.sinceOnset += dt;

    const threshold = this.fluxAvg * 1.7 + 0.012;
    if (flux > threshold && this.sinceOnset > 0.16) {
      const strength = Math.min(1, 0.55 + flux * 2.6);
      this.kick = Math.max(this.kick, strength);
      if (this.sinceOnset < 1.5) {
        // Скользящая оценка темпа по межударным интервалам
        this.onsetIntervals += (this.sinceOnset - this.onsetIntervals) * 0.25;
        const bpm = 60 / this.onsetIntervals;
        if (bpm >= 60 && bpm <= 190) this.bpm += (bpm - this.bpm) * 0.2;
      }
      this.sinceOnset = 0;
      this.beatCount += 1;
      this.beatPhase = 0;
      this.halfPhase = 0;
    } else {
      this.beatPhase = (this.beatPhase + dt * (this.bpm / 60)) % 1;
      this.halfPhase = (this.halfPhase + dt * (this.bpm / 30)) % 1;
    }

    // Снейр и хэт — прокси по средним/верхним частотам с быстрым затуханием
    const midLevel = Math.min(1, Math.max(0, mid));
    const highLevel = Math.min(1, Math.max(0, high));
    this.snare = Math.max(this.snare * Math.exp(-dt * DECAY_SNARE), Math.max(0, midLevel - 0.18) * 0.7);
    this.hat = Math.max(this.hat * Math.exp(-dt * DECAY_HAT), Math.max(0, highLevel - 0.12) * 0.9);
  }

  /* --------------------------------------------------------------
     Процедурный режим: паттерн с темпом от энергии станции
     -------------------------------------------------------------- */

  updateProcedural(dt, energy, intensity) {
    const drive = Math.min(5, Math.max(1, energy));
    const targetBpm = 62 + drive * 16; // 78…142 BPM
    // Лёгкое «дыхание» темпа — не механически ровный метроном
    const drift = 1 + Math.sin(this.time * 0.05) * 0.012;
    this.bpm += (targetBpm * drift - this.bpm) * Math.min(1, dt * 0.8);

    const beatDur = 60 / this.bpm;
    const prevHalf = this.halfPhase;
    this.beatPhase += dt / beatDur;
    this.halfPhase += (dt / beatDur) * 2;

    // Половинные доли (хэт) — проверяем переходы через границу
    if (Math.floor(this.halfPhase) > Math.floor(prevHalf)) {
      const accent = Math.floor(this.halfPhase) % 2 === 1;
      this.hat = Math.max(this.hat, (accent ? 0.5 : 0.26) * (0.55 + intensity * 0.45));
    }

    while (this.beatPhase >= 1) {
      this.beatPhase -= 1;
      this.beatCount += 1;
      const bar = this.beatCount % 4;
      const strength = 0.55 + intensity * 0.45;
      if (bar === 0) {
        this.kick = Math.max(this.kick, 0.92 * strength);
      } else if (bar === 2) {
        this.kick = Math.max(this.kick, 0.62 * strength);
      } else if (drive >= 2) {
        this.snare = Math.max(this.snare, 0.5 * strength);
      }
      // Второй лёгкий кик на «и» для танцевальных энергий
      if (drive >= 4 && bar === 3) {
        this.kick = Math.max(this.kick, 0.34 * strength);
      }
    }
    this.beatPhase %= 1;
  }

  /* --------------------------------------------------------------
     Спектр для эквалайзера сцен
     -------------------------------------------------------------- */

  adoptSpectrum(dt) {
    const source = this.spectrumSource;
    const n = Math.min(this.spectrum.length, source.length);
    for (let i = 0; i < n; i += 1) {
      const target = Math.min(1, Math.max(0, source[i]));
      // Атака быстрая, спад плавный — бары не дрожат
      const rate = target > this.spectrum[i] ? 18 : 3.2;
      this.spectrum[i] += (target - this.spectrum[i]) * Math.min(1, dt * rate);
    }
    for (let i = n; i < this.spectrum.length; i += 1) {
      this.spectrum[i] *= Math.exp(-dt * 3);
    }
  }

  synthesizeSpectrum(dt) {
    const decay = Math.exp(-dt * 4.2);
    for (let i = 0; i < this.spectrum.length; i += 1) {
      const k = i / (this.spectrum.length - 1);
      // Базовая «вода» — детерминированная, без мерцания random
      const base = 0.1 + Math.sin(this.time * (0.55 + k * 1.7) + i * 0.9) * 0.045 + Math.sin(this.time * 0.21 + i) * 0.03;
      let value = Math.max(0, base) + this.spectrum[i] * decay;
      if (i < 7) value += this.kick * (1 - i / 8) * 0.85;
      if (i >= 7 && i < 20) value += this.snare * 0.34;
      if (i >= 18) value += this.hat * (0.22 + k * 0.2);
      this.spectrum[i] = Math.min(1, value);
    }
  }
}

export default Rhythm;
