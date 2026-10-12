/**
 * JOER — сворачивание героя к верху (T-11).
 *
 * Герой можно сложить в тонкую полосу у верха и остаться наедине с атмосферой
 * и каталогом. Состояние живёт в `joer:heroCollapsed`, тело героя при сворачивании
 * становится `inert` (вне порядка табуляции и для скринридеров).
 */

import { prefs } from "../storage.js";

export function createHeroFold({ root, onToggle } = {}) {
  const hero = (typeof root === "string" ? document.querySelector(root) : root) ?? document.getElementById("hero");
  const button = hero?.querySelector("#hero-fold") ?? document.getElementById("hero-fold");
  const body = document.getElementById("hero-body");
  const textEl = document.getElementById("hero-fold-text");

  if (!hero || !button || !body) {
    return {
      get collapsed() {
        return false;
      },
      collapse() {},
      expand() {},
      toggle() {},
    };
  }

  let collapsed = prefs.heroCollapsed === true;

  function apply(value, { persist = true } = {}) {
    collapsed = Boolean(value);
    hero.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", collapsed ? "Развернуть приветствие" : "Свернуть приветствие");
    if (textEl) textEl.textContent = collapsed ? "Развернуть" : "Свернуть";
    if (collapsed) body.setAttribute("inert", "");
    else body.removeAttribute("inert");
    if (persist) prefs.heroCollapsed = collapsed;
    onToggle?.(collapsed);
  }

  button.addEventListener("click", () => apply(!collapsed));

  // Стартовое состояние — из хранилища, без лишней записи
  apply(collapsed, { persist: false });

  return {
    get collapsed() {
      return collapsed;
    },
    collapse: () => apply(true),
    expand: () => apply(false),
    toggle: () => apply(!collapsed),
  };
}
