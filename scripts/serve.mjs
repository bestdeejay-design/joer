#!/usr/bin/env node
/**
 * Минимальный статический сервер для локальной разработки JOER.
 * Без зависимостей — только Node.
 *
 * Запуск:  npm run serve        (порт по умолчанию 8080)
 *          PORT=9000 npm run serve
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("403 — forbidden");
      return;
    }

    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { location: pathname + "/" }).end();
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("404 — не найдено");
  }
});

server.listen(PORT, () => {
  console.log(`JOER dev server → http://localhost:${PORT}  (root: ${ROOT})`);
});
