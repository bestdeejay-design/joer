#!/usr/bin/env node
/**
 * Валидатор каталога JOER.
 *
 * Проверяет:
 *  - структурную целостность: уникальные id станций, существование groupId, обязательные поля;
 *  - что все потоки https (иначе браузер заблокирует mixed content);
 *  - доступность потока: HTTP 200/206 и audio content-type.
 *
 * Запуск:  npm run validate   (или: node scripts/validate-stations.mjs)
 *          npm run validate -- --offline   только структура, без сети
 * Код выхода: 0 — всё в порядке, 1 — есть проблемы.
 */
import { readFile } from "node:fs/promises";

const OFFLINE = process.argv.slice(2).some((arg) => arg === "--offline" || arg === "-o");
const FILE = new URL("../data/stations.json", import.meta.url);
const TIMEOUT_MS = 12000;
const AUDIO_RE = /^(audio\/|application\/(ogg|octet-stream)|icy)/i;

const data = JSON.parse(await readFile(FILE, "utf8"));

// --- структурные проверки ---
const structProblems = [];
const groupIds = new Set(data.groups.map((g) => g.id));
const seen = new Set();
const perGroup = new Map();
for (const st of data.stations) {
  const p = [];
  if (seen.has(st.id)) p.push("дубликат id");
  seen.add(st.id);
  if (!groupIds.has(st.groupId)) p.push(`groupId «${st.groupId}» не найден`);
  if (!st.name || !st.url) p.push("пустые name/url");
  if (!st.url.startsWith("https://")) p.push("не https (mixed content)");
  if (/\.(pls|m3u8?)(\?|$)/i.test(st.url)) p.push("плейлист .pls/.m3u — браузер такое не играет");
  if (!st.description || !st.homepage) p.push("пустые description/homepage");
  if (!Array.isArray(st.genres) || st.genres.length === 0) p.push("нет genres");
  if (!(st.energy >= 1 && st.energy <= 5)) p.push(`energy вне диапазона 1..5: ${st.energy}`);
  if ("cors" in st && typeof st.cors !== "boolean") p.push(`cors должен быть boolean: ${st.cors}`);
  if (p.length) structProblems.push(`${st.id}: ${p.join("; ")}`);
  perGroup.set(st.groupId, (perGroup.get(st.groupId) ?? 0) + 1);
}

for (const g of data.groups) {
  const count = perGroup.get(g.id) ?? 0;
  if (count < 6) structProblems.push(`группа «${g.title}»: ${count} станций, нужно ≥ 6`);
  if (g.defaultStationId && !seen.has(g.defaultStationId)) {
    structProblems.push(`группа «${g.title}»: defaultStationId «${g.defaultStationId}» не найден`);
  }
}

// --- сетевые проверки ---
const results = [];
if (OFFLINE) {
  console.log("⚠️  Режим --offline: потоки не проверялись (нет сети). Прогоните `npm run validate` на машине с интернетом.\n");
}
for (const st of OFFLINE ? [] : data.stations) {
  let status = null;
  let type = "";
  const p = [];
  try {
    const res = await fetch(st.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    type = res.headers.get("content-type") || "";
    if (![200, 206].includes(status)) p.push(`HTTP ${status}`);
    if (!AUDIO_RE.test(type)) p.push(`content-type: ${type || "—"}`);
    try {
      await res.body?.cancel();
    } catch {}
  } catch (e) {
    p.push(`сеть: ${e.name === "TimeoutError" ? "таймаут" : e.message}`);
  }
  results.push({ id: st.id, status, type, p });
}

let failed = 0;
for (const r of results) {
  const ok = r.p.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${String(r.id).padEnd(24)} ${String(r.status ?? "—").padEnd(4)} ${r.p.join("; ")}`);
}
for (const p of structProblems) {
  failed++;
  console.log("❌", p);
}

console.log(`\nКаталог: ${data.stations.length} станций, ${data.groups.length} групп.`);
console.log(failed ? `Проблемы: ${failed}.` : "Все потоки и структура в порядке.");
process.exit(failed ? 1 : 0);
