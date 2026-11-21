// The service worker (Chromium: Playwright's WebKit cannot route requests that pass through a worker): after one visit the
// app opens without the network, and the worker never touches requests to the translation services.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
before(H.start);
after(H.stop);

test('installed shell: opens offline after the first visit; translation services are not cached', T, () => H.withApp({ serviceWorkers: 'allow', allowErrors: [/Failed to load resource/, /ERR_INTERNET_DISCONNECTED/] }, async (page, ctx) => {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await H.typeText(page, 'Online once');
  await H.waitStatus(page, 'done');
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    return out;
  });
  assert.ok(cached.some(u => u.endsWith('/index.html')));
  assert.ok(cached.some(u => /\/assets\/main-.*\.js$/.test(u)));
  assert.ok(!cached.some(u => /mymemory|googleapis|microsofttranslator/.test(u)), 'no translations in the cache');

  await H.setOffline(ctx, true);
  await page.reload();
  await page.waitForFunction(() => window.__tl?.views?.translate);
  assert.equal(await page.locator('#app-title').innerText(), 'Terjemah Langsung');
  assert.ok(await page.locator('.net-badge').isVisible());
}));
