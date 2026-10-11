/**
 * JOER — селектор темы и интенсивности атмосферы (T-05).
 */

import { AUTO, THEMES } from "../themes.js";

export function createThemePicker({ root, manager, onIntensity, initialIntensity }) {
  if (!root) return null;

  const el = {
    button: root.querySelector("#theme-picker-btn"),
    label: root.querySelector("#theme-picker-label"),
    menu: root.querySelector("#theme-menu"),
    options: [...root.querySelectorAll(".theme-option")],
    intensity: root.querySelector("#intensity"),
    intensityValue: root.querySelector("#intensity-value"),
  };

  function setOpen(open) {
    root.dataset.open = String(open);
    el.menu.hidden = !open;
    el.button.setAttribute("aria-expanded", String(open));
    if (open) el.options.find((option) => option.getAttribute("aria-checked") === "true")?.focus();
  }

  const isOpen = () => root.dataset.open === "true";

  function render() {
    const { mode, theme } = manager;
    el.label.textContent = mode === AUTO ? "Авто" : (THEMES.find((t) => t.id === mode)?.title ?? "Авто");
    el.button.dataset.mode = mode;
    el.button.title = mode === AUTO ? `Авто: сейчас ${theme}` : `Тема: ${theme}`;
    for (const option of el.options) {
      option.setAttribute("aria-checked", String(option.dataset.mode === mode));
    }
  }

  el.button.addEventListener("click", () => setOpen(!isOpen()));

  for (const option of el.options) {
    option.addEventListener("click", () => {
      manager.setMode(option.dataset.mode);
      render();
      setOpen(false);
      el.button.focus();
    });
  }

  el.menu.addEventListener("keydown", (event) => {
    const index = el.options.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowDown") next = (index + 1) % el.options.length;
    else if (event.key === "ArrowUp") next = (index - 1 + el.options.length) % el.options.length;
    else if (event.key === "Escape") {
      setOpen(false);
      el.button.focus();
      return;
    } else return;
    event.preventDefault();
    el.options[next].focus();
  });

  document.addEventListener("click", (event) => {
    if (isOpen() && !root.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      el.button.focus();
    }
  });

  // Интенсивность атмосферы — множитель поверх «энергии» станции
  if (el.intensity) {
    if (typeof initialIntensity === "number") {
      const percent = Math.round(Math.min(1, Math.max(0, initialIntensity)) * 100);
      el.intensity.value = String(percent);
    }
    const apply = (commit) => {
      const value = Number(el.intensity.value) / 100;
      el.intensity.style.setProperty("--volume-fill", `${Math.round(value * 100)}%`);
      if (el.intensityValue) el.intensityValue.textContent = `${Math.round(value * 100)}%`;
      onIntensity?.(value, commit);
    };
    el.intensity.addEventListener("input", () => apply(false));
    el.intensity.addEventListener("change", () => apply(true));
    apply(true);
  }

  manager.addEventListener("change", render);
  render();

  return { render, setOpen };
}
