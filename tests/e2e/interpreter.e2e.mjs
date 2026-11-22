// Interpreter (Chromium and WebKit with the iPhone profile): one tap, then every sentence is translated by itself.
//   - free: the browser recognizer in one chosen language; a pause ends a sentence
//   - Detect automatically: Azure AI Speech (a stand-in SDK at window.__tlSpeechSdk) says which language each sentence was in;
//     sentences in the listener's language go the other way
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit, devices } from 'playwright';
import { createHarness, T } from './harness.mjs';

const IPHONE = (({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent }) => ({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent }))(devices['iPhone 14']);

/** Runs in the page: a stand-in Speech SDK whose recognizer the test drives through window.__az. */
function fakeSpeechSdk() {
  const az = { made: [], current: null };
  window.__az = az;
  const sdk = {
    CancellationErrorCode: { AuthenticationFailure: 1, Forbidden: 2, TooManyRequests: 3, BadRequestParameters: 4, ConnectionFailure: 5 },
    CancellationReason: { Error: 1 },
    ResultReason: { RecognizedSpeech: 3 },
    PropertyId: { SpeechServiceConnection_LanguageIdMode: 'LID_MODE' },
    SpeechConfig: { fromEndpoint: (url, key) => ({ url: String(url), key, props: {}, setProperty(k, v) { this.props[k] = v; } }) },
    AudioConfig: { fromDefaultMicrophoneInput: () => ({ props: {}, setProperty(k, v) { this.props[k] = v; } }) },
    AutoDetectSourceLanguageConfig: { fromLanguages: list => ({ list }) },
    AutoDetectSourceLanguageResult: { fromResult: r => ({ language: r.lang }) },
    SpeechRecognizer: {
      FromConfig(config, auto, audio) {
        const rec = {
          url: config.url, key: config.key, mode: config.props.LID_MODE, langs: auto.list, worklet: audio.props['MICROPHONE-WorkletSourceUrl'],
          running: false, closed: false,
          startContinuousRecognitionAsync(ok) { this.running = true; az.current = this; ok(); },
          stopContinuousRecognitionAsync(ok) { this.running = false; setTimeout(() => { this.sessionStopped?.(); ok?.(); }, 5); },
          close() { this.closed = true; if (az.current === this) az.current = null; },
        };
        az.made.push(rec);
        return rec;
      },
    },
  };
  az.partial = (text, lang) => az.current?.recognizing?.(null, { result: { text, lang } });
  az.say = (text, lang) => az.current?.recognized?.(null, { result: { text, lang, reason: 3 } });
  az.fail = (errorCode, errorDetails = '') => az.current?.canceled?.(null, { reason: 1, errorCode, errorDetails });
  window.__tlSpeechSdk = sdk;
}

const AUTO = {
  hash: '#/interpreter', init: fakeSpeechSdk,
  storage: { interpFrom: 'auto', interpTo: 'ms', interpLangs: ['ms', 'en', 'zh'], speechKey: 'test-key', speechRegion: 'southeastasia' },
};
const interp = page => page.evaluate(() => window.__tl.views.interpreter.debug);

