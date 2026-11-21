// Text to speech with speechSynthesis. iOS only lets a page speak after a user gesture has spoken once, so unlock() is called
// from the first tap (a silent utterance); after that the conversation mode can read translations aloud by itself.
// iOS also routes audio to the quiet earpiece while the microphone is open, so callers stop listening before they speak.

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;
export const canSpeak = () => !!synth() && typeof window.SpeechSynthesisUtterance === 'function';

let voices = [];
let unlocked = false;
const waiters = new Set();

function loadVoices() {
  const s = synth();
  if (!s) return;
  voices = s.getVoices() || [];
  if (voices.length) for (const fn of waiters) fn();
}
if (synth()) {
  loadVoices();
  synth().addEventListener?.('voiceschanged', loadVoices);
}

/** The best voice for a BCP-47 tag: exact match, then the same language; the device's default voice of that language first. */
export function pickVoice(tag, list = voices) {
  if (!tag || !list?.length) return null;
  const want = tag.toLowerCase().replace('_', '-');
  const base = want.split('-')[0];
  const norm = v => String(v.lang || '').toLowerCase().replace('_', '-');
  const exact = list.filter(v => norm(v) === want);
  const same = exact.length ? exact : list.filter(v => norm(v).split('-')[0] === (base === 'fil' ? 'fil' : base) || (base === 'fil' && norm(v).startsWith('tl')));
  if (!same.length) return null;
  return same.find(v => v.default) || same.find(v => /enhanced|premium/i.test(v.name)) || same.find(v => v.localService) || same[0];
}

/** Whether the device has a voice for this language (null while the list has not loaded yet). */
export const hasVoice = tag => (voices.length ? !!pickVoice(tag) : null);

export function unlock() {
  const s = synth();
  if (!s || unlocked) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
  } catch {}
}

let currentId = 0;

/**
 * Speaks `text` in the language `tag`. Resolves when it ends (or is cancelled); `onBoundary` is not used, iOS rarely sends it.
 * @returns {Promise<'end'|'cancelled'|'error'|'unsupported'>}
 */
export function speak(text, tag, { rate = 1 } = {}) {
  const s = synth();
  if (!s || !canSpeak()) return Promise.resolve('unsupported');
  const id = ++currentId;
  s.cancel();
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = tag;
    const v = pickVoice(tag);
    if (v) u.voice = v;
    u.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
    let done = false;
    const end = r => { if (!done) { done = true; resolve(id === currentId ? r : 'cancelled'); } };
    u.onend = () => end('end');
    u.onerror = e => end(e?.error === 'interrupted' || e?.error === 'canceled' ? 'cancelled' : 'error');
    // Safari sometimes speaks nothing when speak() follows cancel() in the same task
    setTimeout(() => { try { s.speak(u); } catch { end('error'); } }, 30);
  });
}

export function stopSpeaking() {
  currentId++;
  try { synth()?.cancel(); } catch {}
}

export const speaking = () => !!synth()?.speaking;

/** Waits (at most `ms`) for the voice list, which some engines fill in later. */
export function voicesReady(ms = 1500) {
  if (voices.length || !synth()) return Promise.resolve();
  return new Promise(res => {
    const done = () => { waiters.delete(done); clearTimeout(t); res(); };
    const t = setTimeout(done, ms);
    waiters.add(done);
  });
}
