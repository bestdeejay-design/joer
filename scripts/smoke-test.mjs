#!/usr/bin/env node
/**
 * JOER — смоук-тест на jsdom (только dev-зависимость, в рантайме сайта не участвует).
 *
 * Поднимает index.html в jsdom, подсовывает реальные ES-модули приложения
 * и проверяет, что сайт действительно собирается и рендерит каталог.
 *
 * Запуск: npm test
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ждём условия: часы jsdom идут медленнее реальных, поэтому — опросом. */
async function waitFor(predicate, timeout = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) return true;
    await tick(40);
  }
  return predicate();
}

/** Подделка 2D-контекста: записывает вызовы, ничего не рисуя. */
function makeStubContext() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const target = {
    calls,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    arc() {},
    ellipse() {},
    rect() {},
    fillRect() {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    drawImage() {},
  };
  return new Proxy(target, {
    get(object, key) {
      const value = object[key];
      if (typeof value !== "function") return value;
      return (...args) => {
        calls.push(String(key));
        return value(...args);
      };
    },
  });
}

/** Минимальное окружение браузера для модулей приложения. */
async function makeEnv(html, options = {}) {
  const dom = new JSDOM(html, {
    url: "https://joer.ru/",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.matchMedia = (query) => ({
    matches: Boolean(options.reduceMotion) && /reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });

  if (options.canvas === "stub") {
    const stub = makeStubContext();
    window.HTMLCanvasElement.prototype.getContext = () => stub;
    dom.canvasStub = stub;
  } else {
    window.HTMLCanvasElement.prototype.getContext = () => null;
  }

  const catalog = JSON.parse(read("data/stations.json"));
  window.fetch = async (href) => {
    const url = String(href).split("?")[0].replace(/^\.\//, "");
    if (url.endsWith("stations.json")) {
      return { ok: true, status: 200, json: async () => catalog };
    }
    if (url.startsWith("fail://")) {
      throw new TypeError("Failed to fetch");
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const g = globalThis;
  g.window = window;
  g.document = window.document;
  Object.defineProperty(g, "navigator", { value: window.navigator, configurable: true, writable: true });
  g.localStorage = window.localStorage;
  g.HTMLElement = window.HTMLElement;
  g.HTMLAudioElement = window.HTMLAudioElement;
  // Единое «царство» событий: классы приложения наследуют jsdom-EventTarget,
  // а DOM-элементы принимают jsdom-события (в браузере это и так один набор).
  g.Event = window.Event;
  g.CustomEvent = window.CustomEvent;
  g.EventTarget = window.EventTarget;
  g.Node = window.Node;
  g.requestAnimationFrame = window.requestAnimationFrame?.bind(window);
  g.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window);
  g.getComputedStyle = window.getComputedStyle.bind(window);
  g.fetch = window.fetch;

  return { dom, window, document: window.document, catalog };
}

/** Сбрасываем кэш модулей, чтобы каждый сценарий стартовал с чистого листа. */
let importCounter = 0;
async function importFresh(rel) {
  importCounter += 1;
  const href = new URL(`../${rel}?t=${importCounter}`, import.meta.url).href;
  return import(href);
}

/* =====================================================================
   1. Статика: ресурсы локальны и существуют
   ===================================================================== */
section("1. Статика страницы");

const html = read("index.html");
// Сканируем только теги, которые грузят ресурсы (ссылки-навигация — не в счёт)
const refs = [
  ...html.matchAll(/<link[^>]*href="([^"]+)"/g),
  ...html.matchAll(/<script[^>]*src="([^"]+)"/g),
  ...html.matchAll(/<img[^>]*src="([^"]+)"/g),
  ...html.matchAll(/<source[^>]*src="([^"]+)"/g),
  ...html.matchAll(/<use[^>]*href="([^"]+)"/g),
].map((m) => m[1]).filter((href) => !href.startsWith("data:") && !href.startsWith("#"));