for (const [name, type, device] of [['chromium', chromium, undefined], ['webkit (iPhone)', webkit, IPHONE]]) {
  describe(name, () => {
    const H = createHarness(type);
    const { api, withApp, say } = H;
    before(H.start);
    after(H.stop);
    const opts = o => (device ? { device, ...o } : o);

    test('free: one tap, every sentence after a pause is translated by itself; the mic keeps listening', T, () => withApp(opts({ hash: '#/interpreter', storage: { interpFrom: 'en', interpTo: 'ms' } }), async page => {
      assert.ok(await page.locator('.view-interpreter').isVisible());
      assert.match(await page.locator('.interp-note').innerText(), /Inggeris.*Bahasa Melayu/);
      await page.locator('.interp-mic').click();
      assert.equal(await page.evaluate(() => window.__sr.active?.lang), 'en-US');
      await say(page, 'good morning everyone');
      // live: the sentence still being spoken is shown and translated
      await page.waitForFunction(() => document.querySelector('.seg.live .seg-out')?.textContent === 'ms:good morning everyone');
      // a pause: the sentence is final and translated
      await page.waitForFunction(() => window.__tl.views.interpreter.debug.segments.length === 1, null, { timeout: 5000 });
      await page.evaluate(() => window.__sr.sayAll([['good morning everyone', true], ['welcome to the summit', false]]));
      await page.waitForFunction(() => window.__tl.views.interpreter.debug.segments.length === 2, null, { timeout: 5000 });
      await page.waitForFunction(() => window.__tl.views.interpreter.debug.segments.every(s => s.status === 'done'));
      const d = await interp(page);
      assert.deepEqual(d.segments.map(s => [s.src, s.out, s.from, s.to]), [
        ['good morning everyone', 'ms:good morning everyone', 'en', 'ms'],
        ['welcome to the summit', 'ms:welcome to the summit', 'en', 'ms'],
      ]);
      assert.equal(d.listening, true, 'still listening after two sentences');
      assert.deepEqual(await page.locator('.seg:not(.live) .seg-out').allInnerTexts(), ['ms:good morning everyone', 'ms:welcome to the summit']);
      // the engine stops by itself after a while (iOS does): the interpreter starts it again
      await page.evaluate(() => window.__sr.end());
      await page.waitForFunction(() => window.__sr.active, null, { timeout: 3000 });
      assert.equal((await interp(page)).listening, true);
      // the whole session is one history entry
      const hist = await H.historyList(page);
      assert.equal(hist.length, 1);
      assert.equal(hist[0].mode, 'interpreter');
      assert.equal(hist[0].out, 'ms:good morning everyone\nms:welcome to the summit');
      // swapping direction while listening: it keeps listening, now in Malay
      await page.locator('.view-interpreter .swap-btn').click();
      await page.waitForFunction(() => window.__sr.active?.lang === 'ms-MY', null, { timeout: 3000 });
      await page.waitForTimeout(100);
      assert.equal((await interp(page)).listening, true, 'still on after the swap');
      assert.equal(await page.locator('.interp-mic').getAttribute('aria-pressed'), 'true');
      await say(page, 'terima kasih');
      await page.waitForFunction(() => window.__tl.views.interpreter.debug.segments.some(s => s.out === 'en:terima kasih'), null, { timeout: 5000 });
      // stop
      await page.locator('.interp-mic').click();
      await page.waitForFunction(() => !window.__tl.views.interpreter.debug.listening);
      assert.equal(await page.locator('.interp-mic').getAttribute('aria-pressed'), 'false');
    }));

    test('Detect automatically: each sentence in its own language, replies in the listener language go the other way', T, () => withApp(opts(AUTO), async page => {
      assert.match(await page.locator('[data-role="interp-from"]').innerText(), /Kesan bahasa/);
      assert.match(await page.locator('.interp-note').innerText(), /Bahasa Melayu, Inggeris, Cina/);
      await page.locator('.interp-mic').click();
      await page.waitForFunction(() => window.__az.current?.running);
      const rec = await page.evaluate(() => { const r = window.__az.current; return { url: r.url, key: r.key, mode: r.mode, langs: r.langs, worklet: r.worklet }; });
      assert.equal(rec.url, 'wss://southeastasia.stt.speech.microsoft.com/speech/universal/v2');
      assert.equal(rec.key, 'test-key');
      assert.equal(rec.mode, 'Continuous');
      assert.deepEqual(rec.langs, ['ms-MY', 'en-US', 'zh-CN']);
      assert.match(rec.worklet, /\/speech-processor\.js$/);
      // the worklet file is really served (same origin, allowed by the CSP)
      assert.equal(await page.evaluate(u => fetch(u).then(r => r.status), rec.worklet), 200);

      await page.evaluate(() => window.__az.partial('distinguished guests', 'en-US'));
      await page.waitForFunction(() => document.querySelector('.seg.live .seg-out')?.textContent === 'ms:distinguished guests');
      await page.evaluate(() => window.__az.say('Distinguished guests, welcome.', 'en-US'));
      await page.evaluate(() => window.__az.say('我们欢迎合作。', 'zh-CN'));
      await page.evaluate(() => window.__az.say('Terima kasih semua.', 'ms-MY'));
      await page.waitForFunction(() => window.__tl.views.interpreter.debug.segments.filter(s => s.status === 'done').length === 3);
      const d = await interp(page);
      assert.deepEqual(d.segments.map(s => [s.from, s.to, s.out]), [
        ['en', 'ms', 'ms:Distinguished guests, welcome.'],
        ['zh', 'ms', 'ms:我们欢迎合作。'],
        ['ms', 'en', 'en:Terima kasih semua.'], // the listener's own language: into the other one
      ]);
      assert.deepEqual(await page.locator('.seg:not(.live) .seg-badge').allInnerTexts(), ['Inggeris → Bahasa Melayu', 'Cina (Ringkas) → Bahasa Melayu', 'Bahasa Melayu → Inggeris']);
      assert.ok(api.mm.hits.some(h => h.from === 'zh-CN' && h.to === 'ms'));
      const [e] = await H.historyList(page);
      assert.equal(e.from, 'auto');

      await page.locator('.interp-mic').click();
      await page.waitForFunction(() => !window.__tl.views.interpreter.debug.listening);
      await page.waitForFunction(() => window.__az.made.at(-1).closed, null, { timeout: 3000 }); // stopped, then released
    }));

    test('Detect automatically: a rejected key is explained; no key = offered the way to Settings', T, () => withApp(opts(AUTO), async page => {
      await page.locator('.interp-mic').click();
      await page.waitForFunction(() => window.__az.current?.running);
      await page.evaluate(() => window.__az.fail(1, 'WebSocket upgrade failed: Authentication error (401)'));
      await page.locator('.view-interpreter .mic-hint').waitFor();
      assert.match(await page.locator('.view-interpreter .mic-hint').innerText(), /Kunci Azure AI Speech ditolak/);
      assert.equal((await interp(page)).listening, false);

      await page.evaluate(() => { window.__tl.settings.set('speechKey', ''); });
      await page.locator('.interp-mic').click();
      await page.locator('.sheet-confirm').waitFor();
      await page.locator('.sheet-confirm .btn-primary').click();
      await page.waitForFunction(() => window.__tl.current === 'settings');
      assert.ok(await page.locator('[data-group="azure-speech"] [data-setting="speechKey"]').isVisible());
    }));
  });
}

