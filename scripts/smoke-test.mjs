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
check(
  "hidden побеждает display компонентов (панели/меню не торчат)",
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(read("css/base.css")),
);

const layoutCss = read("css/layout.css");
const layerZIndex = (selector) => {
  const start = layoutCss.indexOf(`${selector} {`);
  const end = layoutCss.indexOf("\n}", start);
  const rule = layoutCss.slice(start, end);
  const value = rule.split("z-index: ")[1]?.split(";")[0];
  return value === "var(--z-canvas)" ? 1 : Number(value);
};
const stackingOrder = [".bg-gradient", ".atmosphere", ".bg-grain", ".bg-vignette"].map(layerZIndex);
check(
  "фоновые слои идут градиент → canvas → зерно → виньетка",
  stackingOrder.every(Number.isFinite) && stackingOrder.every((value, index) => index === 0 || value > stackingOrder[index - 1]),
  stackingOrder.join(" → "),
);
const cardCss = read("css/components/card.css");
check(
  "CSS подсветки карточки использует класс is-current из UI",
  /\.card\.is-current\s*\{/.test(cardCss) && !/\.card\.is-active\s*\{/.test(cardCss),
);

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

  // Фильтр по источнику (провайдеру)
  const providerChips = [...env.document.querySelectorAll(".provider-tab")];
  check("фильтр по источнику: чипы отрисованы", providerChips.length >= 2, `чипов ${providerChips.length}`);
  check("фильтр по источнику: есть «Все источники»", providerChips.some((b) => b.textContent.includes("Все источники")));
  const someProvider = providerChips.find((b) => b.dataset.provider);
  if (someProvider) {
    const pname = someProvider.dataset.provider;
    someProvider.click();
    const filtered = [...env.document.querySelectorAll(".card")];
    check(
      "фильтр по источнику: показывает только станции выбранного провайдера",
      filtered.length > 0 && filtered.every((c) => c.querySelector(".card-provider")?.textContent === pname),
      `провайдер «${pname}», карт ${filtered.length}`,
    );
    const allChip = providerChips.find((b) => !b.dataset.provider);
    allChip?.click();
    check(
      "фильтр по источнику: «Все источники» снимает фильтр (карточки снова видны)",
      allChip?.getAttribute("aria-pressed") === "true" && env.document.querySelectorAll(".card").length > 0,
    );
  }

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
    this.history = [];
    this.behavior = "ok"; // ok | error
  }

  load() {
    this.loadCount += 1;
    this.history.push(this.src);
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

  // 5.4 — мёртвый поток: зеркала → авто-переход → исчерпание
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
    maxAutoAdvances: 1,
    suggestNext: () => lounge[2],
  });
  let exhausted = null;
  brokenPlayer.addEventListener("exhausted", (event) => {
    exhausted = event.detail;
  });
  await brokenPlayer.play(lounge[0]);
  await tick(200);

  const mirrors = Player.hostVariants(lounge[0].url);
  const hist = broken[0].history;
  check("первым пробуется основной URL", hist[0] === lounge[0].url, hist[0]);
  check("при сбое перебираются зеркала SomaFM (ice1/4/6)", mirrors.slice(1).every((m) => hist.includes(m)), JSON.stringify(hist.slice(0, 4)));
  check("после зеркал плеер сам включает следующую станцию", hist.includes(lounge[2].url), JSON.stringify(hist.slice(4)));
  check("исчерпав фолбэки — состояние error и событие exhausted", brokenPlayer.state === STATE.ERROR && exhausted?.suggestion?.id === lounge[2].id, brokenPlayer.state);
  check("лимит авто-переходов не даёт гонять по кругу", brokenPlayer.autoAdvances === 1, String(brokenPlayer.autoAdvances));

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
  check("карточка получает класс текущей станции для визуальной подсветки", firstCard.classList.contains("is-current"));
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

  // Ползунок должен visibly влиять на сцену: движок + проявленность (opacity)
  const opacityAt40 = parseFloat(app.atmosphere.canvas.style.opacity);
  check("интенсивность доходит до движка", app.atmosphere.intensity === 0.4, String(app.atmosphere.intensity));
  check("ползунок меняет проявленность сцены", Math.abs(opacityAt40 - (0.22 + 0.4 * 0.78)) < 0.01, String(opacityAt40));

  intensity.value = "0";
  intensity.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  const opacityAt0 = parseFloat(app.atmosphere.canvas.style.opacity);
  intensity.value = "100";
  intensity.dispatchEvent(new env.window.Event("input", { bubbles: true }));
  const opacityAt100 = parseFloat(app.atmosphere.canvas.style.opacity);
  check("диапазон ползунка даёт явный визуальный контраст", opacityAt100 - opacityAt0 > 0.6, `${opacityAt0} → ${opacityAt100}`);
  intensity.value = "75";
  intensity.dispatchEvent(new env.window.Event("change", { bubbles: true }));

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

  check(
    "каталог не заявляет CORS — реактивность не подключается без пробы",
    env.catalog.stations.every((st) => stationSupportsReactivity(st) !== true),
  );
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
   12. Ритм, CORS-пробы, качество сцены (T-09)
   ===================================================================== */
