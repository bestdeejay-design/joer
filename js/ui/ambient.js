/**
 * JOER — режим «Только атмосфера» (T-12).
 *
 * На экране остаётся только живая сцена (фон + canvas + зерно + виньетка):
 * интерфейс гаснет и становится inert, музыка продолжает играть.
 * Миры перетекают друг в друга сами (кроссфейд сцен, ~90 с на мир) —
 * можно вывести сайт на большой экран и просто смотреть.
 *
 * Выход: клик/тап в любом месте или Esc. Вход: кнопка «Атмосфера»
 * или адрес с #atmosphere (удобно для большого экрана: joer.ru/#atmosphere).
 * Выбор темы пользователя не портится: на выходе тема восстанавливается.
 */

import { THEME_IDS } from "../themes.js";

const HASH = "atmosphere";
const HINT_MS = 5500;
const EXIT_GRACE_MS = 350;

export function createAmbientMode({
  themes,
  atmosphere,
  rotateMs = 90_000,
  listen = true,
  useFullscreen = true,
} = {}) {
  const page = document.getElementById("main")?.closest(".page") ?? document.querySelector(".page");
  const skipLink = document.querySelector(".skip-link");
  const hint = document.getElementById("ambient-hint");
  const button = document.getElementById("ambient-btn");

  let active = false;
  let enteredAt = 0;
  let rotateTimer = null;
  let hintTimer = null;
  let hintHideTimer = null;
  let fullscreenRequested = false;

  const reduceMotion = () =>
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

  function setInert(element, on) {
    if (!element) return;
    if (on) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  }

  function showHint() {
    if (!hint) return;
    clearTimeout(hintHideTimer);
    hint.hidden = false;
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.classList.remove("is-visible");
      hintHideTimer = setTimeout(() => {
        hint.hidden = true;
      }, 400);
    }, HINT_MS);
  }

  function hideHint() {
    if (!hint) return;
    clearTimeout(hintTimer);
    clearTimeout(hintHideTimer);
    hint.classList.remove("is-visible");
    hint.hidden = true;
  }

  /** Следующий мир по кругу: перекраска без записи в хранилище. */
  function rotate() {
    if (!themes) return;
    const index = THEME_IDS.indexOf(themes.theme);
    const next = THEME_IDS[(index + 1 + THEME_IDS.length) % THEME_IDS.length];
    themes.paint(next);
    return next;
  }

  function setHash(on) {
    try {
      const base = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", on ? `${base}#${HASH}` : base);
    } catch {
      /* jsdom/приватный режим — не критично */
    }
  }

  function enter({ fromGesture = false, withHash = true } = {}) {
    if (active) return;
    active = true;
    enteredAt = Date.now();

    document.body.classList.add("is-ambient");
    setInert(page, true);
    setInert(skipLink, true);
    button?.setAttribute("aria-pressed", "true");
    showHint();
    if (withHash) setHash(true);

    // Полный экран — чтобы на большом экране спрятать и панель браузера.
    // Без жеста пользователя браузер откажет — это нормально, режим работает и так.
    if (useFullscreen && fromGesture && !document.fullscreenElement) {
      fullscreenRequested = true;
      Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: "hide" })).catch(
        () => {
          fullscreenRequested = false;
        },
      );
    }

    // Миры перетекают сами; reduced-motion — один спокойный мир без смены
    if (!reduceMotion() && themes && rotateMs > 0) {
      rotateTimer = setInterval(rotate, rotateMs);
    }
  }

  function exit({ withHash = true } = {}) {
    if (!active) return;
    active = false;

    document.body.classList.remove("is-ambient");
    setInert(page, false);
    setInert(skipLink, false);
    button?.setAttribute("aria-pressed", "false");
    hideHint();
    if (withHash) setHash(false);

    clearInterval(rotateTimer);
    rotateTimer = null;

    // Своя тема пользователя — как была до прогулки по мирам
    themes?.paint(themes.resolve());

    if (document.fullscreenElement && (fullscreenRequested || useFullscreen)) {
      fullscreenRequested = false;
      Promise.resolve(document.exitFullscreen?.()).catch(() => {});
    }

    button?.focus({ preventScroll: true });
  }

  function toggle() {
    if (active) exit();
    else enter({ fromGesture: true });
  }

  if (listen) {
    button?.addEventListener("click", () => enter({ fromGesture: true }));

    document.addEventListener("keydown", (event) => {
      if (active && event.key === "Escape") {
        event.preventDefault();
        exit();
      }
    });

    // Клик/тап в любом месте — выход (первые мгновения игнорируем: это мог быть вход)
    document.addEventListener("click", () => {
      if (active && Date.now() - enteredAt > EXIT_GRACE_MS) exit();
    });

    window.addEventListener("hashchange", () => {
      const onHash = window.location.hash === `#${HASH}`;
      if (onHash && !active) enter({ fromGesture: false });
      else if (!onHash && active) exit({ withHash: false });
    });

    // Большой экран: joer.ru/#atmosphere открывается сразу в режиме атмосферы
    if (window.location.hash === `#${HASH}`) enter({ fromGesture: false });
  }

  return {
    get active() {
      return active;
    },
    enter,
    exit,
    toggle,
    rotate,
  };
}
