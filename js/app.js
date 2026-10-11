/**
 * JOER — точка входа.
 *
 * Связывает каталог (T-01), плеер (T-03) и UI. Темы (T-05) и атмосферный
 * движок (T-06) подключаются своими модулями.
 */

import { loadCatalog, stationsOfGroup, nextInGroup, previousInGroup } from "./catalog.js";
import { renderGroups, renderStations } from "./ui/catalog-view.js";
import { prefs, toggleFavorite } from "./storage.js";
import { Player, STATE } from "./player.js";
import { createPlayerView } from "./ui/player-view.js";

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
};

const state = {
  catalog: null,
  activeGroupId: null,
};

/* ------------------------------------------------------------------
   Плеер
   ------------------------------------------------------------------ */

function currentGroupStations() {
  if (!state.catalog) return [];
  return stationsOfGroup(state.catalog.stations, state.activeGroupId);
}

const player = new Player({
  suggestNext: (station) => {
    if (!station) return null;
    const list = stationsOfGroup(state.catalog?.stations ?? [], station.groupId);
    const next = nextInGroup(list, station.id);
    return next && next.id !== station.id ? next : null;
  },
});

const playerView = createPlayerView({
  root: els.player,
  player,
  onRetry: () => player.resume(),
  onNext: () => {
    const next = nextInGroup(currentGroupStations(), player.station?.id);
    if (next) player.play(next);
  },
  onPrevious: () => {
    const prev = previousInGroup(currentGroupStations(), player.station?.id);
    if (prev) player.play(prev);
  },
});

player.bindMediaSession({
  play: () => player.resume(),
  pause: () => player.pause(),
  stop: () => player.stop(),
  next: () => {
    const next = nextInGroup(currentGroupStations(), player.station?.id);
    if (next) player.play(next);
  },
  previous: () => {
    const prev = previousInGroup(currentGroupStations(), player.station?.id);
    if (prev) player.play(prev);
  },
});

player.addEventListener("change", (event) => {
  syncVolumeUI(event.detail);
  syncActiveCards();
});

player.addEventListener("stationchange", () => {
  const groupId = player.station?.groupId;
  if (groupId && groupId !== state.activeGroupId) {
    state.activeGroupId = groupId;
    renderCatalog();
  } else {
    syncActiveCards();
  }
});

/** Громкость: значение + «заполнение» трека слайдера. */
function syncVolumeUI({ volume, muted } = {}) {
  const value = typeof volume === "number" ? volume : player.volume;
  const percent = Math.round((muted ? 0 : value) * 100);
  if (els.volume) els.volume.style.setProperty("--volume-fill", `${Math.round(value * 100)}%`);
  return percent;
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
   Каталог
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
  const { catalog, activeGroupId } = state;
  if (!catalog) return;

  const counts = new Map(
    catalog.groups.map((group) => [group.id, stationsOfGroup(catalog.stations, group.id).length]),
  );

  renderGroups(els.groups, catalog.groups, {
    counts,
    activeId: activeGroupId,
    onSelect: (groupId) => {
      state.activeGroupId = groupId;
      renderCatalog();
    },
  });

  const group = catalog.groupById.get(activeGroupId);
  const stations = stationsOfGroup(catalog.stations, activeGroupId);

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

  if (els.description) els.description.textContent = group?.description ?? "";
  if (els.note) {
    els.note.textContent = `${stations.length} станций · ${catalog.stations.length} в каталоге · обновлено ${catalog.updatedAt}`;
  }
  setLoading(false);
  hideError();
  syncActiveCards();
}

async function bootstrap() {
  setLoading(true);
  try {
    state.catalog = await loadCatalog();
    state.activeGroupId = state.catalog.groups[0]?.id ?? null;
    renderCatalog();
  } catch (error) {
    console.error("[joer] каталог не загружен:", error);
    showError(error?.message ?? "Неизвестная ошибка загрузки данных.");
  }
}

/* ------------------------------------------------------------------
   Горячие клавиши
   ------------------------------------------------------------------ */

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.code === "Space" && !target.closest("button, a, [role='button']")) {
    event.preventDefault();
    player.toggle();
  }
});

els.retry?.addEventListener("click", () => {
  hideError();
  bootstrap();
});

syncVolumeUI({});
bootstrap();

export { player, playerView, state };
