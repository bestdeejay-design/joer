/**
 * JOER — точка входа.
 *
 * Связывает каталог (T-01), плеер (T-03) и UI каталога (T-04).
 * Темы (T-05) и атмосферный движок (T-06) подключаются своими модулями.
 */

import { loadCatalog, stationsOfGroup, nextInGroup, previousInGroup, searchStations } from "./catalog.js";
import { renderGroups, renderStations, renderEmpty } from "./ui/catalog-view.js";
import { setupRovingTabs, restoreTabFocus } from "./ui/controls.js";
import { prefs, toggleFavorite } from "./storage.js";
import { Player, STATE } from "./player.js";
import { createPlayerView } from "./ui/player-view.js";
import { ThemeManager, themeById } from "./themes.js";
import { createThemePicker } from "./ui/theme-picker.js";
import { Atmosphere } from "./atmosphere.js";
import { createReactivity, stationSupportsReactivity } from "./audio-reactivity.js";

const els = {
  groups: document.getElementById("groups"),
  grid: document.getElementById("station-grid"),
  note: document.getElementById("catalog-note"),
  description: document.getElementById("group-description"),
  loading: document.getElementById("catalog-loading"),
  error: document.getElementById("catalog-error"),
  errorText: document.getElementById("catalog-error-text"),
  retry: document.getElementById("catalog-retry"),
  player: document.getElementById("player"),
  volume: document.getElementById("player-volume"),
  search: document.getElementById("search"),
  searchClear: document.getElementById("search-clear"),
  resume: document.getElementById("resume"),
  resumeText: document.getElementById("resume-text"),
  catalogUpdated: document.getElementById("catalog-updated"),
};

const state = {
  catalog: null,
  activeGroupId: null,
  query: "",
  intensity: prefs.intensity,
};

/* ------------------------------------------------------------------
   Темы и атмосфера
   ------------------------------------------------------------------ */

const themes = new ThemeManager();

createThemePicker({
  root: document.getElementById("theme-picker"),
  manager: themes,
  initialIntensity: state.intensity,
  onIntensity: (value, commit) => {
    state.intensity = value;
    if (commit) prefs.intensity = value;
    document.dispatchEvent(new CustomEvent("joer:intensitychange", { detail: { value } }));
  },
});

/** Атмосферный движок: сцена от темы, живость от станции и состояния плеера. */
const atmosphere = new Atmosphere(document.getElementById("atmosphere"));
atmosphere.setScene(themeById(themes.theme).scene);
atmosphere.setIntensity(state.intensity);
atmosphere.start();

themes.addEventListener("change", (event) => atmosphere.setScene(event.detail.scene));
document.addEventListener("joer:intensitychange", (event) => atmosphere.setIntensity(event.detail.value));

/* ------------------------------------------------------------------
   Плеер
   ------------------------------------------------------------------ */

function groupStations(groupId) {
  if (!state.catalog) return [];
  return stationsOfGroup(state.catalog.stations, groupId);
}

function currentGroupStations() {
  return groupStations(state.activeGroupId);
}

function playNeighbour(direction) {
  const list = currentGroupStations();
  const pick = direction > 0 ? nextInGroup(list, player.station?.id) : previousInGroup(list, player.station?.id);
  if (pick) player.play(pick);
}

const player = new Player({
  suggestNext: (station) => {
    if (!station) return null;
    const next = nextInGroup(groupStations(station.groupId), station.id);
    return next && next.id !== station.id ? next : null;
  },
});

createPlayerView({
  root: els.player,
  player,
  onRetry: () => player.resume(),
  onNext: () => playNeighbour(1),
  onPrevious: () => playNeighbour(-1),
});

player.bindMediaSession({
  play: () => player.resume(),
  pause: () => player.pause(),
  stop: () => player.stop(),
  next: () => playNeighbour(1),
  previous: () => playNeighbour(-1),
});

/**
 * Аудио-реактивность — только для станций с явным флагом `cors: true`.
 * Любая неудача → пересоздаём <audio> без Web Audio-графа: звук важнее эффектов.
 */
let reactivity = null;

function attachReactivity(station) {
  reactivity?.dispose();
  reactivity = null;

  if (!stationSupportsReactivity(station)) {
    atmosphere.setLevels(null);
    return;
  }

  reactivity = createReactivity(player.ensureAudio(), {
    onLevels: (levels) => atmosphere.setLevels(levels),
    onFallback: (error) => {
      console.info("[joer] реактивность отключена, сцена снова процедурная:", error?.message ?? error);
      reactivity = null;
      atmosphere.setLevels(null);
      player.recreateAudio();
    },
  });
}

player.addEventListener("change", (event) => {
  syncVolumeUI();
  syncActiveCards();
  atmosphere.setPlayerState(event.detail.state);
});

player.addEventListener("stationchange", (event) => {
  atmosphere.setEnergy(event.detail.station?.energy);
  attachReactivity(event.detail.station);

  const groupId = player.station?.groupId;
  if (groupId && groupId !== state.activeGroupId) {
    state.activeGroupId = groupId;
    renderCatalog();
  } else {
    syncActiveCards();
  }
});

/** Громкость: «заполнение» трека слайдера (для webkit-градиента). */
function syncVolumeUI() {
  els.volume?.style.setProperty("--volume-fill", `${Math.round(player.volume * 100)}%`);
}

/** Подсветка текущей станции в сетке без полного перерендера. */
function syncActiveCards() {
  const current = player.station?.id ?? null;
  const playing = player.state === STATE.PLAYING;
  for (const card of els.grid.querySelectorAll(".card")) {
    const isCurrent = card.dataset.stationId === current;
    card.classList.toggle("is-current", isCurrent);
    card.classList.toggle("is-playing", isCurrent && playing);
  }
}

