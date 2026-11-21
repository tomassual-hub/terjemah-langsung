import { test } from 'node:test';
import assert from 'node:assert/strict';
import { google, microsoft, mymemory, TranslateError } from '../../src/js/translate/providers.js';
import { fromServiceCode } from '../../src/js/core/languages.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch that records requests and answers with `reply(url, init)`. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init = {}) => { calls.push({ url: String(url), init }); return reply(new URL(url), init); };
  fn.calls = calls;
  return fn;
}

const codeOf = p => p.catch(e => { assert.ok(e instanceof TranslateError, `TranslateError, got ${e}`); return e.code; });

test('MyMemory: one GET per text with langpair, autodetect, the optional e-mail; entities decoded; detected language mapped', async () => {
  const f = fakeFetch(u => json({ responseStatus: 200, responseData: { translatedText: `T(${u.searchParams.get('q')}) I&#39;m`, detectedLanguage: u.searchParams.get('langpair').startsWith('autodetect') ? 'zh-CN' : undefined } }));
  const r = await mymemory.translate(['Hello.', 'Bye.'], 'en', 'ms', { fetch: f, settings: { mmEmail: 'a@b.co' } });
  assert.deepEqual(r.texts, ["T(Hello.) I'm", "T(Bye.) I'm"]);
  assert.equal(f.calls.length, 2);
  const u = new URL(f.calls[0].url);
  assert.equal(u.host, 'api.mymemory.translated.net');
  assert.equal(u.searchParams.get('langpair'), 'en|ms');
  assert.equal(u.searchParams.get('de'), 'a@b.co');
  const auto = await mymemory.translate(['你好'], 'auto', 'zh-TW', { fetch: f, settings: { mmEmail: 'not an email' } });
  const u2 = new URL(f.calls[2].url);
  assert.equal(u2.searchParams.get('langpair'), 'autodetect|zh-TW');
  assert.equal(u2.searchParams.get('de'), null, 'an invalid e-mail is not sent');
  assert.equal(auto.detected, 'zh');
});

