#!/usr/bin/env node
/**
 * JOER — генератор иконок и OG-картинки (T-07).
 *
 * Без зависимостей: собственный минимальный PNG-энкодер (node:zlib) и
 * рисование по signed distance fields. Запуск: npm run icons
 *
 * На выходе:
 *   icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png
 *   assets/og-image.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* ---------------- PNG ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // фильтр: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- рисование ---------------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function sdRoundRect(px, py, cx, cy, hx, hy, radius) {
  const qx = Math.abs(px - cx) - hx + radius;
  const qy = Math.abs(py - cy) - hy + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

/** Пиксельный холст с RGBA-буфером. */
function createSurface(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function putPixel(surface, x, y, [r, g, b], a = 1) {
  const alpha = clamp01(a);
  if (alpha <= 0) return;
  const i = (y * surface.width + x) * 4;
  const dst = surface.data;
  const inv = 1 - alpha;
  dst[i] = r * alpha + dst[i] * inv;
  dst[i + 1] = g * alpha + dst[i + 1] * inv;
  dst[i + 2] = b * alpha + dst[i + 2] * inv;
  dst[i + 3] = Math.min(255, dst[i + 3] + alpha * 255 * (1 - dst[i + 3] / 255));
}

const INK = [20, 16, 44];
const VIOLET = [139, 124, 246];
const AQUA = [94, 234, 212];
const DEEP = [11, 15, 30];

/** Иконка приложения: скруглённый квадрат + «эквалайзер». */
function renderIcon(size, { maskable = false } = {}) {
  const surface = createSurface(size, size);
  const pad = maskable ? size * 0.0 : size * 0.0;
  const half = size / 2 - pad;
  const radius = maskable ? size * 0.5 : size * 0.22;
  const barArea = maskable ? size * 0.3 : size * 0.36;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = sdRoundRect(x + 0.5, y + 0.5, half + pad, half + pad, half, half, radius);
      const cover = clamp01(0.5 - d);
      if (cover <= 0) continue;

      // Фон: диагональный градиент + лёгкое свечение снизу
      const t = (x + y) / (size * 2);
      const bg = mixColor(mixColor(DEEP, [26, 22, 62], t), [16, 12, 40], 0.4);
      putPixel(surface, x, y, bg, cover);

      // Свечение за «эквалайзером»
      const gx = (x - size / 2) / size;
      const gy = (y - size * 0.54) / size;
      const glow = Math.exp(-(gx * gx + gy * gy) * 12) * 0.55;
      putPixel(surface, x, y, mixColor(VIOLET, AQUA, clamp01(0.35 + gx)), glow * cover);
    }
  }

  // Полоски эквалайзера
  const bars = [0.34, 0.62, 1.0, 0.48];
  const barWidth = barArea * 0.19;
  const gap = barArea * 0.09;
  const totalWidth = bars.length * barWidth + (bars.length - 1) * gap;
  const startX = size / 2 - totalWidth / 2;
  const baseY = size * 0.7;

  bars.forEach((height, index) => {
    const cx = startX + barWidth / 2 + index * (barWidth + gap);
    const hy = (barArea * height) / 2;
    const cy = baseY - hy;
    for (let y = Math.floor(cy - hy - 2); y <= Math.ceil(cy + hy + 2); y += 1) {
      for (let x = Math.floor(cx - barWidth - 2); x <= Math.ceil(cx + barWidth + 2); x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, barWidth / 2, hy, barWidth * 0.45);
        const cover = clamp01(0.5 - d);
        const color = mixColor(VIOLET, AQUA, index / (bars.length - 1));
        if (cover > 0) putPixel(surface, x, y, color, cover);
        const halo = Math.exp(-Math.max(0, d) * 1.1) * 0.35;
        if (halo > 0.01) putPixel(surface, x, y, color, halo);
      }
    }
  });

  return surface;
}

/* ---------------- шрифт 5×7 ---------------- */

