// Static server for dist/ with the production security headers:   npm start  ->  http://localhost:8080
// localhost is a secure context, so the service worker and the microphone work there. To try it on an iPhone use the deployed
// site or an HTTPS tunnel: iOS needs HTTPS for the microphone, install and offline.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './csp.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

export function createApp({ root = DIST } = {}) {
  const headers = securityHeaders();
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
      const body = await readFile(file);
      const cache = /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': cache });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err?.message || err));
    }
  });
}

export const listen = (server, port) => new Promise((ok, fail) => {
  server.once('error', fail);
  server.listen(port, '127.0.0.1', () => ok(server.address().port));
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--build')) await (await import('./build.mjs')).buildSite();
  const port = await listen(createApp(), Number(process.env.PORT) || 8080);
  console.log(`Terjemah Langsung: http://localhost:${port}`);
}
