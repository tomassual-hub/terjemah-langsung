// Shared plumbing of the end-to-end suites: the built app on a local server, the three translation services mocked, a speech
// recognizer and a speech synthesizer the tests drive (headless browsers have neither a microphone nor voices), and a fresh
// browser context per test that fails on console errors, CSP violations or requests to hosts that are not mocked.
import assert from 'node:assert/strict';
import { buildSite } from '../../tools/build.mjs';
import { createApp, listen } from '../../tools/serve.mjs';

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
export const T = { timeout: 90_000 };

const BENIGN = [/Service Worker registration blocked by Playwright/];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/** The default fake translation: "<to>:<text>", so a test can tell what was translated into what. */
export const fakeTranslate = (text, to) => `${to}:${text}`;

/** Runs in the page before any of its scripts: the fake recognizer, synthesizer, clipboard and share sheet. */
function pageFakes({ sr }) {
  window.__sr = { instances: [], active: null };
  if (sr) {
    class FakeSpeechRecognition {
      constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; window.__sr.instances.push(this); }
      start() { this.started = true; window.__sr.active = this; }
      stop() { this.stopped = true; setTimeout(() => { if (window.__sr.active === this) window.__sr.active = null; this.onend?.({}); }, 10); }
      abort() { this.aborted = true; if (window.__sr.active === this) window.__sr.active = null; }
    }
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
    const results = (text, isFinal) => [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal })];
    window.__sr.say = (text, isFinal = false) => window.__sr.active?.onresult?.({ resultIndex: 0, results: results(text, isFinal) });
    window.__sr.end = () => { const a = window.__sr.active; window.__sr.active = null; a?.onend?.({}); };
    window.__sr.fail = error => { const a = window.__sr.active; window.__sr.active = null; a?.onerror?.({ error }); a?.onend?.({}); };
  } else {
    try { delete window.SpeechRecognition; } catch {}
    try { delete window.webkitSpeechRecognition; } catch {}
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  }

  const spoken = [];
  window.__tts = { spoken };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.volume = 1; this.voice = null; } };
  const voices = [
    { lang: 'en-US', name: 'Samantha', default: true, localService: true },
    { lang: 'ms-MY', name: 'Amira', default: false, localService: true },
    { lang: 'zh-CN', name: 'Tingting', default: false, localService: true },
  ];
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speaking: false, pending: false, paused: false,
      getVoices: () => voices,
      speak(u) { spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? null, rate: u.rate, volume: u.volume }); setTimeout(() => u.onend?.({}), 20); },
      cancel() {}, pause() {}, resume() {},
      addEventListener() {}, removeEventListener() {},
    },
  });

  window.__clip = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; }, readText: async () => window.__clipIn ?? '' } });
  window.__shared = null;
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__shared = data; } });
}

/**
 * @param {import('playwright').BrowserType} browserType
 * @param {{ benign?: RegExp[], launchOptions?: object }} [o]  benign: console messages that are not the app's fault
 */
