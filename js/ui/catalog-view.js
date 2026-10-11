/**
 * JOER — рендер каталога: табы групп и карточки станций.
 *
 * Чистые функции-рендеры: получают данные и колбэки, ничего не хранят.
 * Данные берутся только из data/stations.json (см. js/catalog.js).
 */

import { sortForDisplay } from "../catalog.js";

/** Иконки — локальные inline-SVG (без внешних запросов). */
const ICON = {
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L12 3.6z"/></svg>`,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Табы групп.
 * Доступность: кнопки с aria-pressed + ровер-навигация стрелками (см. js/ui/controls.js).
 */
export function renderGroups(container, groups, { counts = new Map(), activeId, onSelect } = {}) {
  container.textContent = "";

  for (const group of groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-tab";
    button.dataset.groupId = group.id;
    button.setAttribute("aria-pressed", String(group.id === activeId));
    // Ровер-фокус: в группе табов одна остановка Tab, дальше — стрелки.
    button.tabIndex = group.id === activeId || (!activeId && group === groups[0]) ? 0 : -1;
    button.title = group.subtitle || group.title;

    const label = document.createElement("span");
    label.textContent = group.title;

    const count = document.createElement("span");
    count.className = "group-tab-count";
    count.textContent = String(counts.get(group.id) ?? 0);

    button.append(label, count);
    button.addEventListener("click", () => onSelect?.(group.id));
    container.append(button);
  }
}

/**
 * Сетка станций.
 * @param {HTMLElement} grid
 * @param {Array} stations — станции в порядке отображения
 */
export function renderStations(grid, stations, options = {}) {
  const {
    currentId = null,
    favoriteIds = [],
    playing = false,
    onPlay,
    onToggleFavorite,
    groupById = new Map(),
  } = options;

  grid.textContent = "";

  const favorites = new Set(favoriteIds);
  const ordered = sortForDisplay(stations, favoriteIds);

  for (const station of ordered) {
    grid.append(
      buildCard(station, {
        isFavorite: favorites.has(station.id),
        isCurrent: station.id === currentId,
        playing,
        group: groupById.get(station.groupId),
        onPlay,
        onToggleFavorite,
      }),
    );
  }

  return ordered;
}

function buildCard(station, { isFavorite, isCurrent, playing, group, onPlay, onToggleFavorite }) {
  const article = document.createElement("article");
  article.className = "card";
  article.dataset.stationId = station.id;
  if (isCurrent) article.classList.add("is-current");
  if (isCurrent && playing) article.classList.add("is-playing");

  const top = document.createElement("div");
  top.className = "card-top";

  const provider = document.createElement("span");
  provider.className = "card-provider";
  provider.textContent = station.provider;
  top.append(provider);

  const eq = document.createElement("span");
  eq.className = "card-eq";
  eq.setAttribute("aria-hidden", "true");
  eq.append(document.createElement("span"), document.createElement("span"), document.createElement("span"), document.createElement("span"));
  top.append(eq);

  const fav = document.createElement("button");
  fav.type = "button";
  fav.className = "card-fav";
  fav.setAttribute("aria-pressed", String(isFavorite));
  fav.setAttribute("aria-label", isFavorite ? `Убрать ${station.name} из избранного` : `Добавить ${station.name} в избранное`);
  fav.innerHTML = ICON.star;
  fav.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggleFavorite?.(station);
  });
  top.append(fav);

  const name = document.createElement("h3");
  name.className = "card-name";
  name.textContent = station.name;

  const desc = document.createElement("p");
  desc.className = "card-desc";
  desc.textContent = station.description || station.mood || "";

  const genres = document.createElement("div");
  genres.className = "card-genres";
  for (const genre of station.genres.slice(0, 3)) {
    const chip = document.createElement("span");
    chip.className = "genre";
    chip.textContent = genre;
    genres.append(chip);
  }

  const foot = document.createElement("div");
  foot.className = "card-foot";

  const energy = document.createElement("span");
  energy.className = "energy";
  energy.setAttribute("role", "img");
  energy.setAttribute("aria-label", `Энергия ${station.energy} из 5`);
  for (let i = 1; i <= 5; i += 1) {
    const dot = document.createElement("span");
    dot.className = `energy-dot${i <= station.energy ? " is-on" : ""}`;
    energy.append(dot);
  }
  const energyLabel = document.createElement("span");
  energyLabel.className = "energy-label";
  energyLabel.textContent = group?.title ?? "";
  energy.append(energyLabel);
  foot.append(energy);

  const play = document.createElement("button");
  play.type = "button";
  play.className = "card-play";
  play.dataset.stationId = station.id;
  play.setAttribute("aria-label", `Слушать: ${station.name} (${station.provider})`);
  play.textContent = "Слушать";
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    onPlay?.(station);
  });

  article.append(top, name, desc, genres, foot, play);
  return article;
}

/** Пустое состояние поиска. */
export function renderEmpty(grid, query) {
  grid.textContent = "";
  const panel = document.createElement("div");
  panel.className = "state-panel";
  panel.style.gridColumn = "1 / -1";
  panel.innerHTML = `
    <h3 class="state-title">Ничего не нашлось</h3>
    <p class="state-text">По запросу <code>${escapeHtml(query)}</code> станций нет.
    Попробуйте жанр («downtempo»), настроение («вечер») или провайдера («SomaFM»).</p>
  `;
  grid.append(panel);
}

export { escapeHtml };