const external = refs.filter((href) => /^https?:|^\/\//.test(href));
check("нет внешних ресурсов (CDN/шрифты/скрипты)", external.length === 0, external.join(", "));
check(
  "все локальные ресурсы существуют",
  refs.every((href) => existsSync(path.join(ROOT, href.split("?")[0]))),
  refs.filter((href) => !existsSync(path.join(ROOT, href.split("?")[0]))).join(", "),
);
check("есть viewport с viewport-fit=cover", /viewport-fit=cover/.test(html));
check("lang=ru и data-theme на <html>", /<html lang="ru" data-theme="/.test(html));
check("skip-link для клавиатуры", /class="skip-link"/.test(html));
check("манифест подключён", /<link rel="manifest" href="manifest.webmanifest">/.test(html));
check("favicon — локальный файл", /<link rel="icon"[^>]*href="assets\/favicon.svg"/.test(html));
check("og:image — абсолютный URL", /<meta property="og:image" content="https:\/\/joer.ru\/assets\/og-image.png">/.test(html));
check("apple-touch-icon для iOS", /<link rel="apple-touch-icon" href="icons\/icon-192.png">/.test(html));

/* =====================================================================
   2. Каталог: структура данных
   ===================================================================== */
section("2. Каталог данных");

const data = JSON.parse(read("data/stations.json"));
const perGroup = new Map();
for (const st of data.stations) perGroup.set(st.groupId, (perGroup.get(st.groupId) ?? 0) + 1);

check("5 групп", data.groups.length === 5, `фактически ${data.groups.length}`);
check("станций ≥ 30", data.stations.length >= 30, `фактически ${data.stations.length}`);
for (const g of data.groups) {
  const n = perGroup.get(g.id) ?? 0;
  check(`группа «${g.title}» ≥ 6 станций`, n >= 6, `фактически ${n}`);
}
check(
  "все потоки https",
  data.stations.every((st) => st.url.startsWith("https://")),
);
check(
  "нет .pls/.m3u",
  data.stations.every((st) => !/\.(pls|m3u8?)(\?|$)/i.test(st.url)),
);
check(
  "заполнены description/homepage/genres/energy",
  data.stations.every((st) => st.description && st.homepage && st.genres?.length && st.energy >= 1 && st.energy <= 5),
);
check(
  "defaultStationId каждой группы существует",
  data.groups.every((g) => data.stations.some((st) => st.id === g.defaultStationId)),
);

/* =====================================================================
   3. Рендер каталога в jsdom
   ===================================================================== */
section("3. Рендер каталога");

{
  const env = await makeEnv(html);
  await importFresh("js/app.js");
  await tick(30);

  const tabs = env.document.querySelectorAll(".group-tab");
  const cards = env.document.querySelectorAll(".card");
  check("отрисованы 5 табов групп", tabs.length === 5, `фактически ${tabs.length}`);
  check("отрисованы станции первой группы", cards.length >= 6, `фактически ${cards.length}`);
  check("активный таб помечен aria-pressed", env.document.querySelectorAll('.group-tab[aria-pressed="true"]').length === 1);
  check("скелетон загрузки скрыт", env.document.getElementById("catalog-loading").hidden === true);
  check("панель ошибки скрыта", env.document.getElementById("catalog-error").hidden === true);
  check("в описании каталога есть число станций", /\d+/.test(env.document.getElementById("catalog-note").textContent));

  // Переключение группы
  const clubTab = [...tabs].find((t) => t.dataset.groupId === "club");
  clubTab.click();
  await tick(10);
  const clubCards = env.document.querySelectorAll(".card");
  const clubExpected = perGroup.get("club");
  check("клик по табу меняет набор станций", clubCards.length === clubExpected, `фактически ${clubCards.length}, ждали ${clubExpected}`);
  const clubTabAfter = env.document.querySelector('.group-tab[data-group-id="club"]');
  check("aria-pressed переехал на новый таб", clubTabAfter?.getAttribute("aria-pressed") === "true");

  // Избранное
  const favButton = env.document.querySelector(".card-fav");
  const cardId = favButton.closest(".card").dataset.stationId;
  favButton.click();
  await tick(10);
  const stored = JSON.parse(env.window.localStorage.getItem("joer:favorites") || "[]");
  check("избранное сохраняется в localStorage", stored.includes(cardId), `ключ joer:favorites = ${JSON.stringify(stored)}`);
  check(
    "избранная станция поднялась первой",
    env.document.querySelector(".card").dataset.stationId === cardId,
  );

  env.window.close();
}

/* =====================================================================
   4. Ошибка загрузки каталога
   ===================================================================== */
section("4. Ошибка загрузки");

{
  const env = await makeEnv(html);
  env.window.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  globalThis.fetch = env.window.fetch;

  const mod = await importFresh("js/catalog.js");
  let caught = null;
  try {
    await mod.loadCatalog({ fetchImpl: env.window.fetch });
  } catch (error) {
    caught = error;
  }
  check("loadCatalog бросает понятную ошибку", Boolean(caught) && /Не удалось загрузить/i.test(caught.message), caught?.message);

  // И UI-путь: bootstrap показывает панель ошибки, а не пустой экран
  const env2 = await makeEnv(html);
  env2.window.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  globalThis.fetch = env2.window.fetch;
  await importFresh("js/app.js");
  await tick(30);
  check("UI показывает панель ошибки", env2.document.getElementById("catalog-error").hidden === false);
  check(
    "текст ошибки человекочитаемый",
    env2.document.getElementById("catalog-error-text").textContent.length > 12,
  );
  env2.window.close();
  env.window.close();
}

/* =====================================================================
   5. Плеер: состояния, реконнект, громкость, идемпотентность
   ===================================================================== */
section("5. Плеер");

/** Подделка <audio>: те же события, но без реального звука. */
class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = "";
    this.volume = 1;
    this.muted = false;
    this.preload = "";
    this.error = null;
    this.paused = true;
    this.loadCount = 0;
    this.playCount = 0;
    this.behavior = "ok"; // ok | error
  }

  load() {
    this.loadCount += 1;
  }

  play() {
    this.playCount += 1;
    if (this.behavior === "error") {
      this.error = { code: 4 };
      return Promise.reject(Object.assign(new Error("nope"), { name: "NotSupportedError" }));
    }
    this.paused = false;
    setTimeout(() => this.dispatchEvent(new Event("playing")), 0);
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  removeAttribute() {
    this.src = "";
  }
}

{
  const env = await makeEnv(html);
  globalThis.Audio = FakeAudio;
  const { Player, STATE } = await importFresh("js/player.js");
  const stations = env.catalog.stations;
  const lounge = stations.filter((s) => s.groupId === "lounge");

  // 5.1 — успешный старт
  const created = [];
  const player = new Player({
    createAudio: () => {
      const audio = new FakeAudio();
      created.push(audio);
      return audio;
    },
    reconnectDelays: [5, 5, 5],
    suggestNext: () => lounge[1],
  });
  await player.play(lounge[0]);
  await tick(10);
  check("после play состояние playing", player.state === STATE.PLAYING, `фактически ${player.state}`);
  check("аудио получило прямой https-URL станции", created[0]?.src === lounge[0].url, `src=${created[0]?.src}`);

  // 5.2 — идемпотентный повторный клик
  await player.play(lounge[0]);
  await tick(10);
  check("повторный play той же станции не перезапускает поток", created[0].playCount === 1, `playCount=${created[0].playCount}`);

  // 5.3 — громкость и mute переживают «перезагрузку»
  player.setVolume(0.42);
  player.setMuted(true);
  check("joer:volume записан", env.window.localStorage.getItem("joer:volume") === "0.42", env.window.localStorage.getItem("joer:volume"));
  check("joer:muted записан", env.window.localStorage.getItem("joer:muted") === "true");
  const player2 = new Player({ createAudio: () => new FakeAudio(), reconnectDelays: [5, 5, 5] });
  check("громкость восстанавливается из хранилища", player2.volume === 0.42, `${player2.volume}`);
  check("mute восстанавливается из хранилища", player2.muted === true);

  // 5.4 — нерабочий поток: 3 попытки и предложение следующей станции
  const broken = [];
  const brokenPlayer = new Player({
    createAudio: () => {
      const audio = new FakeAudio();
      audio.behavior = "error";
      broken.push(audio);
      return audio;
    },
    reconnectDelays: [5, 5, 5],
    stallTimeout: 40,
    suggestNext: () => lounge[2],
  });
  let exhausted = null;
  brokenPlayer.addEventListener("exhausted", (event) => {
    exhausted = event.detail;
  });
  await brokenPlayer.play(lounge[0]);
  await tick(120);
  check("после провала состояние error", brokenPlayer.state === STATE.ERROR, `фактически ${brokenPlayer.state}`);
  check("сделано 4 попытки (1 + 3 реконнекта)", broken[0].loadCount === 4, `loadCount=${broken[0].loadCount}`);
  check("событие exhausted содержит следующую станцию", exhausted?.suggestion?.id === lounge[2].id, JSON.stringify(exhausted?.suggestion?.id));

  env.window.close();
}

/* =====================================================================
   6. Клик по карточке запускает поток
   ===================================================================== */
section("6. Клик по карточке");

{
  const env = await makeEnv(html);
  const created = [];
  class TrackedAudio extends FakeAudio {
    constructor() {
      super();
      created.push(this);
    }
  }
  globalThis.Audio = TrackedAudio;
  const app = await importFresh("js/app.js");
  await tick(30);

  const firstCard = env.document.querySelector(".card");
  const expectedUrl = env.catalog.stations.find((s) => s.id === firstCard.dataset.stationId).url;
  firstCard.querySelector(".card-play").click();
  await tick(30);

  check("плеер получил URL станции", created[0]?.src === expectedUrl, `src=${created[0]?.src}`);
  check("плеер в состоянии playing", app.player.state === "playing", `фактически ${app.player.state}`);
  check("карточка помечена как играющая", firstCard.classList.contains("is-playing"));
  check("в плеере показано имя станции", env.document.getElementById("player-station").textContent === firstCard.querySelector(".card-name").textContent);
  check("последняя станция сохранена", env.window.localStorage.getItem("joer:lastStation") === JSON.stringify(firstCard.dataset.stationId));

  // Пауза по клику
  env.document.getElementById("player-toggle").click();
  await tick(10);
  check("клик по play/pause ставит паузу", app.player.state === "paused", `фактически ${app.player.state}`);

  // Станции из трёх разных групп запускаются кликом
  for (const groupId of ["club", "romantic", "jazz"]) {
    env.document.querySelector(`.group-tab[data-group-id="${groupId}"]`).click();
    await tick(10);
    const card = env.document.querySelector(".card");
    const url = env.catalog.stations.find((s) => s.id === card.dataset.stationId).url;
    card.querySelector(".card-play").click();
    await tick(20);
    const last = created[created.length - 1];
    check(`клик по станции группы ${groupId} запускает её поток`, last?.src === url && app.player.state === "playing", `src=${last?.src} state=${app.player.state}`);
  }

  env.window.close();
}

/* =====================================================================
   7. UI каталога: поиск, избранное, клавиатура
   ===================================================================== */
section("7. UI каталога");

{
  const env = await makeEnv(html);
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(30);

  const search = env.document.getElementById("search");
  const typeInto = (value) => {
    search.value = value;
    search.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  };

  const matches = (q) =>
    env.catalog.stations.filter((s) =>
      [s.name, s.provider, s.mood, ...s.genres].join(" ").toLowerCase().includes(q.toLowerCase()),
    );

  const t0 = performance.now();
  typeInto("downtempo");
  await tick(5);
  const searchMs = performance.now() - t0;
  const found = env.document.querySelectorAll(".card").length;
  check("поиск фильтрует по жанру во всём каталоге", found === matches("downtempo").length, `${found} vs ${matches("downtempo").length}`);
  check("поиск быстрее 50 мс", searchMs < 50, `${searchMs.toFixed(1)} мс`);
  check("в поиске видны станции разных групп", found > 4, `найдено ${found}`);

  typeInto("SomaFM");
  await tick(5);
  check("поиск по провайдеру", env.document.querySelectorAll(".card").length === matches("somafm").length);

  typeInto("zzzz-нет-такого");
  await tick(5);
  check("пустое состояние поиска", /Ничего не нашлось/.test(env.document.getElementById("station-grid").textContent));
  check("кнопка очистки видна", env.document.getElementById("search-clear").hidden === false);

  app.clearSearch();
  await tick(5);
  check("очистка возвращает группу", env.document.querySelectorAll(".card").length >= 6);

  // Избранное: сортировка и персистентность
  const cards = [...env.document.querySelectorAll(".card")];
  const pickSecond = cards[2];
  pickSecond.querySelector(".card-fav").click();
  await tick(5);
  check("избранная станция первая в списке", env.document.querySelector(".card").dataset.stationId === pickSecond.dataset.stationId);
  check(
    "aria-pressed у избранного = true",
    env.document.querySelector(".card-fav").getAttribute("aria-pressed") === "true",
  );

  // Клавиатура: стрелки переключают группы
  const tabs = [...env.document.querySelectorAll(".group-tab")];
  tabs[0].focus();
  tabs[0].dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await tick(5);
  const pressed = env.document.querySelector('.group-tab[aria-pressed="true"]');
  check("стрелка вправо выбирает следующую группу", pressed?.dataset.groupId === tabs[1].dataset.groupId, pressed?.dataset.groupId);
  check(
    "после перерендера фокус остался на табах",
    env.document.activeElement?.classList?.contains("group-tab") === true,
    String(env.document.activeElement?.className),
  );
  check(
    "ровер-фокус: только один таб в порядке Tab",
    env.document.querySelectorAll('.group-tab[tabindex="0"]').length === 1,
  );

  // Enter на карточке запускает станцию
  const card = env.document.querySelector(".card");
  card.querySelector(".card-play").dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  card.querySelector(".card-play").click();
  await tick(20);
  check("активация карточки с клавиатуры запускает поток", app.player.state === "playing", app.player.state);

  env.window.close();
}

/* =====================================================================
   8. Темы: авто/ручной режим, персистентность
   ===================================================================== */
section("8. Темы");

{
  const env = await makeEnv(html);
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(30);

  const rootTheme = () => env.document.documentElement.dataset.theme;
  const metaColor = () => env.document.querySelector('meta[name="theme-color"]').getAttribute("content");

  check("тема по умолчанию — lounge", rootTheme() === "lounge", rootTheme());
  check("meta theme-color соответствует теме", metaColor() === "#0b0f1e", metaColor());

  env.document.querySelector('.group-tab[data-group-id="club"]').click();
  await tick(10);
  check("авто-режим: группа Club → тема club", rootTheme() === "club", rootTheme());
  check("meta theme-color обновился", metaColor() === "#0a0612", metaColor());

  env.document.querySelector('.group-tab[data-group-id="jazz"]').click();
  await tick(10);
  check("авто-режим: группа Jazz → тема velvet", rootTheme() === "velvet", rootTheme());

  // Ручной выбор
  app.themes.setMode("space");
  await tick(10);
  check("ручной выбор применяет тему", rootTheme() === "space", rootTheme());
  check("ручной выбор сохранён", env.window.localStorage.getItem("joer:theme") === '"space"', env.window.localStorage.getItem("joer:theme"));

  env.document.querySelector('.group-tab[data-group-id="romantic"]').click();
  await tick(10);
  check("ручная тема не сбрасывается при смене группы", rootTheme() === "space", rootTheme());

  app.themes.setMode("auto");
  await tick(10);
  check("возврат в авто — тема снова следует за группой", rootTheme() === "romantic", rootTheme());
  check("авто сохранено в хранилище", env.window.localStorage.getItem("joer:theme") === '"auto"');

  // Селектор темы в UI
  const picker = env.document.getElementById("theme-picker");
  env.document.getElementById("theme-picker-btn").click();
  await tick(5);
  check("меню темы открывается", picker.dataset.open === "true" && env.document.getElementById("theme-menu").hidden === false);
  env.document.querySelector('.theme-option[data-mode="club"]').click();
  await tick(10);
  check("выбор темы в меню меняет data-theme", rootTheme() === "club", rootTheme());
  check("меню закрывается после выбора", picker.dataset.open === "false");
  check(
    "aria-checked отражает выбор",
    env.document.querySelector('.theme-option[data-mode="club"]').getAttribute("aria-checked") === "true",
  );

  // Интенсивность атмосферы
  const intensity = env.document.getElementById("intensity");
  intensity.value = "40";
  intensity.dispatchEvent(new env.window.Event("change", { bubbles: true }));
  await tick(5);
  check("интенсивность сохраняется", env.window.localStorage.getItem("joer:intensity") === "0.4", env.window.localStorage.getItem("joer:intensity"));
  check("интенсивность в состоянии приложения", app.state.intensity === 0.4, String(app.state.intensity));
  check("подпись интенсивности обновилась", env.document.getElementById("intensity-value").textContent === "40%");

  env.window.close();
}

/* =====================================================================
   9. Атмосферный движок
   ===================================================================== */
section("9. Атмосфера");

{
  const env = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(80);
  const atmo = app.atmosphere;
  const stub = env.dom.canvasStub;

  check("движок получил 2D-контекст", atmo.disabled === false);
  check("цикл rAF запущен", atmo.raf !== null);
  check("DPR ограничен сверху", atmo.canvas.width <= Math.round((env.window.innerWidth || 1024) * 2));

  const scenePairs = [
    ["waves", "lounge"],
    ["rings", "club"],
    ["bokeh", "romantic"],
    ["stars", "space"],
    ["vinyl", "velvet"],
  ];

  for (const [sceneId, themeId] of scenePairs) {
    const before = stub.calls.length;
    atmo.setScene(sceneId);
    atmo.draw(atmo.outgoing);
    const drawn = stub.calls.length - before;
    check(`сцена ${sceneId} (${themeId}) рисуется без ошибок`, drawn > 20, `операций: ${drawn}`);
  }

  // Кроссфейд при смене сцены
  atmo.setScene("stars");
  check("смена сцены начинает кроссфейд", atmo.fade === 0 && Boolean(atmo.outgoing));
  const faded = await waitFor(() => atmo.fade === 1);
  check("кроссфейд сцен завершается (800 мс времени сцены)", faded, `fade=${atmo.fade}`);

  // Энергия и интенсивность влияют на живость
  atmo.setIntensity(1);
  atmo.setEnergy(5);
  const fast = atmo.speed;
  atmo.setEnergy(1);
  const slow = atmo.speed;
  check("энергия станции ускоряет сцену", fast > slow, `${fast.toFixed(2)} > ${slow.toFixed(2)}`);
  atmo.setIntensity(0.1);
  check("интенсивность пользователя замедляет сцену", atmo.speed < slow, `${atmo.speed.toFixed(2)} < ${slow.toFixed(2)}`);
  atmo.setIntensity(0.75);

  // Пауза «усыпляет» сцену, play возвращает
  atmo.setPlayerState("playing");
  await waitFor(() => atmo.motion > 0.6);
  const lively = atmo.motion;
  atmo.setPlayerState("paused");
  await waitFor(() => atmo.motion < lively * 0.5);
  const sleepy = atmo.motion;
  check("на паузе сцена плавно замирает", sleepy < lively * 0.5, `${sleepy.toFixed(3)} < ${lively.toFixed(3)}`);
  atmo.setPlayerState("playing");
  await waitFor(() => atmo.motion > sleepy * 2);
  check("после play сцена плавно оживает", atmo.motion > sleepy * 2, `motion=${atmo.motion.toFixed(3)} после ${sleepy.toFixed(3)}`);

  // Скрытая вкладка — цикл остановлен
  Object.defineProperty(env.document, "hidden", { value: true, configurable: true });
  env.document.dispatchEvent(new env.window.Event("visibilitychange"));
  check("в скрытой вкладке rAF остановлен", atmo.raf === null);
  Object.defineProperty(env.document, "hidden", { value: false, configurable: true });
  env.document.dispatchEvent(new env.window.Event("visibilitychange"));
  check("при возврате на вкладку цикл возобновлён", atmo.raf !== null);

  env.window.close();
}

/* =====================================================================
   10. reduced-motion и аудио-реактивность
   ===================================================================== */
section("10. reduced-motion и реактивность");

{
  const env = await makeEnv(html, { canvas: "stub", reduceMotion: true });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(80);
  const atmo = app.atmosphere;
  check("reduced-motion: цикл не запускается", atmo.raf === null);
  check("reduced-motion: рисуется статичная композиция", env.dom.canvasStub.calls.length > 20, `операций: ${env.dom.canvasStub.calls.length}`);
  env.window.close();
}

{
  const env = await makeEnv(html);
  const { createReactivity, stationSupportsReactivity } = await importFresh("js/audio-reactivity.js");

  check("в каталоге нет станций с CORS — слой реактивности спит", env.catalog.stations.every((st) => stationSupportsReactivity(st) === false));
  check("без AudioContext возвращаем null", createReactivity({}, { onLevels() {}, onFallback() {} }) === null);

  // AudioContext есть, но подключение к потоку падает → фолбэк, без звука не остаёмся
  let fallbackReason = null;
  globalThis.AudioContext = class {
    constructor() {
      this.state = "running";
    }

    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 512, connect() {}, disconnect() {}, getByteFrequencyData() {} };
    }

    createMediaElementSource() {
      throw new DOMException("cross-origin", "SecurityError");
    }

    get destination() {
      return {};
    }

    close() {}
  };
  const controller = createReactivity({}, { onLevels() {}, onFallback: (error) => { fallbackReason = error; } });
  check("ошибка Web Audio → немедленный фолбэк", controller === null && fallbackReason !== null, String(fallbackReason?.message));
  delete globalThis.AudioContext;
  env.window.close();
}