export function createHarness(browserType, { benign = [], launchOptions = {} } = {}) {
  let browser, server, base;
  // the fake services. mm/google/ms.hits: what reached them; .reply(...) may be replaced by a test: return { status, body, delay }
  const api = {};
  const reset = () => {
    api.offline = false;
    api.mm = { hits: [], reply: ({ q, to }) => ({ body: { responseStatus: 200, responseData: { translatedText: fakeTranslate(q, to) } } }) };
    api.google = { hits: [], reply: ({ q, target }) => ({ body: { data: { translations: q.map(x => ({ translatedText: fakeTranslate(x, target) })) } } }) };
    api.ms = { hits: [], reply: ({ texts, to }) => ({ body: texts.map(x => ({ translations: [{ text: fakeTranslate(x, to), to }] })) }) };
  };
  reset();

  async function start() {
    await buildSite({ quiet: true });
    server = createApp();
    base = `http://127.0.0.1:${await listen(server, 0)}/`;
    browser = await browserType.launch(launchOptions);
  }
  async function stop() { await browser?.close(); server?.close(); }

  async function answer(route, r) {
    if (r.delay) await new Promise(res => setTimeout(res, r.delay));
    await route.fulfill({ status: r.status ?? 200, headers: { ...CORS, 'content-type': 'application/json' }, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}) }).catch(() => {});
  }

  async function mockServices(ctx, unexpected) {
    await ctx.route(url => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(url.href), async route => {
      const req = route.request();
      const u = new URL(req.url());
      if (api.offline) return route.abort('internetdisconnected'); // (Playwright's routes still answer in an offline context)
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (u.host === 'api.mymemory.translated.net' && u.pathname === '/get') {
        const [from, to] = (u.searchParams.get('langpair') || '|').split('|');
        const hit = { q: u.searchParams.get('q'), from, to, de: u.searchParams.get('de') };
        api.mm.hits.push(hit);
        return answer(route, await api.mm.reply(hit));
      }
      if (u.host === 'translation.googleapis.com') {
        const body = JSON.parse(req.postData() || '{}');
        const hit = { key: u.searchParams.get('key'), ...body };
        api.google.hits.push(hit);
        return answer(route, await api.google.reply(hit));
      }
      if (u.host === 'api.cognitive.microsofttranslator.com') {
        const headers = req.headers();
        const hit = { to: u.searchParams.get('to'), from: u.searchParams.get('from'), key: headers['ocp-apim-subscription-key'], region: headers['ocp-apim-subscription-region'] ?? null, texts: JSON.parse(req.postData() || '[]').map(x => x.Text) };
        api.ms.hits.push(hit);
        return answer(route, await api.ms.reply(hit));
      }
      unexpected.push(req.url());
      return route.abort();
    });
  }

  /**
   * Opens the app in a fresh context and runs `fn(page, ctx)`.
   * storage: settings to start with (keys of src/js/core/store.js DEFAULTS, or 'history')
   * sr: whether the browser "has" speech recognition
   */
  async function withApp({ device = PHONE, hash = '#/translate', storage = {}, sr = true, serviceWorkers = 'block', colorScheme = 'light', locale = 'ms-MY', allowErrors = [] } = {}, fn) {
    reset();
    const ctx = await browser.newContext({ ...device, locale, colorScheme, serviceWorkers });
    const unexpected = [], problems = [];
    await mockServices(ctx, unexpected);
    await ctx.addInitScript(pageFakes, { sr });
    await ctx.addInitScript(entries => {
      if (sessionStorage.getItem('seeded')) return;
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(`tl.${k}`, JSON.stringify(v));
      sessionStorage.setItem('seeded', '1');
    }, storage);
    const page = await ctx.newPage();
    const ignore = [...BENIGN, ...benign, ...allowErrors];
    page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !ignore.some(re => re.test(m.text()))) problems.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', e => problems.push(`[pageerror] ${e.message}`));
    try {
      await page.goto(base + hash, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__tl?.views?.translate, null, { timeout: 30_000 });
      const result = await fn(page, ctx);
      assert.deepEqual(unexpected, [], 'requests to hosts that are not mocked');
      assert.deepEqual(problems, [], 'console problems');
      return result;
    } finally {
      await ctx.close();
    }
  }

  // ---- helpers that read the app's real state
  const debug = (page, view = 'translate') => page.evaluate(v => window.__tl.views[v].debug, view);
  const waitStatus = (page, status, timeout = 10_000) => page.waitForFunction(s => window.__tl.views.translate.debug.status === s, status, { timeout });
  const typeText = async (page, text) => { await page.locator('.src-input').fill(text); };
  const outText = page => page.locator('.view-translate .out-text').innerText();
  const historyList = page => page.evaluate(() => window.__tl.history.list());
  const spoken = page => page.evaluate(() => window.__tts.spoken.filter(s => s.text.trim()));
  const say = (page, text, final = false) => page.evaluate(([t, f]) => window.__sr.say(t, f), [text, final]);
  const pickLang = async (page, opener, id) => {
    await page.locator(opener).click();
    await page.locator('.sheet .lang-row').first().waitFor();
    await page.locator(`.sheet .lang-row[data-lang="${id}"]`).first().click();
    await page.locator('.sheet-backdrop').waitFor({ state: 'detached' });
  };

  /** Takes the page off the network (and the fake services with it), or back on. */
  const setOffline = async (ctx, off) => { api.offline = off; await ctx.setOffline(off); };

  return { api, start, stop, withApp, setOffline, debug, waitStatus, typeText, outText, historyList, spoken, say, pickLang, get base() { return base; } };
}