/* ------------------------------------------------------------------
   Каталог и поиск
   ------------------------------------------------------------------ */

function setLoading(isLoading) {
  if (els.loading) els.loading.hidden = !isLoading;
  if (els.grid) els.grid.hidden = isLoading;
}

function showError(message) {
  setLoading(false);
  if (els.grid) els.grid.hidden = true;
  if (els.groups) els.groups.hidden = true;
  if (els.error) {
    els.error.hidden = false;
    if (els.errorText) els.errorText.textContent = message;
  }
  if (els.note) els.note.textContent = "Каталог недоступен";
}

function hideError() {
  if (els.error) els.error.hidden = true;
  if (els.groups) els.groups.hidden = false;
}

function renderCatalog() {
  const { catalog, activeGroupId, query } = state;
  if (!catalog) return;

  const searching = query.trim().length > 0;
  const hadTabFocus = els.groups.contains(document.activeElement);

  const counts = new Map(catalog.groups.map((group) => [group.id, groupStations(group.id).length]));

  renderGroups(els.groups, catalog.groups, {
    counts,
    activeId: searching ? null : activeGroupId,
    onSelect: (groupId) => {
      state.activeGroupId = groupId;
      prefs.group = groupId;
      renderCatalog();
    },
  });

  if (hadTabFocus && !searching) restoreTabFocus(els.groups, activeGroupId);

  const stations = searching ? searchStations(catalog.stations, query) : groupStations(activeGroupId);
  const group = catalog.groupById.get(activeGroupId);

  // В режиме «авто» мир следует за группой станций
  if (group) themes.setGroupTheme(group.theme);

  if (!stations.length && searching) {
    els.grid.textContent = "";
    renderEmpty(els.grid, query.trim());
  } else {
    renderStations(els.grid, stations, {
      groupById: catalog.groupById,
      favoriteIds: prefs.favorites,
      currentId: player.station?.id ?? null,
      playing: player.state === STATE.PLAYING,
      onPlay: (station) => player.play(station),
      onToggleFavorite: (station) => {
        toggleFavorite(station.id);
        renderCatalog();
      },
    });
  }

  if (els.description) {
    els.description.textContent = searching
      ? "Ищем по всему каталогу — название, жанр, настроение или провайдер."
      : group?.description ?? "";
  }

  if (els.note) {
    els.note.textContent = searching
      ? `Найдено ${stations.length} из ${catalog.stations.length} станций`
      : `${stations.length} станций · ${catalog.stations.length} в каталоге · обновлено ${catalog.updatedAt}`;
  }

  setLoading(false);
  hideError();
  syncActiveCards();
}

/** «Продолжить последнюю станцию» — один клик, без автоплея. */
function setupResume(lastStation) {
  if (!lastStation) return;
  if (els.resume) els.resume.hidden = false;
  if (els.resumeText) els.resumeText.textContent = `Продолжить: ${lastStation.name}`;
}

els.resume?.addEventListener("click", () => {
  const station = state.catalog?.byId.get(prefs.lastStation);
  if (station) player.play(station);
});

player.addEventListener("change", (event) => {
  if (event.detail.state === STATE.PLAYING && els.resume) els.resume.hidden = true;
});

function updateCatalogUpdated() {
  if (els.catalogUpdated && state.catalog) {
    els.catalogUpdated.textContent = `каталог обновлён ${state.catalog.updatedAt}`;
  }
}

async function bootstrap() {
  setLoading(true);
  try {
    state.catalog = await loadCatalog();

    const lastStation = state.catalog.byId.get(prefs.lastStation) ?? null;
    state.activeGroupId =
      lastStation?.groupId ?? (isGroupValid(prefs.group) ? prefs.group : state.catalog.groups[0]?.id ?? null);

    setupResume(lastStation);
    renderCatalog();
    updateCatalogUpdated();
  } catch (error) {
    console.error("[joer] каталог не загружен:", error);
    showError(error?.message ?? "Неизвестная ошибка загрузки данных.");
  }
}

function isGroupValid(id) {
  return Boolean(id) && Boolean(state.catalog?.groupById.get(id));
}

/* ------------------------------------------------------------------
   Поиск: мгновенный фильтр
   ------------------------------------------------------------------ */

els.search?.addEventListener("input", (event) => {
  state.query = event.target.value;
  if (els.searchClear) els.searchClear.hidden = !event.target.value;
  renderCatalog();
});

function clearSearch() {
  state.query = "";
  if (els.search) els.search.value = "";
  if (els.searchClear) els.searchClear.hidden = true;
  renderCatalog();
}

els.searchClear?.addEventListener("click", () => {
  clearSearch();
  els.search?.focus();
});

els.search?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    clearSearch();
    els.search.blur();
  }
});

setupRovingTabs(els.groups, {
  onNavigate: (groupId) => {
    state.activeGroupId = groupId;
    prefs.group = groupId;
    renderCatalog();
  },
});

/* ------------------------------------------------------------------
   Горячие клавиши
   ------------------------------------------------------------------ */

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

  if (event.key === "/" && !typing) {
    event.preventDefault();
    els.search?.focus();
    els.search?.select();
    return;
  }

  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.code === "Space" && !target.closest?.("button, a, [role='button']")) {
    event.preventDefault();
    player.toggle();
  }
});

els.retry?.addEventListener("click", () => {
  hideError();
  bootstrap();
});

syncVolumeUI();
bootstrap();

export { player, state, themes, atmosphere, renderCatalog, clearSearch };
