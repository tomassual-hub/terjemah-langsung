// Conversation mode (Chromium, phone size): each half listens in its own language, the other half shows the translation live,
// a pause ends the turn and the translation is read aloud in the other language; typing works too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHarness, T } from './harness.mjs';

const H = createHarness(chromium);
const { api, withApp, say, spoken } = H;
before(H.start);
after(H.stop);

const conv = page => page.evaluate(() => window.__tl.views.conversation.debug);
const OPEN = { hash: '#/conversation', storage: { convA: 'ms', convB: 'en' } };

test('a spoken turn: live in both halves, ends after a pause, read aloud in the other language, saved', T, () => withApp(OPEN, async page => {
  assert.ok(await page.locator('.view-conversation').isVisible());
  assert.ok(await page.locator('.view-conversation.face').count(), 'face to face by default: the top half is upside down');
  await page.locator('.conv-mic[data-side="a"]').click();
  assert.equal(await page.evaluate(() => window.__sr.active?.lang), 'ms-MY');
  await say(page, 'apa khabar');
  await page.waitForFunction(() => document.querySelector('.side-b .bubble.theirs')?.textContent.includes('en:apa khabar'));
  assert.equal(await page.locator('.side-a .bubble.mine .bubble-text').innerText(), 'apa khabar');
  // silence: the turn ends by itself (1.8 s), the translation is read in English
  await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'en:apa khabar'), null, { timeout: 8000 });
  const s = (await spoken(page)).find(x => x.text === 'en:apa khabar');
  assert.equal(s.lang, 'en-US');
  assert.equal((await conv(page)).active, null);
  const [e] = await H.historyList(page);
  assert.deepEqual([e.src, e.out, e.mode], ['apa khabar', 'en:apa khabar', 'conversation']);

  // the other person answers in English, into Malay
  await page.locator('.conv-mic[data-side="b"]').click();
  assert.equal(await page.evaluate(() => window.__sr.active?.lang), 'en-US');
  await say(page, 'I am fine');
  await page.locator('.conv-mic[data-side="b"]').click(); // or tap to end the turn
  await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'ms:I am fine' && s.lang === 'ms-MY'), null, { timeout: 8000 });
  const msgs = (await conv(page)).messages;
  assert.deepEqual(msgs.map(m => [m.by, m.src, m.out, m.status]), [['a', 'apa khabar', 'en:apa khabar', 'done'], ['b', 'I am fine', 'ms:I am fine', 'done']]);
  // each half shows the whole conversation in its own language
  assert.deepEqual(await page.locator('.side-a .bubble-text').allInnerTexts(), ['apa khabar', 'ms:I am fine']);
  assert.deepEqual(await page.locator('.side-b .bubble-text').allInnerTexts(), ['en:apa khabar', 'I am fine']);
}));

test('two quick typed messages are both translated (one does not cancel the other)', T, () => withApp(OPEN, async page => {
  api.mm.reply = ({ q, to }) => ({ delay: q === 'first' ? 500 : 20, body: { responseStatus: 200, responseData: { translatedText: `${to}:${q}` } } });
  await page.locator('.conv-divider .icon-btn[aria-label="Taip"]').click();
  await page.locator('.side-a .conv-input').fill('first');
  await page.locator('.side-a .conv-input').press('Enter');
  await page.locator('.side-b .conv-input').fill('second');
  await page.locator('.side-b .conv-send').click();
  await page.waitForFunction(() => window.__tl.views.conversation.debug.messages.every(m => m.status === 'done'), null, { timeout: 8000 });
  assert.deepEqual((await conv(page)).messages.map(m => m.out), ['en:first', 'ms:second']);
}));

test('auto-speak off: nothing is read; swap languages; clear the conversation', T, () => withApp({ ...OPEN, storage: { ...OPEN.storage, autoSpeak: false } }, async page => {
  await page.locator('.conv-mic[data-side="a"]').click();
  await say(page, 'terima kasih');
  await page.locator('.conv-mic[data-side="a"]').click();
  await page.waitForFunction(() => window.__tl.views.conversation.debug.messages[0]?.status === 'done');
  await page.waitForTimeout(300);
  assert.deepEqual(await spoken(page), []);
  // a bubble can still be read on demand
  await page.locator('.side-b .bubble-say').click();
  await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'en:terima kasih'));

  await page.locator('.conv-divider .icon-btn[aria-label="Tukar bahasa"]').click();
  assert.match(await page.locator('.lang-btn[data-role="conv-a"]').innerText(), /Inggeris/);
  await page.locator('.conv-divider .icon-btn[aria-label="Kosongkan perbualan"]').click();
  await page.locator('.sheet .btn-danger').click();
  assert.deepEqual((await conv(page)).messages, []);
  assert.match(await page.locator('.side-a .conv-empty').innerText(), /Inggeris/);
}));

test('face-to-face can be turned off; the choice is remembered', T, () => withApp(OPEN, async page => {
  await page.locator('.conv-divider .icon-btn[aria-label="Bersemuka"]').click();
  assert.equal(await page.locator('.view-conversation.face').count(), 0);
  assert.equal(await page.evaluate(() => window.__tl.settings.get('faceToFace')), false);
}));

test('no speech recognition: typing rows are there from the start, the mic explains', T, () => withApp({ ...OPEN, sr: false }, async page => {
  assert.ok(await page.locator('.side-a .conv-input').isVisible());
  assert.ok(await page.locator('.side-b .conv-input').isVisible());
  await page.locator('.conv-mic[data-side="a"]').click();
  assert.match(await page.locator('.side-a .conv-hint').innerText(), /imlak/);
}));
