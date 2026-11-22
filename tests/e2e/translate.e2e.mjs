// The translate screen in Chromium (phone size): live translation as you type, only changed sentences sent again, stale answers
// dropped, auto-detect, swap, errors and retry, offline, the other services, history, and the buttons on the translation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
const { api, withApp, debug, waitStatus, typeText, outText, historyList } = H;
before(H.start);
after(H.stop);

test('typing translates live; growing text only sends the new sentence; it lands in the history after a pause', T, () => withApp({}, async page => {
  assert.match(await outText(page), /Terjemahan akan muncul/);
  await typeText(page, 'Good morning.');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:Good morning.');
  assert.match(await page.locator('.out-status').innerText(), /MyMemory/);
  await typeText(page, 'Good morning. How are you?');
  await page.waitForFunction(() => document.querySelector('.out-text').textContent === 'ms:Good morning. ms:How are you?');
  assert.deepEqual(api.mm.hits.map(h => `${h.from}|${h.to}|${h.q}`), ['en|ms|Good morning.', 'en|ms|How are you?']);
  // history: one entry for the growing text, after the pause
  await page.waitForFunction(() => window.__tl.history.list().length === 1, null, { timeout: 5000 });
  const [e] = await historyList(page);
  assert.equal(e.src, 'Good morning. How are you?');
  assert.equal(e.out, 'ms:Good morning. ms:How are you?');
  assert.equal(e.mode, 'text');
  await typeText(page, 'Good morning. How are you? Fine.');
  await page.waitForFunction(() => window.__tl.history.list()[0]?.src.endsWith('Fine.'), null, { timeout: 5000 });
  assert.equal((await historyList(page)).length, 1, 'still one entry: the same text kept growing');
  // a different text is a new entry
  await typeText(page, 'Completely different');
  await page.waitForFunction(() => window.__tl.history.list().length === 2, null, { timeout: 5000 });
}));

test('fast typing: requests wait for a pause, and a slow old answer never overwrites a newer one', T, () => withApp({}, async page => {
  api.mm.reply = ({ q, to }) => ({ delay: q === 'slow' ? 900 : 10, body: { responseStatus: 200, responseData: { translatedText: `${to}:${q}` } } });
  const input = page.locator('.src-input');
  await input.pressSequentially('abcdef', { delay: 30 });
  await waitStatus(page, 'done');
  assert.deepEqual(api.mm.hits.map(h => h.q), ['abcdef'], 'one request after the pause, not one per key');

  await typeText(page, 'slow');
  await page.waitForTimeout(450); // the slow request is on its way
  await typeText(page, 'fast');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:fast');
  await page.waitForTimeout(800); // the slow answer arrives now
  assert.equal(await outText(page), 'ms:fast');
  assert.equal((await debug(page)).out, 'ms:fast');
}));

test('auto-detect: the detected language is shown, can be adopted, and swap uses it', T, () => withApp({ storage: { from: 'auto', to: 'en' } }, async page => {
  api.mm.reply = ({ q, to }) => ({ body: { responseStatus: 200, responseData: { translatedText: `${to}:${q}`, detectedLanguage: 'id' } } });
  assert.match(await page.locator('.lang-btn[data-role="from"]').innerText(), /Kesan bahasa/);
  await typeText(page, 'Selamat pagi');
  await waitStatus(page, 'done');
  assert.equal(api.mm.hits[0].from, 'autodetect');
  assert.equal(await page.locator('.chip.detected').innerText(), 'Dikesan: Indonesia');
  assert.match(await page.locator('.lang-btn[data-role="from"]').innerText(), /Indonesia \(Auto\)/);
  await page.locator('.view-translate .swap-btn').click();
  const d = await debug(page);
  assert.equal(d.from, 'en');
  assert.equal(d.to, 'id');
  assert.equal(await page.locator('.src-input').inputValue(), 'en:Selamat pagi', 'the translation becomes the new text');
}));

test('picking languages: the same language on both sides swaps them; the choice is remembered', T, () => withApp({}, async page => {
  await H.pickLang(page, '.lang-btn[data-role="to"]', 'zh');
  assert.deepEqual([(await debug(page)).from, (await debug(page)).to], ['en', 'zh']);
  await H.pickLang(page, '.lang-btn[data-role="from"]', 'zh');
  assert.deepEqual([(await debug(page)).from, (await debug(page)).to], ['zh', 'en']);
  // the recent list shows up in the picker
  await page.locator('.lang-btn[data-role="to"]').click();
  assert.ok(await page.locator('.sheet .lang-section').first().isVisible());
  await page.locator('.sheet .lang-search').fill('jep');
  assert.deepEqual(await page.locator('.sheet .lang-row .lang-name').allInnerTexts(), ['Jepun']);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => window.__tl?.views?.translate);
  assert.deepEqual([(await debug(page)).from, (await debug(page)).to], ['zh', 'en']);
}));

