// Noisy place mode (Chromium, phone size): press & hold to talk, music-like and unsure results dropped, a tap listens for one
// sentence, no restarts after letting go, the suggestion in normal mode, the tap fallback, and the conversation screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
const { withApp, waitStatus, outText } = H;
before(H.start);
after(H.stop);

const NOISY = { storage: { noiseMode: true, from: 'en', to: 'ms' } };
const mic = page => page.locator('.view-translate .mic-btn');
const sayAll = (page, items) => page.evaluate(i => window.__sr.sayAll(i), items);
const listening = page => page.evaluate(() => window.__tl.views.translate.debug.listening);

/** Presses the button down (and keeps it down until release()). */
async function press(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  return { release: () => page.mouse.up() };
}

test('the switch: off by default, on with one tap, shown on the mic and in Settings, remembered', T, () => withApp({}, async page => {
  const chip = page.locator('.noise-chip');
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.mic-label').innerText(), 'Tekan untuk bercakap');
  await chip.click();
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.mic-label').innerText(), 'Tekan & tahan semasa bercakap');
  assert.equal(await page.evaluate(() => window.__tl.settings.get('noiseMode')), true);
  await page.locator('.tab[data-tab="settings"]').click();
  const box = page.locator('label.row', { hasText: 'Mod bising' }).locator('input');
  assert.equal(await box.isChecked(), true);
  await box.uncheck();
  await page.locator('.tab[data-tab="translate"]').click();
  assert.equal(await chip.getAttribute('aria-pressed'), 'false', 'the switch follows Settings');
}));

test('press & hold: listens while held, music and unsure words are left out, letting go ends it and translates', T, () => withApp(NOISY, async page => {
  const p = await press(page, mic(page));
  await page.waitForFunction(() => window.__sr.active?.lang === 'en-US');
  assert.match(await page.locator('.mic-label').innerText(), /lepaskan bila habis/);
  await sayAll(page, [['where is the', false]]);
  await sayAll(page, [['where is the station', true, 0.91], ['la la la la', true, 0.8], ['[Music]', true, 0.7], ['mumble grumble', true, 0.2], ['oh oh oh', false]]);
  await page.waitForFunction(() => document.querySelector('.src-input').value === 'where is the station');
  await page.waitForTimeout(1500); // a pause while still held: does not stop
  assert.equal(await listening(page), true, 'held: keeps listening through a pause');
  await p.release();
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:where is the station');
}));

test('held: the engine stopping by itself starts it again; after letting go it does not', T, () => withApp(NOISY, async page => {
  const p = await press(page, mic(page));
  await page.waitForFunction(() => window.__sr.active);
  await H.say(page, 'hello', true);
  await page.evaluate(() => window.__sr.end());
  await page.waitForFunction(() => window.__sr.instances.length === 2 && window.__sr.active);
  await H.say(page, 'friend');
  await page.waitForFunction(() => document.querySelector('.src-input').value === 'hello friend');
  await p.release();
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__sr.instances.length), 2);
}));

test('a short tap listens for one sentence: the first pause ends it, before music can fill the gap', T, () => withApp(NOISY, async page => {
  await mic(page).click();
  await page.waitForFunction(() => window.__sr.active);
  await H.say(page, 'good evening');
  assert.equal(await listening(page), true);
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening, null, { timeout: 4000 });
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:good evening');
  // the engine pausing on its own after a tap is not restarted either
  await mic(page).click();
  await page.waitForFunction(() => window.__sr.active);
  const n = await page.evaluate(() => window.__sr.instances.length);
  await page.evaluate(() => window.__sr.end());
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__sr.instances.length), n);
  assert.equal(await listening(page), false);
}));

test('keyboard: Enter on the mic still toggles in Noisy place mode', T, () => withApp(NOISY, async page => {
  await mic(page).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__sr.active);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
}));

test('normal mode: music-like results suggest the mode once, and the toast turns it on', T, () => withApp({ storage: { from: 'en', to: 'ms' } }, async page => {
  await mic(page).click();
  await sayAll(page, [['thank you', true, 0.9], ['na na na na na', true, 0.8]]);
  await page.locator('.toast', { hasText: 'Mod bising' }).waitFor();
  assert.equal(await page.locator('.src-input').inputValue(), 'thank you na na na na na', 'normal mode keeps everything');
  await page.locator('.toast-btn', { hasText: 'Hidupkan' }).click();
  assert.equal(await page.evaluate(() => window.__tl.settings.get('noiseMode')), true);
  assert.equal(await page.locator('.noise-chip').getAttribute('aria-pressed'), 'true');
}));

test('a browser that refuses to start from a press falls back to taps, with an explanation', T, () => withApp(NOISY, async page => {
  const p = await press(page, mic(page));
  await page.waitForFunction(() => window.__sr.active);
  await page.evaluate(() => window.__sr.fail('not-allowed'));
  await p.release();
  await page.locator('.view-translate .mic-hint').waitFor({ state: 'visible' });
  assert.match(await page.locator('.view-translate .mic-hint').innerText(), /tidak membenarkan tekan & tahan/);
  assert.equal(await page.locator('.mic-label').innerText(), 'Tekan untuk bercakap');
  await mic(page).click(); // a tap now starts it
  await page.waitForFunction(() => window.__sr.active);
  await H.say(page, 'tapped');
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening, null, { timeout: 4000 });
  assert.equal(await page.locator('.src-input').inputValue(), 'tapped');
}));

test('conversation: hold to talk per person; music left out; letting go translates and reads it aloud', T, () => withApp({ hash: '#/conversation', storage: { noiseMode: true, convA: 'ms', convB: 'en' } }, async page => {
  assert.equal(await page.locator('.conv-divider [aria-label="Mod bising"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.conv-mic[data-side="a"]').getAttribute('aria-label'), /Tekan & tahan untuk bercakap dalam Bahasa Melayu/);
  const p = await press(page, page.locator('.conv-mic[data-side="a"]'));
  await page.waitForFunction(() => window.__sr.active?.lang === 'ms-MY');
  await sayAll(page, [['berapa harga ini', true, 0.9], ['oh oh oh oh', true, 0.9]]);
  await page.waitForTimeout(2200); // longer than the normal turn pause: still held, still listening
  assert.equal(await page.evaluate(() => window.__tl.views.conversation.debug.active), 'a');
  await p.release();
  await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'en:berapa harga ini'), null, { timeout: 8000 });
  const msgs = await page.evaluate(() => window.__tl.views.conversation.debug.messages);
  assert.deepEqual(msgs.map(m => [m.src, m.out]), [['berapa harga ini', 'en:berapa harga ini']]);
}));
