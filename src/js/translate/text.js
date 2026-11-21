// Text helpers of the translation engine: pure functions, unit-tested in Node (tests/unit/text.test.mjs).

const encoder = new TextEncoder();
export const utf8Length = s => encoder.encode(s).length;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Turns the HTML entities some services put in plain text (MyMemory: "I&#39;m", "&quot;") back into characters, without ever
 * parsing markup. Unknown entities stay as they are.
 */
export function decodeEntities(s) {
  if (typeof s !== 'string' || !s.includes('&')) return s ?? '';
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
    }
    return NAMED[k] ?? all;
  });
}

const segmenters = new Map();
function segmenter(locale) {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
  if (!segmenters.has(locale)) {
    try { segmenters.set(locale, new Intl.Segmenter(locale, { granularity: 'sentence' })); } catch { segmenters.set(locale, null); }
  }
  return segmenters.get(locale);
}

/** A line split into sentences; each keeps its trailing spaces, so joining them gives the line back exactly. */
export function splitSentences(line, locale = 'en') {
  if (!line) return [];
  const seg = segmenter(locale === 'auto' ? 'en' : locale);
  if (seg) return Array.from(seg.segment(line), s => s.segment);
  return line.match(/[^.!?。！？]+(?:[.!?。！？]+|$)\s*|[.!?。！？]+\s*/g) ?? [line];
}

/** Cuts a piece that is longer than `maxBytes` (UTF-8) at spaces, or between characters when there are none (Chinese, Thai). */
export function splitLong(piece, maxBytes) {
  if (utf8Length(piece) <= maxBytes) return [piece];
  const out = [];
  let cur = '';
  const words = piece.match(/\S+\s*|\s+/g) ?? [piece];
  for (const w of words) {
    if (utf8Length(cur + w) <= maxBytes) { cur += w; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (utf8Length(w) <= maxBytes) { cur = w; continue; }
    for (const ch of w) { // a single "word" over the limit: by code points
      if (utf8Length(cur + ch) > maxBytes) { out.push(cur); cur = ''; }
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The text as a list of parts: { core, pre, post } to translate (the words, with the spaces around them kept apart so that
 * they survive the round trip) and plain '\n' strings between lines.
 * unit 'sentence': one part per sentence (MyMemory: its memory is sentence-based and a request takes 500 bytes at most).
 * unit 'line': one part per line (Google, Microsoft: more context, and one request takes the whole list).
 * Either way, a part that changes does not change the others: as you type at the end, only the last sentence is sent again.
 */
export function segmentText(text, { unit = 'sentence', maxBytes = 450, locale = 'en' } = {}) {
  const parts = [];
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (i > 0) parts.push('\n');
    const pieces = unit === 'sentence' ? splitSentences(line, locale) : [line];
    for (const p of pieces.flatMap(x => splitLong(x, maxBytes))) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p);
      if (!m[2]) { if (p) parts.push({ core: '', pre: p, post: '' }); continue; }
      parts.push({ core: m[2], pre: m[1], post: m[3] });
    }
  });
  return parts;
}

/** Puts translated parts back together. For languages written without spaces, the spaces between sentences are dropped. */
export function joinParts(parts, translations, { noSpace = false } = {}) {
  let out = '';
  for (const p of parts) {
    if (typeof p === 'string') { out += p; continue; }
    if (!p.core) { out += noSpace ? '' : p.pre; continue; }
    const t = translations.get(p.core) ?? '';
    const pre = noSpace && /^ +$/.test(p.pre) ? '' : p.pre;
    const post = noSpace && /^ +$/.test(p.post) ? '' : p.post;
    out += pre + t + post;
  }
  return out;
}