test('errors: quota explained with a way out, "try again" works once the service is back', T, () => withApp({}, async page => {
  api.mm.reply = () => ({ body: { responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' } } });
  await typeText(page, 'Hello');
  await waitStatus(page, 'error');
  assert.match(await page.locator('.out-status').innerText(), /Had percuma MyMemory/);
  api.mm.reply = ({ q, to }) => ({ body: { responseStatus: 200, responseData: { translatedText: `${to}:${q}` } } });
  await page.locator('.out-status .link-btn').click();
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:Hello');
}));

test('offline: the badge shows, the error says so, and coming back online translates', T, () => withApp({ allowErrors: [/Failed to load resource/] }, async (page, ctx) => {
  await H.setOffline(ctx, true);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-offline'));
  assert.ok(await page.locator('.net-badge').isVisible());
  await typeText(page, 'Offline text');
  await waitStatus(page, 'error');
  assert.match(await page.locator('.out-status').innerText(), /luar talian/i);
  await H.setOffline(ctx, false);
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:Offline text');
  assert.equal(await page.locator('.net-badge').isVisible(), false);
}));

test('Google: the key and payload go to Google only; a rejected key is explained', T, () => withApp({ storage: { provider: 'google', googleKey: 'AIza-test-key' }, allowErrors: [/status of 400/] }, async page => {
  await typeText(page, 'One line.\nSecond line.');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:One line.\nms:Second line.');
  assert.equal(api.google.hits.length, 1, 'both lines in one request');
  assert.deepEqual(api.google.hits[0], { key: 'AIza-test-key', q: ['One line.', 'Second line.'], target: 'ms', format: 'text', source: 'en' });
  assert.equal(api.mm.hits.length, 0);
  api.google.reply = () => ({ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } });
  await typeText(page, 'Another');
  await waitStatus(page, 'error');
  assert.match(await page.locator('.out-status').innerText(), /Kunci API Google Cloud ditolak/);
}));

test('Microsoft: key and region headers, Azure language codes', T, () => withApp({ storage: { provider: 'microsoft', msKey: 'ms-key', msRegion: 'southeastasia', to: 'zh' } }, async page => {
  await typeText(page, 'Hello');
  await waitStatus(page, 'done');
  assert.deepEqual(api.ms.hits[0], { to: 'zh-Hans', from: 'en', key: 'ms-key', region: 'southeastasia', texts: ['Hello'] });
  assert.equal(await outText(page), 'zh-Hans:Hello');
}));

test('no key yet: the screen says where to put it', T, () => withApp({ storage: { provider: 'google' } }, async page => {
  await typeText(page, 'Hello');
  await waitStatus(page, 'error');
  assert.match(await page.locator('.out-status').innerText(), /Masukkan kunci API Google Cloud dalam Tetapan/);
  assert.equal(api.google.hits.length, 0);
}));

test('translations are shown as text, never as markup', T, () => withApp({}, async page => {
  api.mm.reply = () => ({ body: { responseStatus: 200, responseData: { translatedText: '<img src=x onerror="window.__pwned=1"><b>bold</b>' } } });
  await typeText(page, 'xss');
  await waitStatus(page, 'done');
  assert.equal(await page.locator('.out-text img, .out-text b').count(), 0);
  assert.equal(await outText(page), '<img src=x onerror="window.__pwned=1"><b>bold</b>');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
}));

test('buttons: listen (with the right voice), copy, share, large view, favourite, clear', T, () => withApp({}, async page => {
  await typeText(page, 'Thank you');
  await waitStatus(page, 'done');
  await page.getByRole('button', { name: 'Dengar', exact: true }).click();
  await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'ms:Thank you'));
  const said = (await H.spoken(page)).find(s => s.text === 'ms:Thank you');
  assert.deepEqual([said.lang, said.voice], ['ms-MY', 'Amira']);
  await page.getByRole('button', { name: 'Salin' }).click();
  assert.equal(await page.evaluate(() => window.__clip), 'ms:Thank you');
  assert.match(await page.locator('.toast').innerText(), /Disalin/);
  await page.getByRole('button', { name: 'Kongsi' }).click();
  assert.deepEqual(await page.evaluate(() => window.__shared), { text: 'ms:Thank you' });
  await page.getByRole('button', { name: 'Tunjuk besar' }).click();
  assert.equal(await page.locator('.large-text').innerText(), 'ms:Thank you');
  await page.locator('.large-view').click();
  assert.equal(await page.locator('.large-view').count(), 0);
  await page.getByRole('button', { name: 'Kegemaran' }).click();
  const [e] = await historyList(page);
  assert.equal(e.fav, true);
  assert.equal(await page.locator('.fav-btn').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Kosongkan' }).click();
  assert.equal(await page.locator('.src-input').inputValue(), '');
  assert.match(await outText(page), /Terjemahan akan muncul/);
  assert.equal(await page.locator('.out-actions .icon-btn:not([disabled])').count(), 0, 'nothing to act on');
}));

test('paste fills the box and translates at once', T, () => withApp({}, async page => {
  await page.evaluate(() => { window.__clipIn = 'From the clipboard'; });
  await page.getByRole('button', { name: 'Tampal' }).click();
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:From the clipboard');
}));
