// The iPhone checks, in WebKit (Safari's engine) with the iPhone 14 profile: the app boots marked as iOS, nothing overflows,
// fields are at least 16px in the system font (iOS zooms into smaller ones), the tab bar sits above the home bar, sheets work,
// typing and speaking translate live, and the conversation's top half is upside down. Real Safari on a real phone is still the
// final word (Siri dictation, the microphone prompt, voices), but WebKit catches layout and API differences Chromium hides.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { devices, webkit } from 'playwright';
import { createHarness, T } from './harness.mjs';

const IPHONE = devices['iPhone 14'];
// Playwright injects a <style> into WebKit pages for clicks and screenshots; the strict CSP refuses it (not an app problem)
const H = createHarness(webkit, { benign: [/Refused to apply a stylesheet/] });
const { withApp, waitStatus, typeText, outText, say } = H;
before(H.start);
after(H.stop);

const open = (opts, fn) => withApp({ device: IPHONE, ...opts }, fn);

test('iPhone: boots as iOS, the phone layout fits, the tab bar is on screen, fields will not zoom', T, () => open({}, async page => {
  assert.equal(await page.evaluate(() => document.documentElement.dataset.platform), 'ios');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways overflow');
  const bar = await page.locator('.tabbar').boundingBox();
  const vh = await page.evaluate(() => innerHeight);
  assert.ok(bar.y + bar.height <= vh + 1 && bar.y > vh - 120, `tab bar at the bottom: ${JSON.stringify(bar)} vh=${vh}`);
  const font = sel => page.evaluate(s => { const cs = getComputedStyle(document.querySelector(s)); return { size: parseFloat(cs.fontSize), family: cs.fontFamily }; }, sel);
  const src = await font('.src-input');
  assert.ok(src.size >= 16);
  assert.match(src.family, /-apple-system/);
  const viewport = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  assert.match(viewport, /viewport-fit=cover/);
  for (const name of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title']) assert.ok(await page.locator(`meta[name="${name}"]`).count());
  assert.ok(await page.locator('link[rel="apple-touch-icon"]').count());
  const mic = await page.locator('.view-translate .mic-btn').boundingBox();
  assert.ok(mic.width >= 44 && mic.height >= 44, 'touch target');
}));

test('iPhone: typing translates live; the language sheet slides up and closes', T, () => open({}, async page => {
  await typeText(page, 'Good morning');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:Good morning');
  await page.locator('.lang-btn[data-role="to"]').tap();
  await page.locator('.sheet').waitFor({ state: 'visible' });
  const sheet = await page.locator('.sheet').boundingBox();
  assert.ok(Math.round(sheet.y + sheet.height) >= (await page.evaluate(() => innerHeight)) - 1, 'sits on the bottom edge');
  assert.ok((await page.evaluate(() => getComputedStyle(document.querySelector('.lang-search')).fontSize)) >= '16px');
  await page.locator('.sheet .lang-row[data-lang="ja"]').first().tap();
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ja:Good morning');
}));

test('iPhone: speaking translates live (Safari exposes webkitSpeechRecognition)', T, () => open({ storage: { from: 'en', to: 'ms' } }, async page => {
  await page.locator('.view-translate .mic-btn').tap();
  await page.waitForFunction(() => window.__sr.active?.lang === 'en-US');
  await say(page, 'thank you very much');
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:thank you very much');
  await page.locator('.view-translate .mic-btn').tap();
  await page.waitForFunction(() => !window.__tl.views.translate.debug.listening);
}));

test('iPhone: conversation fills the screen, the top half is upside down, both mics reachable', T, () => open({ hash: '#/conversation' }, async page => {
  const t = await page.locator('.side-b').evaluate(el => getComputedStyle(el).transform);
  assert.match(t, /matrix\(-1, .*-1, 0, 0\)/, `rotated 180deg: ${t}`);
  const vh = await page.evaluate(() => innerHeight);
  for (const side of ['a', 'b']) {
    const box = await page.locator(`.conv-mic[data-side="${side}"]`).boundingBox();
    assert.ok(box.y > 0 && box.y + box.height < vh, `mic ${side} on screen`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}));

test('iPhone: Noisy place mode, press & hold the mic, music left out, no callout menu or text selection on the button', T, () => open({ storage: { noiseMode: true, from: 'en', to: 'ms' } }, async page => {
  const btn = page.locator('.view-translate .mic-btn');
  const css = await btn.evaluate(el => { const s = getComputedStyle(el); return { select: s.webkitUserSelect || s.userSelect, touch: s.touchAction, callout: s.webkitTouchCallout }; });
  assert.equal(css.select, 'none');
  assert.equal(css.touch, 'none');
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__sr.active?.lang === 'en-US');
  await page.evaluate(() => window.__sr.sayAll([['how much is this', true, 0.9], ['la la la la', true, 0.9]]));
  await page.waitForTimeout(500);
  await page.mouse.up();
  await waitStatus(page, 'done');
  assert.equal(await outText(page), 'ms:how much is this');
}));

test('iPhone: dark mode follows the system', T, () => open({ colorScheme: 'dark' }, async page => {
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content), '#0f1115');
}));
