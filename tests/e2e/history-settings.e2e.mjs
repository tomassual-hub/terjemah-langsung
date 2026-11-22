// History and settings (Chromium, phone size).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
const { api, withApp, waitStatus, typeText, outText } = H;
before(H.start);
after(H.stop);

const now = Date.now();
const HISTORY = [
  { id: 'h1', from: 'en', to: 'ms', src: 'Where is the station?', out: 'Di manakah stesen?', mode: 'text', at: now - 1000, fav: false },
  { id: 'h2', from: 'ms', to: 'zh', src: 'Terima kasih', out: '谢谢', mode: 'speech', at: now - 86400000 * 3, fav: true },
  { id: 'h3', from: 'en', to: 'ja', src: 'Good night', out: 'おやすみ', mode: 'conversation', at: now - 86400000 * 400, fav: false },
];

test('history: list, search, favourites filter, favourite toggle, delete, clear keeps favourites', T, () => withApp({ hash: '#/history', storage: { history: HISTORY } }, async page => {
  const items = page.locator('.hist-item');
  assert.equal(await items.count(), 3);
  assert.equal(await page.locator('.hist-item[data-id="h2"] .hist-langs').innerText(), 'Bahasa Melayu → Cina (Ringkas)');
  assert.equal(await page.locator('.hist-item[data-id="h2"] .hist-out').getAttribute('lang'), 'zh-CN');
  await page.locator('.view-history input[type="search"]').fill('stesen');
  assert.equal(await items.count(), 1);
  await page.locator('.view-history input[type="search"]').fill('');
  await page.locator('.view-history .chip', { hasText: 'Kegemaran' }).click();
  assert.deepEqual(await page.locator('.hist-item').evaluateAll(els => els.map(e => e.dataset.id)), ['h2']);
  await page.locator('.view-history .chip', { hasText: 'Semua' }).click();
  await page.locator('.hist-item[data-id="h1"] .fav-btn').click();
  assert.equal((await H.historyList(page)).find(e => e.id === 'h1').fav, true);
  await page.locator('.hist-item[data-id="h3"] [aria-label="Padam"]').click();
  assert.equal(await items.count(), 2);
  // only favourites left: there is nothing "clear" would remove, so it is not offered
  assert.equal(await page.locator('.view-history .link-btn.danger').isVisible(), false);
  await page.locator('.hist-item[data-id="h1"] .fav-btn').click();
  await page.locator('.view-history .link-btn.danger').click();
  await page.locator('.sheet .btn-danger').click();
  assert.deepEqual((await H.historyList(page)).map(e => e.id), ['h2'], 'the favourite stays');
  assert.equal(await items.count(), 1);
}));

test('history: an entry opens in the translator, and editing it updates that entry rather than adding a copy', T, () => withApp({ hash: '#/history', storage: { history: HISTORY } }, async page => {
  await page.locator('.hist-item[data-id="h1"] .hist-open').click();
  await page.waitForFunction(() => location.hash === '#/translate');
  assert.equal(await page.locator('.src-input').inputValue(), 'Where is the station?');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:Where is the station?');
  await typeText(page, 'Where is the station? Is it far?');
  await page.waitForFunction(() => window.__tl.history.list()[0]?.src === 'Where is the station? Is it far?', null, { timeout: 5000 });
  const list = await H.historyList(page);
  assert.equal(list.length, 3);
  assert.equal(list[0].id, 'h1');
}));

test('history off: nothing new is saved and the history screen says so', T, () => withApp({ storage: { saveHistory: false } }, async page => {
  await typeText(page, 'Not kept');
  await waitStatus(page, 'done');
  await page.waitForTimeout(2300);
  assert.deepEqual(await H.historyList(page), []);
  await page.locator('.tab[data-tab="history"]').click();
  assert.ok(await page.locator('.view-history .note').isVisible());
}));

test('settings: switching the interface to English relabels everything and keeps the text being translated', T, () => withApp({}, async page => {
  await typeText(page, 'Keep me');
  await waitStatus(page, 'done');
  await page.locator('.tab[data-tab="settings"]').click();
  await page.locator('.segmented button[data-value="en"]').click();
  assert.deepEqual(await page.locator('.tab span').allInnerTexts(), ['Translate', 'Interpreter', 'Conversation', 'History', 'Settings']);
  assert.equal(await page.locator('#app-title').innerText(), 'Live Translate');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.locator('.tab[data-tab="translate"]').click();
  assert.equal(await page.locator('.src-input').inputValue(), 'Keep me');
  assert.equal(await outText(page), 'ms:Keep me');
  assert.match(await page.locator('.lang-btn[data-role="to"]').innerText(), /Malay/);
}));

test('settings: theme, service and key (test button), and the key is only ever sent to that service', T, () => withApp({ hash: '#/settings' }, async page => {
  await page.locator('.segmented button[data-value="dark"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 17, 21)');

  await page.locator('.segmented button[data-value="google"]').click();
  const key = page.locator('input[data-setting="googleKey"]');
  assert.equal(await key.getAttribute('type'), 'password');
  await key.fill('AIza-from-settings');
  await key.blur();
  assert.equal(await page.evaluate(() => window.__tl.settings.get('googleKey')), 'AIza-from-settings');
  await page.locator('.btn:not([data-role])', { hasText: 'Uji' }).click();
  await page.locator('.test-out.ok').waitFor();
  assert.match(await page.locator('.test-out').first().innerText(), /Berfungsi: "ms:Good morning, how are you\?"/);
  assert.equal(api.google.hits[0].key, 'AIza-from-settings');
  assert.equal(api.mm.hits.length + api.ms.hits.length, 0);

  await page.locator('.segmented button[data-value="microsoft"]').click();
  await page.locator('.btn:not([data-role])', { hasText: 'Uji' }).click();
  await page.locator('.test-out.bad').waitFor();
  assert.match(await page.locator('.test-out').first().innerText(), /Masukkan kunci API Microsoft Translator/);
}));

test('settings: delete all data wipes keys and history and returns to the defaults', T, () => withApp({ hash: '#/settings', storage: { googleKey: 'secret', provider: 'google', history: HISTORY, uiLang: 'en' } }, async page => {
  await page.locator('.btn-danger.wide').click();
  await page.locator('.sheet .btn-danger').click();
  const left = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tl.')));
  assert.deepEqual(left, []);
  assert.equal(await page.evaluate(() => window.__tl.settings.get('googleKey')), '');
  assert.equal(await page.locator('#app-title').innerText(), 'Terjemah Langsung', 'back to the default (Malay on this device)');
}));