const GLYPHS = {
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "·": ["00000", "00000", "00000", "01100", "01100", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
};

function drawText(surface, text, { x, y, scale = 10, spacing = 1, color = [255, 255, 255], alpha = 1 }) {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== "1") continue;
        const px = cursor + col * scale;
        const py = y + row * scale;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const tx = px + dx;
            const ty = py + dy;
            if (tx < 0 || ty < 0 || tx >= surface.width || ty >= surface.height) continue;
            putPixel(surface, tx, ty, color, alpha);
          }
        }
      }
    }
    cursor += (5 + spacing) * scale;
  }
  return cursor - x;
}

function textWidth(text, scale, spacing = 1) {
  return text.length * (5 + spacing) * scale - spacing * scale;
}

/** OG-картинка: тёмный градиент, «эквалайзер», название и подпись. */
function renderOgImage(width = 1200, height = 630) {
  const surface = createSurface(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width;
      const ny = y / height;
      let color = mixColor([10, 13, 28], [22, 27, 60], ny);
      // два мягких пятна света
      const g1 = Math.exp(-(((nx - 0.78) ** 2) / 0.05 + ((ny - 0.05) ** 2) / 0.12));
      const g2 = Math.exp(-(((nx - 0.12) ** 2) / 0.06 + ((ny - 1.05) ** 2) / 0.14));
      color = mixColor(color, VIOLET, g1 * 0.5);
      color = mixColor(color, AQUA, g2 * 0.32);
      putPixel(surface, x, y, color, 1);
    }
  }

  // Полоски эквалайзера снизу
  const bars = 13;
  const barWidth = 26;
  const gap = 18;
  const totalWidth = bars * barWidth + (bars - 1) * gap;
  const startX = (width - totalWidth) / 2;
  const baseY = height - 70;
  for (let i = 0; i < bars; i += 1) {
    const heightFactor = 0.25 + Math.abs(Math.sin(i * 0.9)) * 0.75;
    const barHeight = 110 * heightFactor;
    const cx = startX + barWidth / 2 + i * (barWidth + gap);
    const cy = baseY - barHeight / 2;
    const color = mixColor(VIOLET, AQUA, i / (bars - 1));
    for (let y = Math.floor(cy - barHeight / 2 - 6); y <= Math.ceil(cy + barHeight / 2 + 6); y += 1) {
      for (let x = Math.floor(cx - barWidth / 2 - 6); x <= Math.ceil(cx + barWidth / 2 + 6); x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, barWidth / 2, barHeight / 2, barWidth * 0.4);
        const cover = clamp01(0.5 - d);
        if (cover > 0) putPixel(surface, x, y, color, cover * 0.9);
        const halo = Math.exp(-Math.max(0, d) * 0.5) * 0.16;
        if (halo > 0.01) putPixel(surface, x, y, color, halo);
      }
    }
  }

  const title = "JOER";
  const titleScale = 20;
  drawText(surface, title, {
    x: Math.round((width - textWidth(title, titleScale, 2)) / 2),
    y: 150,
    scale: titleScale,
    spacing: 2,
    color: [255, 255, 255],
  });

  const subtitle = "INTERNET RADIO";
  const subScale = 8;
  drawText(surface, subtitle, {
    x: Math.round((width - textWidth(subtitle, subScale, 2)) / 2),
    y: 300,
    scale: subScale,
    spacing: 2,
    color: AQUA,
    alpha: 0.95,
  });

  const tagline = "ATMOSPHERE FOLLOWS THE MUSIC";
  const tagScale = 5;
  drawText(surface, tagline, {
    x: Math.round((width - textWidth(tagline, tagScale, 2)) / 2),
    y: 396,
    scale: tagScale,
    spacing: 2,
    color: [200, 205, 235],
    alpha: 0.8,
  });

  return surface;
}

/* ---------------- запись ---------------- */

function save(surface, relPath) {
  const path = new URL(`../${relPath}`, import.meta.url);
  mkdirSync(new URL(".", path), { recursive: true });
  writeFileSync(path, encodePng(surface.width, surface.height, surface.data));
  console.log(`✅ ${relPath} (${surface.width}×${surface.height})`);
}

save(renderIcon(192), "icons/icon-192.png");
save(renderIcon(512), "icons/icon-512.png");
save(renderIcon(512, { maskable: true }), "icons/icon-maskable-512.png");
save(renderOgImage(), "assets/og-image.png");
