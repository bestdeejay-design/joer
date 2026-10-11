/**
 * JOER — темы (T-05).
 *
 * Тема = атрибут `data-theme` на <html> + набор CSS-переменных в css/themes/<id>.css.
 * Режимы: «авто» (тема следует за группой станций) и ручной выбор, который
 * отключает авто до явного возврата. Выбор переживает перезагрузку (joer:theme).
 */

import { prefs } from "./storage.js";

export const AUTO = "auto";

export const THEMES = [
  { id: "lounge", title: "Lounge", hint: "Неоновый вечер", scene: "waves", meta: "#0b0f1e" },
  { id: "club", title: "Club", hint: "Ночной клуб", scene: "rings", meta: "#0a0612" },
  { id: "romantic", title: "Romantic", hint: "Тёплый вечер", scene: "bokeh", meta: "#1a0f14" },
  { id: "space", title: "Chill & Space", hint: "Космос", scene: "stars", meta: "#05070f" },
  { id: "velvet", title: "Jazz & Retro", hint: "Велюр и золото", scene: "vinyl", meta: "#150a0c" },
];

export const THEME_IDS = THEMES.map((theme) => theme.id);
const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function themeById(id) {
  return BY_ID.get(id) ?? THEMES[0];
}

export function isThemeId(value) {
  return THEME_IDS.includes(value);
}

function normalizeMode(value) {
  if (value === AUTO) return AUTO;
  return isThemeId(value) ? value : AUTO;
}

export class ThemeManager extends EventTarget {
  constructor({ storage = prefs, root = document.documentElement } = {}) {
    super();
    this.storage = storage;
    this.root = root;
    this.mode = normalizeMode(storage.theme);
    this.groupTheme = THEMES[0].id;
    this.theme = this.resolve();
    this.paint(this.theme);
  }

  resolve() {
    return this.mode === AUTO ? this.groupTheme : this.mode;
  }

  /** Тема группы (используется только в режиме «авто»). */
  setGroupTheme(id) {
    if (!isThemeId(id)) return;
    this.groupTheme = id;
    if (this.mode === AUTO) this.paint(id);
  }

  /** Ручной выбор («auto» — вернуть автоматический режим). */
  setMode(mode) {
    const next = normalizeMode(mode);
    if (next === this.mode && next !== AUTO) return;
    this.mode = next;
    this.storage.theme = next;
    this.paint(this.resolve());
  }

  toggleAuto() {
    this.setMode(this.mode === AUTO ? this.groupTheme : AUTO);
  }

  /** Следующая тема по кругу (для горячих клавиш). */
  cycle() {
    const order = [AUTO, ...THEME_IDS];
    const index = order.indexOf(this.mode);
    this.setMode(order[(index + 1) % order.length]);
  }

  paint(id) {
    const theme = themeById(id);
    this.theme = theme.id;
    this.root.dataset.theme = theme.id;
    this.root.style.colorScheme = "dark";

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.meta);

    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { theme: theme.id, mode: this.mode, scene: theme.scene, meta: theme.meta, title: theme.title },
      }),
    );
  }
}

export default ThemeManager;
