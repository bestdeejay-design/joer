#!/usr/bin/env node
/**
 * Аудит CORS-заголовков потоков JOER (T-09).
 *
 * Аудио-реактивность (Web Audio + AnalyserNode) работает только с потоками,
 * которые отдают Access-Control-Allow-Origin. Этот скрипт проверяет каждый URL
 * из data/stations.json и может записать результат в каталог:
 *
 *   npm run audit:cors               # таблица результатов
 *   npm run audit:cors -- --write    # + проставить `cors: true/false` в stations.json
 *   npm run audit:cors -- --origin=https://joer.ru
 *   node scripts/audit-cors.mjs https://example.com/stream.mp3   # ad-hoc URL
 *
 * Метод: GET в режиме CORS (простой запрос, без preflight) с обрывом тела.
 * Если fetch резолвится и статус < 400 — заголовки CORS на месте.
 * Код выхода: 0 — всё проверилось; 1 — были сетевые сбои (или --strict и есть запреты).
 */
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const WRITE = args.includes("--write") || args.includes("-w");
const STRICT = args.includes("--strict");
const originArg = args.find((a) => a.startsWith("--origin="));
const ORIGIN = originArg ? originArg.slice("--origin=".length) : "https://joer.ru";
const TIMEOUT_MS = 12000;
const FILE = new URL("../data/stations.json", import.meta.url);

const adhocUrls = args.filter((a) => /^https?:\/\//.test(a));

/** Один запрос-проба: true/false/undefined (undefined — сеть не ответила). */
async function probe(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      headers: { Origin: ORIGIN },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const acao = res.headers.get("access-control-allow-origin") || "";
    const ok = res.status < 400 && (acao === "*" || acao === ORIGIN);
    try {
      await res.body?.cancel();
    } catch {}
    return { ok, status: res.status, acao: acao || "—" };
  } catch (e) {
    return { ok: undefined, status: null, acao: `сеть: ${e.name === "TimeoutError" ? "таймаут" : e.message}` };
  }
}

/** Нормализуем URL для группировки: одинаковый поток — одна проверка. */
const entries = [];
if (adhocUrls.length) {
  for (const url of adhocUrls) entries.push({ id: url, url, stationIds: [url] });
} else {
  const data = JSON.parse(await readFile(FILE, "utf8"));
  const byUrl = new Map();
  for (const st of data.stations) {
    if (!byUrl.has(st.url)) byUrl.set(st.url, { id: st.id, url: st.url, stationIds: [] });
    byUrl.get(st.url).stationIds.push(st.id);
  }
  entries.push(...byUrl.values());

  if (WRITE) {
    // Записываем только после того, как проверили все уникальные URL.
    const results = new Map();
    let done = 0;
    for (const entry of entries) {
      const result = await probe(entry.url);
      results.set(entry.url, result);
      done += 1;
      process.stdout.write(`\rПробую ${done}/${entries.length}…`);
    }
    process.stdout.write("\r" + " ".repeat(40) + "\r");

    let changed = 0;
    for (const st of data.stations) {
      const result = results.get(st.url);
      if (!result || result.ok === undefined) continue; // сеть молчит — не трогаем флаг
      const next = result.ok === true;
      if (st.cors !== next) {
        st.cors = next;
        changed += 1;
      }
    }
    data.updatedAt = new Date().toISOString().slice(0, 10);
    await writeFile(FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`Записано флагов \`cors\`: ${changed}. Каталог обновлён (${data.updatedAt}).`);
    console.log("Проверьте diff и прогоните `npm run validate`.\n");
    process.exit(0);
  }
}

// --- обычный режим: печатаем таблицу ---
let unsupported = 0;
let networkErrors = 0;
console.log(`CORS-аудит потоков (Origin: ${ORIGIN})\n`);
for (const entry of entries) {
  const { ok, status, acao } = await probe(entry.url);
  const mark = ok === true ? "✅" : ok === false ? "🚫" : "⚠️ ";
  if (ok === false) unsupported += 1;
  if (ok === undefined) networkErrors += 1;
  console.log(`${mark} ${String(entry.id).padEnd(26)} HTTP ${String(status ?? "—").padEnd(4)} ACAO: ${acao}`);
}

console.log(
  `\nИтого: ${entries.length} уникальных потоков, ` +
    `CORS есть у ${entries.length - unsupported - networkErrors}, ` +
    `нет у ${unsupported}, сеть молчит у ${networkErrors}.`,
);
if (unsupported > 0) {
  console.log("Потоки без CORS — визуал для них остаётся процедурным (это нормально для радио).");
}
console.log("Чтобы проставить флаги в каталог: npm run audit:cors -- --write");

process.exit(networkErrors > 0 || (STRICT && unsupported > 0) ? 1 : 0);
