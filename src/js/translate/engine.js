// The translation engine: splits text into parts, asks the service only for the parts it has not translated yet, and keeps
// the answers (a part that is already in flight is not asked for twice). createLive() is the "as you type / as you speak"
// layer on top: it waits for a short pause, and an answer that arrives after newer text has been asked for is dropped.
import { lang } from '../core/languages.js';
import { provider as providerOf, TranslateError } from './providers.js';
import { joinParts, segmentText } from './text.js';

const CACHE_MAX = 600;

export function createEngine({ fetch: fetchImpl = (...a) => fetch(...a), getSettings = () => ({}) } = {}) {
  const cache = new Map(); // key -> { text, detected }
  const inflight = new Map(); // key -> Promise
  const stats = { requests: 0, parts: 0, hits: 0 };

  const keyOf = (pid, from, to, core) => `${pid}\u0001${from}\u0001${to}\u0001${core}`;
  const remember = (k, v) => {
    cache.delete(k);
    cache.set(k, v);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  };

  /**
   * Translates `text` from `from` ('auto' allowed) to `to`.
   * @returns {Promise<{ text: string, detected: string|null, provider: string }>}
   */
  async function translate(text, from, to, { signal } = {}) {
    const settings = getSettings();
    const p = providerOf(settings.provider);
    const src = String(text ?? '');
    if (!src.trim()) return { text: '', detected: null, provider: p.id };
    if (from === to) return { text: src, detected: from, provider: p.id };

    const parts = segmentText(src, { unit: p.unit, maxBytes: p.maxBytes, locale: from === 'auto' ? 'en' : lang(from)?.speech ?? 'en' });
    const cores = [...new Set(parts.filter(x => typeof x === 'object' && x.core).map(x => x.core))];
    const result = new Map();
    let detected = null;
    const missing = [];
    const waiting = [];
    for (const core of cores) {
      const k = keyOf(p.id, from, to, core);
      const hit = cache.get(k);
      if (hit) { stats.hits++; result.set(core, hit.text); detected ??= hit.detected; remember(k, hit); continue; }
      const pending = inflight.get(k);
      if (pending) waiting.push(pending.then(v => { result.set(core, v.text); detected ??= v.detected; }));
      else missing.push(core);
    }

    if (missing.length) {
      stats.requests++;
      stats.parts += missing.length;
      // the request itself is not tied to the caller's signal: if newer text supersedes this one, its parts are still worth having
      // (as you keep typing, the earlier sentences are done once and for all). Only the caller stops waiting.
      const job = p.translate(missing, from, to, { settings, fetch: fetchImpl });
      missing.forEach((core, i) => {
        const k = keyOf(p.id, from, to, core);
        const one = job.then(r => {
          const v = { text: r.texts[i] ?? '', detected: r.detected };
          remember(k, v);
          return v;
        });
        one.catch(() => {}).finally(() => inflight.delete(k));
        inflight.set(k, one);
        waiting.push(one.then(v => { result.set(core, v.text); detected ??= v.detected; }));
      });
    }

    await abortable(Promise.all(waiting), signal);
    const noSpace = !!lang(to)?.noSpace;
    return { text: joinParts(parts, result, { noSpace }), detected: from === 'auto' ? detected : from, provider: p.id };
  }

  /** A translation that is already known, without asking the network (or null). */
  function cached(text, from, to) {
    const settings = getSettings();
    const p = providerOf(settings.provider);
    const src = String(text ?? '');
    if (!src.trim()) return { text: '', detected: null, provider: p.id };
    if (from === to) return { text: src, detected: from, provider: p.id };
    const parts = segmentText(src, { unit: p.unit, maxBytes: p.maxBytes, locale: from === 'auto' ? 'en' : lang(from)?.speech ?? 'en' });
    const result = new Map();
    let detected = null;
    for (const x of parts) {
      if (typeof x !== 'object' || !x.core) continue;
      const hit = cache.get(keyOf(p.id, from, to, x.core));
      if (!hit) return null;
      result.set(x.core, hit.text);
      detected ??= hit.detected;
    }
    return { text: joinParts(parts, result, { noSpace: !!lang(to)?.noSpace }), detected: from === 'auto' ? detected : from, provider: p.id };
  }

  return { translate, cached, stats, clear: () => cache.clear() };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new TranslateError('aborted'));
  return new Promise((ok, fail) => {
    const stop = () => fail(new TranslateError('aborted'));
    signal.addEventListener('abort', stop, { once: true });
    promise.then(v => { signal.removeEventListener('abort', stop); ok(v); }, e => { signal.removeEventListener('abort', stop); fail(e); });
  });
}

/**
 * "Live" translation: call update(text, from, to) on every keystroke or speech result; `onResult` gets the newest answer only.
 *   onState({ status: 'idle'|'pending'|'done'|'error', text, from, to, out?, detected?, error? })
 * A known translation is shown at once (no pause); otherwise it waits `delay` ms after the last change.
 */
export function createLive(engine, { delay = 350, onState = () => {} } = {}) {
  let timer = null, seq = 0, ctrl = null;
  let last = { text: '', from: '', to: '' };

  function run(my, text, from, to) {
    ctrl?.abort();
    ctrl = new AbortController();
    const signal = ctrl.signal;
    engine.translate(text, from, to, { signal }).then(
      r => { if (my === seq) onState({ status: 'done', text, from, to, out: r.text, detected: r.detected, provider: r.provider }); },
      error => { if (my === seq && error?.code !== 'aborted') onState({ status: 'error', text, from, to, error }); },
    );
  }

  function update(text, from, to, { immediate = false } = {}) {
    clearTimeout(timer);
    const my = ++seq;
    last = { text, from, to };
    if (!String(text).trim()) { ctrl?.abort(); onState({ status: 'idle', text, from, to, out: '' }); return; }
    const known = engine.cached(text, from, to);
    if (known) { onState({ status: 'done', text, from, to, out: known.text, detected: known.detected, provider: known.provider, cached: true }); return; }
    onState({ status: 'pending', text, from, to });
    if (immediate) run(my, text, from, to);
    else timer = setTimeout(() => run(my, text, from, to), delay);
  }

  return {
    update,
    /** Asks again for the last text (after a settings change, or the "try again" button). */
    retry: () => update(last.text, last.from, last.to, { immediate: true }),
    cancel() { clearTimeout(timer); seq++; ctrl?.abort(); },
    get last() { return last; },
  };
}
