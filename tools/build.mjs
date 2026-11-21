// Builds the static site into dist/:  node tools/build.mjs   (npm run build)
//   - bundles src/js (ES modules) and src/css with esbuild (Lucide icons are imported as text, see src/js/core/dom.js)
//   - copies the static files (manifest, icons, theme-boot)
//   - writes index.html with hashed asset names and a CSP <meta>, the service worker with its precache list, and Netlify's _headers

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { metaCsp, securityHeaders } from './csp.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** @param {{quiet?:boolean, netlifyBadge?:boolean}} o */
export async function buildSite({ quiet = false, netlifyBadge = false } = {}) {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: { main: join(SRC, 'js/main.js'), app: join(SRC, 'css/app.css') },
    outdir: join(DIST, 'assets'),
    entryNames: '[name]-[hash]',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022', 'safari15', 'chrome100', 'firefox100'],
    minify: true,
    legalComments: 'none',
    metafile: true,
    loader: { '.svg': 'text' },
    logLevel: quiet ? 'error' : 'info',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  });

  const rel = p => relative(DIST, resolve(ROOT, p)).replace(/\\/g, '/');
  const outputs = Object.keys(result.metafile.outputs).map(rel);
  const entryOf = ext => rel(Object.entries(result.metafile.outputs).find(([p, m]) => p.endsWith(ext) && m.entryPoint)[0]);
  const jsEntry = entryOf('.js');
  const cssEntry = entryOf('.css');

  const copy = (from, to) => { mkdirSync(join(to, '..'), { recursive: true }); cpSync(from, to, { recursive: true }); };
  copy(join(SRC, 'manifest.webmanifest'), join(DIST, 'manifest.webmanifest'));
  copy(join(SRC, 'theme-boot.js'), join(DIST, 'theme-boot.js'));
  if (existsSync(join(SRC, 'icons'))) copy(join(SRC, 'icons'), join(DIST, 'icons'));

  const html = readFileSync(join(SRC, 'index.html'), 'utf8')
    .replace('%JS%', jsEntry)
    .replace('%CSS%', cssEntry)
    .replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="${metaCsp({ netlifyBadge })}" />`);
  writeFileSync(join(DIST, 'index.html'), html);

  const precache = ['./', './index.html', './manifest.webmanifest', './theme-boot.js', ...outputs.filter(f => /\.(js|css)$/.test(f)).map(f => `./${f}`)];
  if (existsSync(join(DIST, 'icons'))) for (const f of readdirSync(join(DIST, 'icons'))) precache.push(`./icons/${f}`);
  const version = createHash('sha256').update(precache.join('|') + pkg.version + (process.env.BUILD_SALT || '')).update(html).digest('hex').slice(0, 10);
  const sw = readFileSync(join(SRC, 'sw.js'), 'utf8')
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace("'__PRECACHE__'", JSON.stringify(JSON.stringify(precache)));
  writeFileSync(join(DIST, 'sw.js'), sw);

  const block = headers => Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  writeFileSync(join(DIST, '_headers'), [
    '/*', block(securityHeaders({ netlifyBadge })), '',
    '/sw.js', '  Cache-Control: no-cache', '',
    '/', '  Cache-Control: no-cache', '',
    '/index.html', '  Cache-Control: no-cache', '',
    '/manifest.webmanifest', '  Content-Type: application/manifest+json; charset=utf-8', '  Cache-Control: no-cache', '',
    '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '',
    '/icons/*', '  Cache-Control: public, max-age=86400', '',
  ].join('\n'));

  if (!quiet) {
    const size = outputs.filter(f => /\.(js|css)$/.test(f)).reduce((n, f) => n + statSync(join(DIST, f)).size, 0);
    console.log(`\ndist/ siap: v${pkg.version}, sw ${version}, kod ${(size / 1024).toFixed(0)} KB`);
  }
  return { dist: DIST, version, jsEntry, cssEntry, precache };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite({ netlifyBadge: process.argv.includes('--netlify-badge') }).catch(err => { console.error(err); process.exit(1); });
}
