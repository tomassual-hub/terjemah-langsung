// The translation services. Each takes a list of texts and returns their translations in the same order:
//   translate(texts, from, to, { signal, settings, fetch }) -> { texts: string[], detected: string|null }
// `from` may be 'auto'. Errors are TranslateError with a code the interface turns into a message:
//   offline, network, quota, auth, lang, server, aborted, nokey
import { fromServiceCode, lang } from '../core/languages.js';
import { decodeEntities } from './text.js';

export class TranslateError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TranslateError';
    this.code = code;
    this.detail = detail;
  }
}

const isAbort = err => err?.name === 'AbortError';
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export const REQUEST_TIMEOUT_MS = 15_000;

/** fetch + JSON, with a time limit: a request that hangs (a weak mobile signal) must not leave "Translating…" up for ever. */
async function request(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const outer = init.signal;
  const relay = () => ctrl.abort();
  if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener('abort', relay, { once: true }); }
  const fail = err => {
    if (timedOut) return new TranslateError(online() ? 'network' : 'offline', 'timeout');
    if (isAbort(err)) return new TranslateError('aborted');
    return new TranslateError(online() ? 'network' : 'offline', err?.message);
  };
  try {
    let res;
    try { res = await fetchImpl(url, { ...init, signal: ctrl.signal }); } catch (err) { throw fail(err); }
    let body = null;
    try { body = await res.json(); } catch (err) { if (timedOut || isAbort(err)) throw fail(err); }
    return { res, body };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', relay);
  }
}

const httpError = (status, message) => {
  if (status === 401 || status === 403) return new TranslateError('auth', message);
  if (status === 429) return new TranslateError('quota', message);
  if (status === 400) return new TranslateError('lang', message);
  return new TranslateError('server', `${status} ${message || ''}`.trim());
};

/** Runs `fn` over `items` with at most `limit` running at once; results keep the order of `items`. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const code = (id, service) => lang(id)?.[service] ?? id;

/** MyMemory: free, no key, CORS open; one text per request, 500 bytes at most; 5 000 characters a day (50 000 with an e-mail). */
export const mymemory = {
  id: 'mymemory',
  name: 'MyMemory',
  unit: 'sentence',
  maxBytes: 450,
  needsKey: false,
  async translate(texts, from, to, { signal, settings = {}, fetch: fetchImpl = fetch, timeout = REQUEST_TIMEOUT_MS } = {}) {
    let detected = null;
    const results = await pool(texts, 4, async q => {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', q);
      url.searchParams.set('langpair', `${from === 'auto' ? 'autodetect' : code(from, 'mm')}|${code(to, 'mm')}`);
      if (settings.mmEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.mmEmail)) url.searchParams.set('de', settings.mmEmail);
      const { res, body } = await request(fetchImpl, url.href, { signal }, timeout);
      if (!res.ok) throw httpError(res.status, body?.responseDetails);
      if (!body || typeof body !== 'object') throw new TranslateError('server', 'bad response');
      const status = Number(body.responseStatus);
      const text = decodeEntities(String(body.responseData?.translatedText ?? ''));
      if (body.quotaFinished === true || status === 429 || /^MYMEMORY WARNING/i.test(text)) throw new TranslateError('quota', body.responseDetails || text);
      if (status === 403 || /INVALID (?:TARGET |SOURCE )?LANGUAGE|IS AN INVALID/i.test(body.responseDetails || '')) throw new TranslateError('lang', body.responseDetails);
      if (status !== 200) throw new TranslateError('server', `${status} ${body.responseDetails || ''}`.trim());
      if (!detected && body.responseData?.detectedLanguage) detected = fromServiceCode(body.responseData.detectedLanguage, 'mm');
      return text;
    });
    return { texts: results, detected };
  },
};

