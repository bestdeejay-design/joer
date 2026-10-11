/**
 * JOER — каталог станций: загрузка, нормализация, группировка, поиск.
 *
 * Данные никогда не зашиваются в HTML/JS: единственный источник — data/stations.json.
 */

export const CATALOG_URL = "data/stations.json";

const DEFAULT_ENERGY = 3;

/** Приводим станцию из JSON к предсказуемой форме (и ловим мусор в данных). */
export function normalizeStation(raw, index = 0) {
  const id = String(raw?.id ?? "").trim();
  const name = String(raw?.name ?? "").trim() || "Без названия";
  let energy = Number(raw?.energy);
  if (!Number.isFinite(energy)) energy = DEFAULT_ENERGY;
  energy = Math.min(5, Math.max(1, Math.round(energy)));

  const genres = Array.isArray(raw?.genres)
    ? raw.genres.map((g) => String(g).trim()).filter(Boolean).slice(0, 4)
    : [];

  return {
    id,
    index,
    groupId: String(raw?.groupId ?? "").trim(),
    name,
    provider: String(raw?.provider ?? "").trim() || "Независимый поток",
    url: String(raw?.url ?? "").trim(),
    codec: String(raw?.codec ?? "").trim().toLowerCase(),
    bitrate: Number.isFinite(Number(raw?.bitrate)) ? Number(raw.bitrate) : null,
    genres,
    mood: String(raw?.mood ?? "").trim(),
    energy,
    description: String(raw?.description ?? "").trim(),
    homepage: String(raw?.homepage ?? "").trim(),
    cors: raw?.cors === true,
  };
}

export function normalizeGroup(raw) {
  return {
    id: String(raw?.id ?? "").trim(),
    title: String(raw?.title ?? "").trim() || "Без названия",
    subtitle: String(raw?.subtitle ?? "").trim(),
    description: String(raw?.description ?? "").trim(),
    theme: String(raw?.theme ?? "lounge").trim() || "lounge",
    defaultStationId: String(raw?.defaultStationId ?? "").trim(),
  };
}

/** Проверка целостности каталога: дубли id, висячие groupId, пустые url, не-https. */
export function validateCatalog({ groups = [], stations = [] } = {}) {
  const problems = [];
  const groupIds = new Set(groups.map((g) => g.id));
  const seen = new Set();

  for (const st of stations) {
    if (!st.id) problems.push(`станция #${st.index}: пустой id`);
    if (seen.has(st.id)) problems.push(`дубликат id: ${st.id}`);
    seen.add(st.id);
    if (!groupIds.has(st.groupId)) problems.push(`${st.id}: groupId «${st.groupId}» не найден`);
    if (!st.url) problems.push(`${st.id}: пустой url`);
    else if (!st.url.startsWith("https://")) problems.push(`${st.id}: не-https поток (mixed content)`);
  }

  for (const g of groups) {
    if (g.defaultStationId && !seen.has(g.defaultStationId)) {
      problems.push(`группа ${g.id}: defaultStationId «${g.defaultStationId}» не найден`);
    }
  }

  return problems;
}

/**
 * Загружает и нормализует каталог.
 * Бросает понятную ошибку, если данных нет или они битые — UI показывает её человеку.
 */
export async function loadCatalog({ url = CATALOG_URL, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((href) => fetch(href, { cache: "no-store" }));

  let response;
  try {
    response = await doFetch(url);
  } catch (cause) {
    throw new CatalogError("Не удалось загрузить каталог станций: сервер недоступен.", { cause });
  }

  if (!response.ok) {
    throw new CatalogError(`Каталог станций вернул ошибку ${response.status}.`, { status: response.status });
  }

  let data;
  try {
    data = await response.json();
  } catch (cause) {
    throw new CatalogError("Файл каталога повреждён: это не JSON.", { cause });
  }

  const groups = (data?.groups ?? []).map(normalizeGroup).filter((g) => g.id);
  const stations = (data?.stations ?? [])
    .map((raw, index) => normalizeStation(raw, index))
    .filter((st) => st.id && st.url);

  if (!groups.length || !stations.length) {
    throw new CatalogError("Каталог пуст — нечего показать.");
  }

  const problems = validateCatalog({ groups, stations });
  if (problems.length) {
    console.warn(`[joer] проблемы каталога (${problems.length}):`, problems);
  }

  const byId = new Map(stations.map((st) => [st.id, st]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  return {
    version: Number(data?.version) || 1,
    updatedAt: String(data?.updatedAt ?? ""),
    groups,
    stations,
    byId,
    groupById,
    problems,
  };
}

export class CatalogError extends Error {
  constructor(message, { cause, status } = {}) {
    super(message);
    this.name = "CatalogError";
    if (cause) this.cause = cause;
    if (status) this.status = status;
  }
}

/** Станции группы в порядке каталога. */
export function stationsOfGroup(stations, groupId) {
  return stations.filter((st) => st.groupId === groupId);
}

/**
 * Избранные — первыми, дальше порядок каталога (стабильно, без «прыжков»).
 */
export function sortForDisplay(list, favoriteIds = []) {
  const fav = new Set(favoriteIds);
  return [...list].sort((a, b) => {
    const aFav = fav.has(a.id) ? 0 : 1;
    const bFav = fav.has(b.id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.index - b.index;
  });
}

/** Мгновенный поиск по названию, жанрам, провайдеру, настроению. */
export function searchStations(stations, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return stations;
  const terms = q.split(/\s+/).filter(Boolean);
  return stations.filter((st) => {
    const haystack = [st.name, st.provider, st.mood, ...st.genres].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Следующая станция в группе (для авто-перехода при обрыве потока). */
export function nextInGroup(list, currentId) {
  if (!list.length) return null;
  const index = list.findIndex((st) => st.id === currentId);
  if (index < 0) return list[0];
  return list[(index + 1) % list.length];
}

export function previousInGroup(list, currentId) {
  if (!list.length) return null;
  const index = list.findIndex((st) => st.id === currentId);
  if (index < 0) return list[0];
  return list[(index - 1 + list.length) % list.length];
}