/* =====================================================================
   11. Возврат: «Продолжить», группа, PWA-атрибуты
   ===================================================================== */
section("11. Возврат и PWA");

{
  const env = await makeEnv(html);
  globalThis.Audio = FakeAudio;
  const lastId = env.catalog.stations[3].id;
  env.window.localStorage.setItem("joer:lastStation", JSON.stringify(lastId));
  env.window.localStorage.setItem("joer:group", JSON.stringify(env.catalog.stations[3].groupId));

  const app = await importFresh("js/app.js");
  await tick(30);

  const resume = env.document.getElementById("resume");
  check("кнопка «Продолжить» показана при последней станции", resume.hidden === false);
  check(
    "в кнопке имя последней станции",
    resume.querySelector("#resume-text").textContent.includes(env.catalog.stations[3].name),
    resume.querySelector("#resume-text").textContent,
  );
  check("активная группа восстановлена", app.state.activeGroupId === env.catalog.stations[3].groupId, app.state.activeGroupId);

  resume.click();
  await tick(30);
  check("«Продолжить» запускает станцию одним кликом", app.player.state === "playing", app.player.state);
  check("после старта кнопка «Продолжить» скрывается", resume.hidden === true);

  const manifest = JSON.parse(read("manifest.webmanifest"));
  check("манифест: name/short_name/start_url", Boolean(manifest.name) && Boolean(manifest.short_name) && manifest.start_url === "./");
  check("манифест: иконки 192/512/maskable", manifest.icons.length >= 3 && manifest.icons.some((i) => i.purpose === "maskable"));
  check("манифест: файлы иконок существуют", manifest.icons.every((i) => existsSync(path.join(ROOT, i.src))));

  env.window.close();
}

/* =====================================================================
   Итог
   ===================================================================== */
console.log(`\nИтого: ${passed} ок, ${failed} провалено.`);
if (failed) {
  console.log(`Провалено: ${failures.join("; ")}`);
  process.exit(1);
}