/** Batches of at most `max` texts and about `chars` characters (the services' own limits are 128 / 1000 texts). */
function batches(texts, max = 100, chars = 20_000) {
  const out = [];
  let cur = [], n = 0;
  for (const t of texts) {
    if (cur.length && (cur.length >= max || n + t.length > chars)) { out.push(cur); cur = []; n = 0; }
    cur.push(t); n += t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Google Cloud Translation (Basic, v2) with the user's own API key. */
export const google = {
  id: 'google',
  name: 'Google Cloud',
  unit: 'line',
  maxBytes: 4500,
  needsKey: true,
  async translate(texts, from, to, { signal, settings = {}, fetch: fetchImpl = fetch, timeout = REQUEST_TIMEOUT_MS } = {}) {
    const key = (settings.googleKey || '').trim();
    if (!key) throw new TranslateError('nokey');
    let detected = null;
    const out = [];
    for (const batch of batches(texts)) {
      const payload = { q: batch, target: code(to, 'g'), format: 'text' };
      if (from !== 'auto') payload.source = code(from, 'g');
      const { res, body } = await request(fetchImpl, `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }, timeout);
      if (!res.ok) {
        const msg = body?.error?.message || '';
        if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) throw new TranslateError('auth', msg);
        if (res.status === 403 && /quota|limit/i.test(msg) && !/denied|not been used|disabled|blocked/i.test(msg)) throw new TranslateError('quota', msg);
        throw httpError(res.status, msg);
      }
      const list = body?.data?.translations;
      if (!Array.isArray(list) || list.length !== batch.length) throw new TranslateError('server', 'bad response');
      for (const t of list) {
        out.push(decodeEntities(String(t.translatedText ?? '')));
        if (!detected && t.detectedSourceLanguage) detected = fromServiceCode(t.detectedSourceLanguage, 'g');
      }
    }
    return { texts: out, detected };
  },
};

/** Microsoft Translator (Azure AI Translator) with the user's own key; the region is needed for regional resources. */
export const microsoft = {
  id: 'microsoft',
  name: 'Microsoft Translator',
  unit: 'line',
  maxBytes: 4500,
  needsKey: true,
  async translate(texts, from, to, { signal, settings = {}, fetch: fetchImpl = fetch, timeout = REQUEST_TIMEOUT_MS } = {}) {
    const key = (settings.msKey || '').trim();
    if (!key) throw new TranslateError('nokey');
    let detected = null;
    const out = [];
    for (const batch of batches(texts)) {
      const url = new URL('https://api.cognitive.microsofttranslator.com/translate');
      url.searchParams.set('api-version', '3.0');
      url.searchParams.set('to', code(to, 'az'));
      if (from !== 'auto') url.searchParams.set('from', code(from, 'az'));
      const headers = { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
      if ((settings.msRegion || '').trim()) headers['Ocp-Apim-Subscription-Region'] = settings.msRegion.trim();
      const { res, body } = await request(fetchImpl, url.href, { method: 'POST', signal, headers, body: JSON.stringify(batch.map(Text => ({ Text }))) }, timeout);
      if (!res.ok) {
        const msg = body?.error?.message || '';
        const c = Number(body?.error?.code) || 0; // e.g. 400036 "The target language is not valid", 403001 "free tier quota used up"
        if (c >= 400000 && c < 400100 && /language/i.test(msg)) throw new TranslateError('lang', msg);
        if (c === 403001 || res.status === 429) throw new TranslateError('quota', msg);
        throw httpError(res.status, msg);
      }
      if (!Array.isArray(body) || body.length !== batch.length) throw new TranslateError('server', 'bad response');
      for (const item of body) {
        out.push(String(item?.translations?.[0]?.text ?? ''));
        if (!detected && item?.detectedLanguage?.language) detected = fromServiceCode(item.detectedLanguage.language, 'az');
      }
    }
    return { texts: out, detected };
  },
};

export const PROVIDERS = { mymemory, google, microsoft };
export const provider = id => PROVIDERS[id] ?? mymemory;
