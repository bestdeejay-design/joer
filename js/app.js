/**
 * JOER — точка входа (T-01).
 *
 * Задача модуля: загрузить каталог, отрисовать группы и станции,
 * честно показать ошибку, если данных нет. Плеер — T-03, темы — T-05,
 * атмосферный движок — T-06 (модули подключаются по мере готовности).
 */

import { loadCatalog, stationsOfGroup } from "./catalog.js";
import { renderGroups, renderStations } from "./ui/catalog-view.js";
import { prefs, toggleFavorite } from "./storage.js";

const els = {
  groups: document.getElementById("groups"),
  grid: document.getElementById("station-grid"),
  note: document.getElementById("catalog-note"),
  description: document.getElementById("group-description"),
  loading: document.getElementById("catalog-loading"),
  error: document.getElementById("catalog-error"),
  errorText: document.getElementById("catalog-error-text"),
  retry: document.getElementById("catalog-retry"),
};

const state = {
  catalog: null,
  activeGroupId: null,
};

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

els.retry?.addEventListener("click", () => {
  hideError();
  bootstrap();
});

bootstrap();
