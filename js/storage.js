/**
 * JOER — единая обёртка над localStorage (ключи `joer:*`).
 *
 * Правила (docs/ARCHITECTURE.md):
 *  - все ключи живут в одном неймспейсе `joer:` и описаны в KEYS;
 *  - у схемы есть версия (`joer:schema`) — чтобы будущие миграции были тривиальны;
 *  - localStorage может быть недоступен (приватный режим, отключённые cookie) —
 *    тогда модуль тихо деградирует в память страницы, ничего не ломая.
 */

const PREFIX = "joer:";
export const SCHEMA_VERSION = 1;

/** Единственное место, где объявлены ключи приложения. */
export const KEYS = Object.freeze({
  schema: `${PREFIX}schema`,
  favorites: `${PREFIX}favorites`,
  lastStation: `${PREFIX}lastStation`,
  volume: `${PREFIX}volume`,
  muted: `${PREFIX}muted`,
  theme: `${PREFIX}theme`,
  intensity: `${PREFIX}intensity`,
  quality: `${PREFIX}quality`,
  calm: `${PREFIX}calm`,
  group: `${PREFIX}group`,
  heroCollapsed: `${PREFIX}heroCollapsed`,
});

/** In-memory фолбэк, если localStorage недоступен. */
const memory = new Map();
let available = null;

function backend() {
  if (available !== null) return available ? window.localStorage : null;
  try {
    const probe = "__joer_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available ? window.localStorage : null;
}

function rawGet(key) {
  const ls = backend();
  if (!ls) return memory.has(key) ? memory.get(key) : null;
  try {
    return ls.getItem(key);
  } catch {
    return memory.has(key) ? memory.get(key) : null;
  }
}

function rawSet(key, value) {
  const ls = backend();
  if (!ls) {
    memory.set(key, String(value));
    return true;
  }
  try {
    ls.setItem(key, String(value));
    return true;
  } catch {
    memory.set(key, String(value));
    return false;
  }
}

function rawRemove(key) {
  const ls = backend();
  memory.delete(key);
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {
    /* нечего делать */
  }
}

/** Прочитать JSON-значение; при любой проблеме — fallback. */
export function readJSON(key, fallback) {
  const raw = rawGet(key);
  if (raw === null || raw === undefined) return fallback;
  try {
    const value = JSON.parse(raw);
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Прочитать скаляр (строка/число) с проверкой типа. */
export function readScalar(key, fallback, validate = () => true) {
  const raw = rawGet(key);
  if (raw === null) return fallback;
  try {
    const value = JSON.parse(raw);
    return validate(value) ? value : fallback;
  } catch {
    // Значение могло быть записано как простая строка — пробуем как есть.
    return validate(raw) ? raw : fallback;
  }
}

export function write(key, value) {
  return rawSet(key, JSON.stringify(value));
}

export function remove(key) {
  rawRemove(key);
}

/** Забыть все данные приложения (например, по запросу пользователя). */
export function clearAll() {
  for (const key of Object.values(KEYS)) remove(key);
}

export function isPersistent() {
  backend();
  return available === true;
}

/** Проставить версию схемы; вернуть true, если данные были чужой версии. */
export function ensureSchema() {
  const current = readScalar(KEYS.schema, 0, (v) => Number.isFinite(Number(v)));
  const currentVersion = Number(current) || 0;
  if (currentVersion !== SCHEMA_VERSION) {
    // Миграций пока нет: просто фиксируем актуальную версию.
    write(KEYS.schema, SCHEMA_VERSION);
    return currentVersion !== 0;
  }
  return false;
}

/* ------------------------------------------------------------------
   Предметные хелперы — чтобы остальной код не знал про JSON и ключи.
   ------------------------------------------------------------------ */

const number01 = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const stringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

export const prefs = {
  get favorites() {
    return readJSON(KEYS.favorites, []);
  },
  set favorites(ids) {
    write(KEYS.favorites, Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
  },

  get lastStation() {
    return readScalar(KEYS.lastStation, null, (v) => typeof v === "string" && v.length > 0);
  },
  set lastStation(id) {
    if (typeof id === "string" && id) write(KEYS.lastStation, id);
    else remove(KEYS.lastStation);
  },

  get volume() {
    return readScalar(KEYS.volume, 0.8, number01);
  },
  set volume(value) {
    if (number01(value)) write(KEYS.volume, value);
  },

  get muted() {
    return readScalar(KEYS.muted, false, (v) => typeof v === "boolean");
  },
  set muted(value) {
    write(KEYS.muted, Boolean(value));
  },

  /** id темы или "auto" */
  get theme() {
    return readScalar(KEYS.theme, "auto", (v) => typeof v === "string" && v.length > 0);
  },
  set theme(value) {
    write(KEYS.theme, typeof value === "string" && value ? value : "auto");
  },

  /** Пользовательская интенсивность атмосферы, 0..1 (множитель поверх energy). */
  get intensity() {
    return readScalar(KEYS.intensity, 0.75, number01);
  },
  set intensity(value) {
    if (number01(value)) write(KEYS.intensity, value);
  },

  /** Качество сцены: "low" | "med" | "high". */
  get quality() {
    return readScalar(KEYS.quality, "med", (v) => v === "low" || v === "med" || v === "high");
  },
  set quality(value) {
    if (value === "low" || value === "med" || value === "high") write(KEYS.quality, value);
  },

  /** «Спокойный режим» атмосферы: мягко, без вспышек. */
  get calm() {
    return readScalar(KEYS.calm, false, (v) => typeof v === "boolean");
  },
  set calm(value) {
    write(KEYS.calm, Boolean(value));
  },

  get group() {
    return readScalar(KEYS.group, null, (v) => typeof v === "string" && v.length > 0);
  },
  set group(value) {
    if (typeof value === "string" && value) write(KEYS.group, value);
    else remove(KEYS.group);
  },

  /** Герой свёрнут к верху («наслаждаться атмосферой»). */
  get heroCollapsed() {
    return readScalar(KEYS.heroCollapsed, false, (v) => typeof v === "boolean");
  },
  set heroCollapsed(value) {
    write(KEYS.heroCollapsed, Boolean(value));
  },
};

export function isFavorite(id) {
  return prefs.favorites.includes(id);
}

export function toggleFavorite(id) {
  const list = prefs.favorites.filter((x) => x !== id);
  const added = list.length === prefs.favorites.length;
  if (added) list.push(id);
  prefs.favorites = list;
  return added;
}

export default { KEYS, SCHEMA_VERSION, prefs, readJSON, write, remove, clearAll, ensureSchema, isPersistent, isFavorite, toggleFavorite };
