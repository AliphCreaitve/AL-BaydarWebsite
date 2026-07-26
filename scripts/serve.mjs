#!/usr/bin/env node
/**
 * Zero-dependency static server for the demo.
 *
 *   node scripts/serve.mjs [port]
 *
 * Why not `npx serve`: it downloads a package on first run, which fails behind
 * a proxy or offline, and the process dies with whatever shell started it.
 * This has no dependencies and you own the process.
 *
 * The part that actually matters here is HTTP Range support. Scrubbing sets
 * `video.currentTime` continuously, and each seek is a byte-range request. A
 * static server that ignores Range either breaks seeking outright or re-sends
 * the whole 20 MB file per seek — which looks exactly like "the scrubbing is
 * broken" rather than "the server is wrong".
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5177;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.JPG': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    const file = path.join(ROOT, rel);
    // Refuse anything that escapes the project directory.
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(file);
      if (info.isDirectory()) {
        res.writeHead(302, { Location: rel + '/' }).end();
        return;
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
         .end(`404 — ${rel}\n\nIf this is a video, the assets aren't built yet:\n` +
              `  node scripts/build-walkthrough.mjs\n` +
              `  node scripts/process-video.mjs assets/walkthrough.mp4\n`);
      return;
    }

    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const range = req.headers.range;

    // Byte-range request — required for video seeking to work at all.
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : info.size - 1;
        if (start >= info.size || end >= info.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': 'no-cache',
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': info.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Either close what's using it, or pick another:\n`);
    console.error(`      node scripts/serve.mjs 5178\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  Al Baydar demo\n`);
  console.log(`      http://localhost:${PORT}/demo/\n`);
  console.log(`  Serving ${ROOT}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