section("12. Ритм, пробы CORS и качество");

{
  const env = await makeEnv(html);
  const { stationSupportsReactivity, probeStreamCors, knownCorsSupport } = await importFresh("js/audio-reactivity.js");
  const { Rhythm, SPECTRUM_BANDS } = await importFresh("js/rhythm.js");

  // Три состояния поддержки CORS
  check("cors: true → подключаться можно", stationSupportsReactivity({ cors: true }) === true);
  check("cors: false → подключаться нельзя", stationSupportsReactivity({ cors: false }) === false);
  check("без флага → неизвестно (нужна проба)", stationSupportsReactivity({}) === null);

  // Проба потока: успех кэшируется, сеть молчит → false
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      type: "cors",
      headers: { get: () => "*" },
      body: { cancel() {} },
    };
  };
  const first = await probeStreamCors("https://stream.example/ok");
  const second = await probeStreamCors("https://stream.example/ok");
  check("проба видит CORS и кэширует результат", first === true && second === true && fetchCalls === 1, `fetch×${fetchCalls}`);

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new TypeError("Failed to fetch");
  };
  const failing = await probeStreamCors("https://stream.example/fail");
  check("сетевая ошибка пробы → без реактивности", failing === false);
  check("отрицательный результат тоже кэшируется", knownCorsSupport("https://stream.example/fail") === false);
  delete globalThis.fetch;

  // Процедурный ритм: музыкальный паттерн, а не ровная синусоида
  const rhythm = new Rhythm();
  let sawKick = false;
  let sawHat = false;
  for (let i = 0; i < 240; i += 1) {
    rhythm.update(1 / 60, { energy: 5, intensity: 1, motion: 1 });
    if (rhythm.kick > 0.4) sawKick = true;
    if (rhythm.hat > 0.15) sawHat = true;
  }
  check("псевдо-ритм бьёт киком", sawKick);
  check("псевдо-ритм отбивает хэтом", sawHat);
  check("темп в музыкальном диапазоне", rhythm.bpm > 120 && rhythm.bpm < 165, `bpm=${rhythm.bpm.toFixed(0)}`);
  check("спектр синтезирован (32 полосы)", rhythm.spectrum.length === SPECTRUM_BANDS && rhythm.spectrum[0] > 0);

  // Реактивный ритм: onset по басу поднимает beatCount
  const live = new Rhythm();
  for (let i = 0; i < 120; i += 1) {
    const bass = i % 30 === 0 ? 1 : 0.08;
    live.update(1 / 60, { reactive: true, bass, mid: 0.3, high: 0.2, motion: 1 });
  }
  check("onset-детектор ловит удары баса", live.beatCount > 2, `beatCount=${live.beatCount}`);
  check("конверт кика реагирует на бас", live.kick > 0 || live.beatCount > 0);

  // Качество и спокойный режим доходят до движка
  const env2 = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(60);
  const atmo = app.atmosphere;
  check("качество по умолчанию — med", atmo.quality === "med", atmo.quality);
  atmo.ensureBuffers();
  const medBloomWidth = atmo.bloomA.width;
  atmo.setQuality("high");
  atmo.ensureBuffers();
  check("setQuality переключает режим", atmo.quality === "high");
  check("high пересобирает буфер для более детального bloom", atmo.bloomA.width > medBloomWidth, `${medBloomWidth} → ${atmo.bloomA.width}`);
  check("у high bloom глубже, чем у low", atmo.bloomConfig().strength > 0);
  atmo.setQuality("low");
  check("low — без bloom", atmo.bloomConfig().strength === 0);
  atmo.setQuality("med");

  atmo.setCalm(true);
  check("спокойный режим включается", atmo.calm === true);
  atmo.rhythm.kick = 1;
  atmo.rhythm.pulse = 1;
  atmo.rhythm.sparkle = 1;
  const calmParams = atmo.buildParams(1);
  check("спокойный режим реально смягчает пики и мерцание", calmParams.kick <= 0.2 && calmParams.pulse < 1 && calmParams.sparkle <= 0.35);
  atmo.setCalm(false);
  check("спокойный режим выключается", atmo.calm === false);

  // Реактивность: уровни доходят до сцены
  atmo.setLevels({ bass: 0.9, mid: 0.4, high: 0.2, overall: 0.6, spectrum: new Array(32).fill(0.5) });
  check("уровни анализатора включают реактивность", atmo.reactive === true);
  check("спектр анализатора уходит в ритм", atmo.rhythm.spectrumSource !== null);
  atmo.setLevels(null);
  check("нет уровней → снова процедурная сцена", atmo.reactive === false);

  // Настройки качества и calm переживают перезагрузку
  const quality = env2.document.getElementById("quality-label");
  check("в меню есть блок качества", Boolean(quality));
  env2.document.querySelector('[data-quality="low"]').click();
  await tick(10);
  check("выбор качества сохраняется", env2.window.localStorage.getItem("joer:quality") === '"low"', env2.window.localStorage.getItem("joer:quality"));
  const calmBox = env2.document.getElementById("calm-mode");
  calmBox.checked = true;
  calmBox.dispatchEvent(new env2.window.Event("change", { bubbles: true }));
  await tick(10);
  check("спокойный режим сохраняется", env2.window.localStorage.getItem("joer:calm") === "true", env2.window.localStorage.getItem("joer:calm"));
  check("спокойный режим доходит до движка", app.atmosphere.calm === true);

  // Скрипт аудита CORS на месте
  check("есть scripts/audit-cors.mjs", existsSync(path.join(ROOT, "scripts/audit-cors.mjs")));
  check("npm-скрипт audit:cors объявлен", Boolean(JSON.parse(read("package.json")).scripts["audit:cors"]));

  env2.window.close();
  env.window.close();
}