test('MyMemory: quota (flag, status, warning text), bad language, server errors, HTTP errors', async () => {
  const run = body => codeOf(mymemory.translate(['x'], 'en', 'ms', { fetch: fakeFetch(() => (body instanceof Response ? body : json(body))) }));
  assert.equal(await run({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'x' } }), 'quota');
  assert.equal(await run({ responseStatus: 429, responseData: { translatedText: '' } }), 'quota');
  assert.equal(await run({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.' } }), 'quota');
  assert.equal(await run({ responseStatus: 403, responseDetails: "'XX' IS AN INVALID TARGET LANGUAGE", responseData: { translatedText: '' } }), 'lang');
  assert.equal(await run({ responseStatus: '500', responseData: { translatedText: '' } }), 'server');
  assert.equal(await run(new Response('oops', { status: 503 })), 'server');
  assert.equal(await run(json({}, 429)), 'quota');
});

test('network failure, offline, timeout and abort become distinct codes', async () => {
  const broken = fakeFetch(() => { throw new TypeError('Load failed'); });
  assert.equal(await codeOf(mymemory.translate(['x'], 'en', 'ms', { fetch: broken })), 'network');

  const hang = (url, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  const err = await mymemory.translate(['x'], 'en', 'ms', { fetch: hang, timeout: 80 }).catch(e => e);
  assert.equal(err.code, 'network');
  assert.equal(err.detail, 'timeout');
  assert.ok(Date.now() - t0 < 2000);

  const ctrl = new AbortController();
  const p = mymemory.translate(['x'], 'en', 'ms', { fetch: hang, signal: ctrl.signal });
  ctrl.abort();
  assert.equal(await codeOf(p), 'aborted');

  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { assert.equal(await codeOf(mymemory.translate(['x'], 'en', 'ms', { fetch: broken })), 'offline'); } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
});

test('Google: POST with the key, format text, no source when detecting; codes mapped; errors by message', async () => {
  const f = fakeFetch((u, init) => {
    const b = JSON.parse(init.body);
    return json({ data: { translations: b.q.map(q => ({ translatedText: `G:${q} &amp;`, ...(b.source ? {} : { detectedSourceLanguage: 'fil' }) })) } });
  });
  assert.equal(await codeOf(google.translate(['a'], 'en', 'ms', { fetch: f, settings: {} })), 'nokey');
  const r = await google.translate(['one', 'two'], 'zh-TW', 'tl', { fetch: f, settings: { googleKey: ' AIzaKEY ' } });
  assert.deepEqual(r.texts, ['G:one &', 'G:two &']);
  const call = f.calls[0];
  assert.match(call.url, /^https:\/\/translation\.googleapis\.com\/language\/translate\/v2\?key=AIzaKEY$/);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { q: ['one', 'two'], target: 'tl', format: 'text', source: 'zh-TW' });
  const auto = await google.translate(['x'], 'auto', 'ms', { fetch: f, settings: { googleKey: 'k' } });
  assert.equal(JSON.parse(f.calls[1].init.body).source, undefined);
  assert.equal(auto.detected, 'tl');

  const fail = (status, message) => codeOf(google.translate(['x'], 'en', 'ms', { fetch: fakeFetch(() => json({ error: { code: status, message } }, status)), settings: { googleKey: 'k' } }));
  assert.equal(await fail(400, 'API key not valid. Please pass a valid API key.'), 'auth');
  assert.equal(await fail(403, 'Cloud Translation API has not been used in project 1 before or it is disabled.'), 'auth');
  assert.equal(await fail(403, 'Quota exceeded for quota metric'), 'quota');
  assert.equal(await fail(400, 'Bad language pair: en|xx'), 'lang');
  assert.equal(await fail(500, 'Internal error'), 'server');
});

test('Google: many texts go in batches, answers stay in order', async () => {
  const f = fakeFetch((u, init) => json({ data: { translations: JSON.parse(init.body).q.map(q => ({ translatedText: q.toUpperCase() })) } }));
  const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
  const r = await google.translate(texts, 'en', 'ms', { fetch: f, settings: { googleKey: 'k' } });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(r.texts, texts.map(t => t.toUpperCase()));
});

test('Microsoft: key and region headers, its own language codes, error codes', async () => {
  const f = fakeFetch((u, init) => json(JSON.parse(init.body).map(x => ({ detectedLanguage: { language: 'zh-Hans', score: 1 }, translations: [{ text: `M:${x.Text}`, to: 'ms' }] }))));
  assert.equal(await codeOf(microsoft.translate(['a'], 'en', 'ms', { fetch: f, settings: {} })), 'nokey');
  const r = await microsoft.translate(['hi'], 'auto', 'zh', { fetch: f, settings: { msKey: 'KEY', msRegion: 'southeastasia' } });
  assert.deepEqual(r.texts, ['M:hi']);
  assert.equal(r.detected, 'zh');
  const { url, init } = f.calls[0];
  const u = new URL(url);
  assert.equal(u.host, 'api.cognitive.microsofttranslator.com');
  assert.equal(u.searchParams.get('to'), 'zh-Hans');
  assert.equal(u.searchParams.get('from'), null);
  assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'KEY');
  assert.equal(init.headers['Ocp-Apim-Subscription-Region'], 'southeastasia');
  await microsoft.translate(['hi'], 'tl', 'ms', { fetch: f, settings: { msKey: 'KEY' } });
  assert.equal(new URL(f.calls[1].url).searchParams.get('from'), 'fil');
  assert.equal(f.calls[1].init.headers['Ocp-Apim-Subscription-Region'], undefined, 'no region header for a global resource');

  const fail = (status, code, message) => codeOf(microsoft.translate(['x'], 'en', 'ms', { fetch: fakeFetch(() => json({ error: { code, message } }, status)), settings: { msKey: 'k' } }));
  assert.equal(await fail(401, 401000, 'The request is not authorized because credentials are missing or invalid.'), 'auth');
  assert.equal(await fail(403, 403001, 'The operation is not allowed because the subscription has exceeded its free quota.'), 'quota');
  assert.equal(await fail(400, 400036, 'The target language is not valid.'), 'lang');
  assert.equal(await fail(429, 429001, 'Too many requests'), 'quota');
});

test('fromServiceCode: every service\'s spelling maps back to our ids', () => {
  assert.equal(fromServiceCode('zh-Hans', 'az'), 'zh');
  assert.equal(fromServiceCode('zh-Hant', 'az'), 'zh-TW');
  assert.equal(fromServiceCode('zh-CN', 'g'), 'zh');
  assert.equal(fromServiceCode('zh-HK', 'mm'), 'zh-TW');
  assert.equal(fromServiceCode('fil', 'az'), 'tl');
  assert.equal(fromServiceCode('tl', 'g'), 'tl');
  assert.equal(fromServiceCode('ms-MY', 'mm'), 'ms');
  assert.equal(fromServiceCode('en-GB', 'mm'), 'en');
  assert.equal(fromServiceCode('xx', 'mm'), null);
  assert.equal(fromServiceCode('', 'mm'), null);
});
