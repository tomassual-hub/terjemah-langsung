// Deploys dist/ to Netlify through the REST API (no netlify-cli needed):
//   node tools/deploy-netlify.mjs --list                         list your sites (read-only)
//   node tools/deploy-netlify.mjs --name radar-xyz create a NEW site and deploy to it
//   node tools/deploy-netlify.mjs                                 deploy to the site saved in .netlify/state.json
//   node tools/deploy-netlify.mjs --site-id <id>                  deploy to that site
//   node tools/deploy-netlify.mjs --rename <name>                 first change the site's address to <name>.netlify.app, then deploy
// The token comes from NETLIFY_AUTH_TOKEN or from the login `netlify login` stored on this machine.
// It is only ever sent to api.netlify.com and is never printed.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildSite } from './build.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const STATE = join(ROOT, '.netlify', 'state.json');
const API = 'https://api.netlify.com/api/v1';

const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = name => process.argv.includes(name);

function findToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const dirs = [process.env.APPDATA && join(process.env.APPDATA, 'netlify', 'Config'), process.env.APPDATA && join(process.env.APPDATA, 'Netlify', 'Config'),
    join(homedir(), '.config', 'netlify'), join(homedir(), 'Library', 'Preferences', 'netlify')].filter(Boolean);
  for (const d of dirs) {
    const f = join(d, 'config.json');
    if (!existsSync(f)) continue;
    const cfg = JSON.parse(readFileSync(f, 'utf8'));
    const user = cfg.users && cfg.users[cfg.userId];
    if (user && user.auth && user.auth.token) return user.auth.token;
  }
  throw new Error('Tiada token Netlify. Jalankan "npx netlify-cli login" atau tetapkan NETLIFY_AUTH_TOKEN.');
}

const token = findToken();
const call = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`Netlify ${init.method || 'GET'} ${path} -> ${res.status} ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 300)}`);
  return body;
};

const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

async function zipDist() {
  const zip = new JSZip();
  for (const f of files(DIST)) zip.file(relative(DIST, f).split('\\').join('/'), readFileSync(f), { date: statSync(f).mtime });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function main() {
  if (flag('--list')) {
    const sites = await call('/sites?per_page=100&filter=all');
    for (const s of sites) console.log(`${s.name.padEnd(38)} ${s.id}  ${s.ssl_url || s.url}`);
    console.log(`\n${sites.length} tapak`);
    return;
  }

  let siteId = arg('--site-id') || (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).siteId : undefined);
  let site;
  if (!siteId) {
    const name = arg('--name');
    if (!name) throw new Error('Beri --name untuk mencipta tapak baharu, atau --site-id untuk tapak sedia ada.');
    site = await call('/sites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    siteId = site.id;
    mkdirSync(join(ROOT, '.netlify'), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ siteId }, null, 2));
    console.log(`Tapak baharu dicipta: ${site.name} (${siteId})`);
  } else {
    site = await call(`/sites/${siteId}`);
    console.log(`Deploy ke tapak sedia ada: ${site.name} (${siteId})`);
  }

  // --rename <name>: the site's address becomes <name>.netlify.app BEFORE anything is uploaded (a name that is taken stops here, with nothing changed).
  // The old address stops working, and what a browser saved under it (settings, a signed-in session) does not follow to the new one.
  const newName = arg('--rename');
  if (newName && newName !== site.name) {
    const before = site.name;
    site = await call(`/sites/${siteId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newName }) });
    console.log(`Tapak dinamakan semula: ${before} -> ${site.name} (${site.ssl_url || site.url})`);
  }

  if (!flag('--no-build')) await buildSite({ quiet: true, netlifyBadge: true }); // the free plan's badge needs a small CSP allowance
  const zip = await zipDist();
  console.log(`dist/ dimampat: ${(zip.length / 1024 / 1024).toFixed(1)} MB, memuat naik...`);

  let deploy = await call(`/sites/${siteId}/deploys`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
  for (let i = 0; i < 90 && deploy.state !== 'ready' && deploy.state !== 'error'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    deploy = await call(`/deploys/${deploy.id}`);
  }
  if (deploy.state !== 'ready') throw new Error(`Deploy tidak siap (keadaan: ${deploy.state}) ${deploy.error_message || ''}`);
  console.log(`\nSIAP: ${deploy.ssl_url || deploy.url}`);
  console.log(`Deploy: ${deploy.id}  Tapak: ${site.name}  Admin: ${site.admin_url}`);
}

main().catch(err => { console.error(String(err.message || err).replace(token, '***')); process.exit(1); });
