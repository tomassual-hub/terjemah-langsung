// Speaking on the translate screen (Chromium, with the fake recognizer of harness.mjs): the transcript and its translation
// follow live, the microphone uses the source language, errors are explained, and a browser without speech recognition
// points to keyboard dictation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
const { api, withApp, debug, waitStatus, outText, say } = H;
before(H.start);
after(H.stop);

const mic = page => page.locator('.view-translate .mic-btn');

test('speak: live transcript and live translation, then stop; the result is kept as a spoken entry', T, () => withApp({ storage: { from: 'ms', to: 'en' } }, async page => {
  await mic(page).click();
  assert.equal(await page.evaluate(() => window.__sr.active?.lang), 'ms-MY');
  assert.equal(await page.evaluate(() => window.__sr.active?.continuous), true);
  assert.equal(await mic(page).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.view-translate .mic-label').innerText(), /Mendengar \(Bahasa Melayu\)/);
  assert.equal(await page.locator('.src-input').evaluate(el => el.readOnly), true, 'no typing while listening');

  await say(page, 'selamat');
  await page.waitForFunction(() => document.querySelector('.src-input').value === 'selamat');
  await say(page, 'selamat pagi');
  await waitStatus(page, 'done');
  await page.waitForFunction(() => document.querySelector('.out-text').textContent === 'en:selamat pagi');

  await mic(page).click(); // stop
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
  assert.equal(await mic(page).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.src-input').evaluate(el => el.readOnly), false);
  await page.waitForFunction(() => window.__tl.history.list().length === 1, null, { timeout: 5000 });
  const [e] = await H.historyList(page);
  assert.deepEqual([e.src, e.out, e.mode, e.from, e.to], ['selamat pagi', 'en:selamat pagi', 'speech', 'ms', 'en']);
  assert.ok(api.mm.hits.length <= 3, `requests while speaking: ${api.mm.hits.length}`);
}));

test('speak: keeps listening when the engine stops on its own after a pause, and keeps what it heard', T, () => withApp({ storage: { from: 'en', to: 'ms' } }, async page => {
  await mic(page).click();
  await say(page, 'hello', true);
  await page.evaluate(() => window.__sr.end()); // iOS ends the session after a pause
  await page.waitForFunction(() => window.__sr.instances.length === 2 && window.__sr.active);
  await say(page, 'world');
  await page.waitForFunction(() => document.querySelector('.src-input').value === 'hello world');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:hello world');
  assert.equal((await debug(page)).listening, true);
}));

test('speak with "detect language": asks which language is spoken first', T, () => withApp({ storage: { from: 'auto', to: 'en' } }, async page => {
  await mic(page).click();
  await page.locator('.sheet .lang-row[data-lang="ta"]').first().click();
  await page.waitForFunction(() => window.__sr.active?.lang === 'ta-IN');
  assert.equal((await debug(page)).from, 'ta');
}));

test('microphone errors are explained in plain words (iPhone: Siri & Dictation off, permission denied)', T, () => withApp({}, async page => {
  await mic(page).click();
  await page.evaluate(() => window.__sr.fail('service-not-allowed'));
  await page.locator('.view-translate .mic-hint').waitFor({ state: 'visible' });
  assert.match(await page.locator('.view-translate .mic-hint').innerText(), /Siri & Imlak/);
  assert.equal((await debug(page)).listening, false);
  assert.equal(await page.evaluate(() => window.__sr.instances.length), 1, 'not restarted after a fatal error');
  await mic(page).click();
  await page.evaluate(() => window.__sr.fail('not-allowed'));
  await page.waitForFunction(() => /Akses mikrofon ditolak/.test(document.querySelector('.view-translate .mic-hint').textContent));
}));

test('no speech recognition in this browser: points to keyboard dictation and focuses the text box', T, () => withApp({ sr: false }, async page => {
  await mic(page).click();
  assert.match(await page.locator('.view-translate .mic-hint').innerText(), /imlak/);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('src-input')), true);
  // dictation through the keyboard is just typing: it is translated live
  await page.locator('.src-input').fill('dictated words');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:dictated words');
}));

test('listening stops when the app goes to the background, and on another tab', T, () => withApp({}, async page => {
  await mic(page).click();
  await say(page, 'something');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
  await mic(page).click();
  await page.locator('.tab[data-tab="history"]').click();
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
}));