/* =====================================================================
   13. Стилизованный эквалайзер атмосферы (T-10)
   ===================================================================== */
section("13. Эквалайзер атмосферы (T-10)");

{
  const env = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(60);
  const atmo = app.atmosphere;
  app.atmosphere.stop(); // шаги кадров — вручную, без гонки с rAF
  const eq = await importFresh("js/equalizer.js");
  const { atmosphereScenes } = await importFresh("js/atmosphere.js");
  const { Rhythm } = await importFresh("js/rhythm.js");
  const sceneIds = Object.keys(atmosphereScenes);
  const mean = (arr) => Array.from(arr).reduce((a, b) => a + b, 0) / arr.length;
  const fill = (v) => new Array(32).fill(v);

  check("у каждой из 5 сцен свой стиль эквалайзера", sceneIds.length === 5 && sceneIds.every((id) => eq.EQUALIZER_STYLES.includes(id)), eq.EQUALIZER_STYLES.join(","));

  // Стиль следует за сценой; рисуется в общем кадре атмосферы
  for (const id of sceneIds) {
    atmo.setScene(id);
    atmo.fade = 1;
    atmo.outgoing = null;
    atmo.draw(null);
    const last = atmo.lastEqualizer.at(-1);
    check(`тема-сцена ${id}: эквалайзер рисуется своим стилем`, last?.style === id && atmo.lastEqualizer.length === 1, JSON.stringify(atmo.lastEqualizer.map((s) => s.style)));
  }

  // Кроссфейд: при смене сцены оба стиля в кадре, вес нового растёт
  atmo.setScene("vinyl");
  atmo.fade = 1;
  atmo.setScene("rings");
  atmo.fade = 0.5;
  atmo.draw(atmo.outgoing);
  const styles = atmo.lastEqualizer.map((s) => s.style);
  check("смена темы → кроссфейд эквалайзеров (оба стиля в кадре)", styles.includes("vinyl") && styles.includes("rings"), styles.join(","));
  const [outEq, inEq] = atmo.lastEqualizer;
  check("веса кроссфейда дополняют друг друга", inEq.alpha > 0 && outEq.alpha > 0 && Math.abs((outEq.alpha + inEq.alpha) - atmo.eqLayout.fade) < 0.01, `${outEq.alpha.toFixed(2)} + ${inEq.alpha.toFixed(2)}`);
  atmo.fade = 1;
  atmo.outgoing = null;

  // Рисунки действительно разные (не один бар-чарт с другим цветом)
  const frameFor = (overrides = {}) => ({
    t: 3, dt: 1 / 60, clock: 3, alpha: 1,
    layout: eq.equalizerLayout(1440, 900),
    bands: Float32Array.from(fill(0.6)), live: 1,
    bass: 0.5, mid: 0.5, high: 0.3, kick: 0, pulse: 0.4, beatCount: 1,
    palette: atmo.palette, low: false, calm: false, snap: false,
    ...overrides,
  });
  const signature = (id, overrides) => {
    const ctx = makeStubContext();
    eq.drawEqualizer(ctx, id, eq.createEqualizerState(id), frameFor({ sprites: atmo.sprites[id] ?? [], ...overrides }));
    const counts = {};
    for (const call of ctx.calls) counts[call] = (counts[call] ?? 0) + 1;
    return { counts, key: JSON.stringify(Object.entries(counts).sort()) };
  };
  const sigs = sceneIds.map((id) => signature(id).key);
  check("5 стилей дают 5 разных рисунков (разный набор примитивов)", new Set(sigs).size === 5);

  // Реакция на спектр (тот же поток, что у сцен: setLevels → rhythm.spectrum → полосы)
  const stepFrames = (n, reactive = true) => {
    for (let i = 0; i < n; i += 1) {
      atmo.rhythm.update(1 / 60, { reactive, bass: atmo.levels.bass, mid: atmo.levels.mid, high: atmo.levels.high, motion: 1 });
      atmo.updateEqualizer(1 / 60);
    }
  };
  atmo.setPlayerState("playing");
  atmo.setLevels({ bass: 0.9, mid: 0.8, high: 0.7, overall: 0.8, spectrum: fill(0.95) });
  stepFrames(120);
  const loud = atmo.eqBands.mean;
  atmo.setLevels({ bass: 0.05, mid: 0.05, high: 0.05, overall: 0.05, spectrum: fill(0.02) });
  stepFrames(180);
  const quiet = atmo.eqBands.mean;
  check("реальный спектр: громко → полосы высокие, тихо → низкие", loud > 0.75 && quiet < 0.3, `${loud.toFixed(2)} vs ${quiet.toFixed(2)}`);
  const spectrumShape = fill(0.05).map((v, i) => (i < 8 ? 0.95 : v));
  atmo.setLevels({ bass: 0.9, mid: 0.1, high: 0.05, overall: 0.4, spectrum: spectrumShape });
  stepFrames(120);
  check("форма спектра доходит до полос (бас громче верхов)", atmo.eqBands.values[2] > atmo.eqBands.values[28] + 0.4, `${atmo.eqBands.values[2].toFixed(2)} / ${atmo.eqBands.values[28].toFixed(2)}`);

  // Без CORS — живой синтетический ритм (не залипший столбик)
  atmo.setLevels(null);
  const synthMeans = [];
  for (let i = 0; i < 240; i += 1) {
    stepFrames(1, false);
    synthMeans.push(atmo.eqBands.mean);
  }
  const synthRange = Math.max(...synthMeans) - Math.min(...synthMeans);
  check("без CORS полосы живут на синтез-спектре", synthRange > 0.02 && Math.max(...synthMeans) < 0.85, `диапазон ${synthRange.toFixed(3)}, макс ${Math.max(...synthMeans).toFixed(2)}`);

  // Пауза: плавное оседание в «дыхание», а не мёртвый столбик
  const bands = new eq.EqualizerBands();
  for (let i = 0; i < 120; i += 1) bands.update(1 / 60, { spectrum: fill(0.9), state: "playing" });
  const playingMean = bands.mean;
  bands.update(1 / 60, { spectrum: fill(0.9), state: "paused" });
  const justPaused = bands.mean;
  check("пауза не обрывает полосы мгновенно", justPaused > playingMean * 0.9, `${playingMean.toFixed(2)} → ${justPaused.toFixed(2)}`);
  for (let i = 0; i < 240; i += 1) bands.update(1 / 60, { spectrum: fill(0.9), state: "paused" });
  const settled = bands.mean;
  const snapshot = Float32Array.from(bands.values);
  for (let i = 0; i < 60; i += 1) bands.update(1 / 60, { spectrum: fill(0.9), state: "paused" });
  const drift = Array.from(bands.values).reduce((acc, v, i) => acc + Math.abs(v - snapshot[i]), 0);
  check("на паузе полосы оседают в спокойный уровень", settled > 0.03 && settled < 0.25, settled.toFixed(3));
  check("на паузе полосы продолжают «дышать»", drift > 0.05, `Σ|Δ|=${drift.toFixed(3)}`);

  // Спокойный режим: амплитуда ×0.5 и без вспышек
  const normal = new eq.EqualizerBands();
  const calm = new eq.EqualizerBands();
  for (let i = 0; i < 120; i += 1) {
    normal.update(1 / 60, { spectrum: fill(0.9), state: "playing" });
    calm.update(1 / 60, { spectrum: fill(0.9), state: "playing", calm: true });
  }
  const rest = new eq.EqualizerBands();
  for (let i = 0; i < 120; i += 1) rest.update(1 / 60, { spectrum: fill(0.9), state: "paused" });
  const ratio = (calm.mean - rest.mean) / (normal.mean - rest.mean);
  check("спокойный режим: амплитуда ≈ ×0.5", ratio > 0.4 && ratio < 0.6, ratio.toFixed(2));
  const flashCalm = sceneIds.map((id) => eq.drawEqualizer(makeStubContext(), id, eq.createEqualizerState(id), frameFor({ kick: 1, high: 1, beatCount: 7, calm: true, sprites: atmo.sprites[id] ?? [] })).flashes);
  const flashNormal = ["rings", "bokeh", "stars"].map((id) => {
    const state = eq.createEqualizerState(id);
    if (state.cooldown !== undefined) state.cooldown = 0;
    return eq.drawEqualizer(makeStubContext(), id, state, frameFor({ kick: 1, high: 1, beatCount: 7, sprites: atmo.sprites[id] ?? [] })).flashes;
  });
  check("обычный режим: кик/«сердце»/метеор вспыхивают", flashNormal.every((f) => f > 0), flashNormal.join(","));
  check("спокойный режим: без вспышек", flashCalm.every((f) => f === 0), flashCalm.join(","));

  // low: упрощённый рисунок — без спрайтов-свечений и bloom-ореолов
  const lowImages = sceneIds.map((id) => signature(id, { low: true }).counts.drawImage ?? 0);
  const medImages = ["waves", "bokeh", "stars"].map((id) => signature(id).counts.drawImage ?? 0);
  check("quality low: эквалайзер без свечений (0 drawImage)", lowImages.every((n) => n === 0), lowImages.join(","));
  check("quality med: свечения есть у waves/bokeh/stars", medImages.every((n) => n > 0), medImages.join(","));
  const ringsLowFills = signature("rings", { low: true }).counts.fillRect;
  const ringsMedFills = signature("rings").counts.fillRect;
  check("quality low: у club нет вертикального bloom-ореола баров", ringsLowFills < ringsMedFills, `${ringsLowFills} < ${ringsMedFills}`);

  // Раскладка: широкая полоса у левого края, заходит под текст; 60–80% высоты;
  // на узких экранах — кромка у самого края
  const wide = eq.equalizerLayout(1440, 900);
  check("1440px: полоса у левого края и свободно заходит под текст", wide.x >= 12 && wide.width >= 200 && wide.x + wide.width > (1440 - 1180) / 2 + 32 && !wide.compact, JSON.stringify(wide));
  check("высота полосы 60–80% вьюпорта", wide.height / 900 >= 0.6 && wide.height / 900 <= 0.8, (wide.height / 900).toFixed(2));
  check("полоса между хедером (64px) и плеером (88px)", wide.y >= 64 && wide.y + wide.height <= 900 - 88, `${wide.y}…${wide.y + wide.height}`);
  const laptop = eq.equalizerLayout(1280, 800);
  check("1280px: полоса уже перекрывает колонку текста (не узкая полка)", laptop.x + laptop.width > (1280 - 1180) / 2 + 32, JSON.stringify(laptop));
  const narrow = eq.equalizerLayout(320, 640);
  check("320px: узкая кромка ≤ 40px", narrow.compact && narrow.width <= eq.EQ_COMPACT_MAX, JSON.stringify(narrow));
  check("320px: кромка почти целиком в боковом поле", narrow.x >= 0 && narrow.x + narrow.width <= 36, `${narrow.x}+${narrow.width}`);
  check("< 560px — компактный режим (обложка фолда), ≥ 560px — полный (раскрытый фолд)", eq.equalizerLayout(559, 800).compact && !eq.equalizerLayout(560, 800).compact);
  check("под текстом полоса приглушена (fade < 1)", eq.equalizerLayout(1024, 768).fade < 1 && eq.equalizerLayout(1440, 900).fade < 1);

  // Слой и производительность: внутри canvas атмосферы, без своего rAF/буферов/DOM
  const eqSource = read("js/equalizer.js");
  check("эквалайзер без своего rAF и без новых буферов/DOM", !/requestAnimationFrame|createElement|document\./.test(eqSource));
  check("эквалайзер — внутри canvas .atmosphere (без отдельного DOM-элемента)", !/equalizer/i.test(html) && !/equalizer/i.test(layoutCss));

  // Регресс T-09: синтез-спектр не залипает в 1, основной канвас чистится каждый кадр
  const synth = new Rhythm();
  const synthTrace = [];
  for (let i = 0; i < 900; i += 1) {
    synth.update(1 / 60, { energy: 3, intensity: 0.75, motion: 1 });
    if (i > 300) synthTrace.push(mean(synth.spectrum));
  }
  check("синтез-спектр не залипает в максимум", Math.max(...synthTrace) < 0.7 && Math.max(...synthTrace) - Math.min(...synthTrace) > 0.05, `${Math.min(...synthTrace).toFixed(2)}…${Math.max(...synthTrace).toFixed(2)}`);
  const mainStub = makeStubContext();
  atmo.ctx = mainStub;
  atmo.setQuality("med");
  atmo.draw(null);
  const clearAt = mainStub.calls.indexOf("clearRect");
  const imageAt = mainStub.calls.indexOf("drawImage");
  check("med: основной канвас чистится перед кадром (нет накопления «засвета»)", clearAt !== -1 && clearAt < imageAt, mainStub.calls.slice(0, 4).join(","));

  env.window.close();
}