describe('chromium: choosing languages', () => {
  const H = createHarness(chromium);
  before(H.start);
  after(H.stop);

  test('the real Speech SDK chunk loads under the CSP when the screen opens in Detect automatically (no connection is made)', T, () => H.withApp({ ...AUTO, init: null }, async page => {
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => /\/assets\/chunk-/.test(e.name)), null, { timeout: 10_000 });
    const shape = await page.evaluate(async () => {
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(n => /\/assets\/chunk-/.test(n));
      for (const u of urls) {
        const m = await import(u);
        const sdk = Object.values(m).find(v => v && v.SpeechConfig) ?? (m.SpeechConfig ? m : null);
        if (sdk) return { fromEndpoint: typeof sdk.SpeechConfig.fromEndpoint, lid: sdk.PropertyId.SpeechServiceConnection_LanguageIdMode !== undefined, auto: typeof sdk.AutoDetectSourceLanguageConfig.fromLanguages, rec: typeof sdk.SpeechRecognizer.FromConfig };
      }
      return null;
    });
    assert.deepEqual(shape, { fromEndpoint: 'function', lid: true, auto: 'function', rec: 'function' });
  }));

  test('Settings › Test checks the Azure Speech key at its own region only (accepted, then rejected)', T, () => H.withApp({ ...AUTO, hash: '#/settings', allowErrors: [/status of 401/] }, async (page, ctx) => {
    const hits = [];
    let status = 200;
    await ctx.route('https://southeastasia.api.cognitive.microsoft.com/**', route => {
      hits.push({ url: route.request().url(), key: route.request().headers()['ocp-apim-subscription-key'], method: route.request().method() });
      return route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: status === 200 ? 'token' : '' });
    });
    await page.locator('[data-role="test-speech"]').click();
    await page.waitForFunction(() => document.querySelector('[data-group="azure-speech"] .test-out')?.classList.contains('ok'));
    const posts = hits.filter(x => x.method === 'POST');
    assert.deepEqual(posts.map(x => [x.url, x.key]), [['https://southeastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken', 'test-key']]);
    status = 401;
    await page.locator('[data-role="test-speech"]').click();
    await page.waitForFunction(() => document.querySelector('[data-group="azure-speech"] .test-out')?.classList.contains('bad'));
    assert.match(await page.locator('[data-group="azure-speech"] .test-out').innerText(), /ditolak/);
  }));

  test('"Detect language" opens the list of languages that may be spoken; reading aloud pauses the mic', T, () => H.withApp(AUTO, async page => {
    await page.evaluate(() => window.__tl.settings.set('interpFrom', 'en'));
    await page.evaluate(() => window.__tl.views.interpreter.show());
    await page.locator('[data-role="interp-from"]').click();
    await page.locator('.sheet .lang-row[data-lang="auto"]').click();
    await page.locator('.sheet .cand-row').first().waitFor();
    await page.locator('.sheet input[data-lang="ja"]').check();
    await page.locator('.sheet input[data-lang="zh"]').uncheck();
    await page.locator('[data-role="cands-done"]').click();
    await page.locator('.sheet-backdrop').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => window.__tl.settings.get('interpLangs')), ['ms', 'en', 'ja']);
    assert.equal(await page.evaluate(() => window.__tl.settings.get('interpFrom')), 'auto');

    // read aloud: the microphone stops while the phone speaks, then listens again
    await page.locator('.view-interpreter .icon-btn[aria-label="Baca terjemahan dengan suara"]').click();
    await page.locator('.interp-mic').click();
    await page.waitForFunction(() => window.__az.current?.running);
    await page.evaluate(() => window.__az.say('おはようございます', 'ja-JP'));
    await page.waitForFunction(() => window.__tts.spoken.some(s => s.text === 'ms:おはようございます' && s.lang === 'ms-MY'));
    await page.waitForFunction(() => window.__az.made.length === 2 && window.__az.current?.running, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__az.made[0].closed), true, 'the first recognizer was stopped for the speech');
    assert.equal((await interp(page)).listening, true);
  }));
});
