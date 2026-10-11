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
 * Код выхода: 0 — всё в порядке, 1 — есть проблемы.
 */
import { readFile } from "node:fs/promises";

const FILE = new URL("../data/stations.json", import.meta.url);
const TIMEOUT_MS = 12000;
const AUDIO_RE = /^(audio\/|application\/(ogg|octet-stream)|icy)/i;

const data = JSON.parse(await readFile(FILE, "utf8"));

// --- структурные проверки ---
const structProblems = [];
const groupIds = new Set(data.groups.map((g) => g.id));
const seen = new Set();
for (const st of data.stations) {
  const p = [];
  if (seen.has(st.id)) p.push("дубликат id");
  seen.add(st.id);
  if (!groupIds.has(st.groupId)) p.push(`groupId «${st.groupId}» не найден`);
  if (!st.name || !st.url) p.push("пустые name/url");
  if (!st.url.startsWith("https://")) p.push("не https (mixed content)");
  if (p.length) structProblems.push(`${st.id}: ${p.join("; ")}`);
}

// --- сетевые проверки ---
const results = [];
for (const st of data.stations) {
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