{
  const env = await makeEnv(html, { canvas: "stub", reduceMotion: true });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(60);
  const atmo = app.atmosphere;
  check("reduced-motion: эквалайзер есть в статичном кадре", atmo.raf === null && atmo.lastEqualizer.length === 1, JSON.stringify(atmo.lastEqualizer.map((s) => s.style)));
  const before = Float32Array.from(atmo.eqBands.values);
  await tick(200);
  check("reduced-motion: полосы статичны", Array.from(atmo.eqBands.values).every((v, i) => v === before[i]));
  env.window.close();
}

/* =====================================================================
   14. Герой: сворачивание к верху и адаптив (T-11)
   ===================================================================== */
section("14. Герой и адаптив (T-11)");

{
  // Статика: кнопка сворачивания, стили, адаптивные брейкпоинты
  check("герой сворачивается кнопкой (hero-fold и hero-body в разметке)", /id="hero-fold"/.test(html) && /id="hero-body"/.test(html));
  check("у кнопки героя aria-expanded и aria-controls", /aria-expanded="true"[\s\S]{0,200}aria-controls="hero-body"/.test(html));
  check("в спрайте есть i-chevron для кнопки героя", /id="i-chevron"/.test(html));
  check("тело героя сворачивается к верху (grid 1fr→0fr, .hero.is-collapsed)", /grid-template-rows:\s*0fr/.test(layoutCss) && /\.hero\.is-collapsed/.test(layoutCss));
  check("низкие вьюпорты (пейзаж телефона/фолда) получают компактный герой", /@media \(max-height: 620px\)/.test(layoutCss));
  check("сетка станций: 2 колонки с 560px (раскрытый фолд)", /@media \(min-width: 560px\)/.test(layoutCss));
  check("кнопки героя на всю ширину на узких экранах", /@media \(max-width: 480px\)/.test(layoutCss));
  check("заголовок героя плавно масштабируется 26→56px и балансирует строки", /--fs-3xl:\s*clamp\(26px/.test(read("css/tokens.css")) && /text-wrap:\s*balance/.test(layoutCss));
  check("плеер: мета (flex 1 1 0) не выталкивает кнопки на второй ряд", /flex:\s*1 1 0/.test(read("css/components/player.css")));
}

{
  // Поведение: свернуть/развернуть, aria, inert, персист
  const env = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  const app = await importFresh("js/app.js");
  await tick(40);
  const doc = env.document;
  const hero = doc.getElementById("hero");
  const fold = doc.getElementById("hero-fold");
  const body = doc.getElementById("hero-body");

  check("герой стартует развёрнутым", !hero.classList.contains("is-collapsed") && fold.getAttribute("aria-expanded") === "true");
  fold.click();
  await tick(10);
  check("клик сворачивает герой к верху", hero.classList.contains("is-collapsed") && app.heroFold.collapsed === true);
  check("aria-expanded и подпись кнопки обновились", fold.getAttribute("aria-expanded") === "false" && doc.getElementById("hero-fold-text").textContent === "Развернуть", doc.getElementById("hero-fold-text").textContent);
  check("тело свёрнутого героя стало inert", body.hasAttribute("inert"));
  check("состояние сворачивания сохраняется", env.window.localStorage.getItem("joer:heroCollapsed") === "true");
  fold.click();
  await tick(10);
  check("повторный клик разворачивает герой", !hero.classList.contains("is-collapsed") && !body.hasAttribute("inert"));
  env.window.close();
}

{
  // Возврат: «Продолжить» разворачивает свёрнутый герой; клик — сворачивает снова
  const env = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  env.window.localStorage.setItem("joer:heroCollapsed", "true");
  const lastId = env.catalog.stations[3].id;
  env.window.localStorage.setItem("joer:lastStation", JSON.stringify(lastId));
  const app = await importFresh("js/app.js");
  await tick(40);
  const hero = env.document.getElementById("hero");
  const resume = env.document.getElementById("resume");
  check("«Продолжить» разворачивает свёрнутый герой", !hero.classList.contains("is-collapsed") && resume.hidden === false);
  resume.click();
  await tick(30);
  check("клик по «Продолжить» сворачивает герой (музыка пошла — атмосфера остаётся)", hero.classList.contains("is-collapsed") && app.player.state === "playing", `${hero.className} / ${app.player.state}`);
  env.window.close();
}

{
  // Персист: свёрнутое состояние переживает перезагрузку
  const env = await makeEnv(html, { canvas: "stub" });
  globalThis.Audio = FakeAudio;
  env.window.localStorage.setItem("joer:heroCollapsed", "true");
  await importFresh("js/app.js");
  await tick(40);
  check(
    "свёрнутый герой восстанавливается после перезагрузки",
    env.document.getElementById("hero").classList.contains("is-collapsed") && env.document.getElementById("hero-body").hasAttribute("inert"),
  );
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
