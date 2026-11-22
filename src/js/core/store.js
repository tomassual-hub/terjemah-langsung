// Settings and history, kept in localStorage on this device only (values are JSON under the "tl." prefix; theme-boot.js reads
// "tl.theme" before first paint). API keys stay here too: they are sent only to the service they belong to.

const PREFIX = 'tl.';
const HISTORY_KEY = 'history';
export const HISTORY_MAX = 300;

export const DEFAULTS = Object.freeze({
  uiLang: 'auto', // 'auto' | 'ms' | 'en'
  theme: 'auto', // 'auto' | 'light' | 'dark'
  provider: 'mymemory', // 'mymemory' | 'google' | 'microsoft'
  googleKey: '',
  msKey: '',
  msRegion: '',
  mmEmail: '', // optional: MyMemory gives 50 000 instead of 5 000 characters a day to a request that carries an e-mail
  from: 'en',
  to: 'ms',
  convA: 'ms', // conversation: the person holding the phone
  convB: 'en', // conversation: the person across the table
  faceToFace: true, // conversation: the other person's half is upside down, for sitting opposite each other
  autoSpeak: true, // conversation: read every translation aloud
  speechRate: 1,
  noiseMode: false, // Noisy place mode: press & hold to talk, music-like and unsure results dropped (ui/mic-control.js, speech/speech-filter.js)
  interpFrom: 'en', // Interpreter: the speakers' language, or 'auto' (Azure AI Speech detects it among interpLangs)
  interpTo: 'ms', // Interpreter: the listener's language
  interpLangs: ['ms', 'en', 'zh'], // Interpreter, Detect automatically: the languages the speakers may use (max 10)
  interpSpeak: false, // Interpreter: read each translation aloud (the microphone pauses meanwhile)
  speechKey: '', // Azure AI Speech key (Interpreter, Detect automatically)
  speechRegion: '',
  saveHistory: true,
  recent: [], // the last languages picked, newest first
});

function read(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch { return undefined; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

const listeners = new Set();

export const settings = {
  get(key) {
    const v = read(key);
    const d = DEFAULTS[key];
    if (v === undefined || (d != null && typeof v !== typeof d) || (Array.isArray(d) && !Array.isArray(v))) return Array.isArray(d) ? [...d] : d;
    return v;
  },
  set(key, value) {
    write(key, value);
    for (const fn of listeners) fn(key, value);
  },
  all() { return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, this.get(k)])); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Puts a language at the front of the "recent" list (max 6). */
  touchRecent(id) {
    if (!id || id === 'auto') return;
    this.set('recent', [id, ...this.get('recent').filter(x => x !== id)].slice(0, 6));
  },
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const valid = e => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.src === 'string' && typeof e.out === 'string';

export const history = {
  list() { const v = read(HISTORY_KEY); return Array.isArray(v) ? v.filter(valid) : []; },
  save(list) { write(HISTORY_KEY, list.slice(0, HISTORY_MAX)); for (const fn of listeners) fn(HISTORY_KEY, null); },
  /**
   * Adds an entry, or updates it in place when `id` names one that exists (a sentence that is still growing as you type or speak
   * stays one entry). Favourites are never pushed out by the cap. Returns the id.
   */
  put({ id, from, to, src, out, mode = 'text', provider }) {
    const list = this.list();
    const at = Date.now();
    const i = id ? list.findIndex(e => e.id === id) : -1;
    if (i >= 0) {
      const e = { ...list[i], from, to, src, out, at, provider };
      list.splice(i, 1);
      list.unshift(e);
      this.save(trim(list));
      return e.id;
    }
    const e = { id: uid(), from, to, src, out, mode, provider, at, fav: false };
    list.unshift(e);
    this.save(trim(list));
    return e.id;
  },
  toggleFav(id) {
    const list = this.list();
    const e = list.find(x => x.id === id);
    if (!e) return false;
    e.fav = !e.fav;
    this.save(list);
    return e.fav;
  },
  remove(id) { this.save(this.list().filter(e => e.id !== id)); },
  clear({ keepFavourites = true } = {}) { this.save(keepFavourites ? this.list().filter(e => e.fav) : []); },
  get(id) { return this.list().find(e => e.id === id) ?? null; },
};

/** Over the cap, the oldest entries that are not favourites go first. */
function trim(list) {
  if (list.length <= HISTORY_MAX) return list;
  const out = [...list];
  for (let i = out.length - 1; i >= 0 && out.length > HISTORY_MAX; i--) if (!out[i].fav) out.splice(i, 1);
  return out;
}

/** Everything this app keeps on the device (settings, keys, history) is deleted. */
export function wipeAll() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {}
  for (const fn of listeners) fn('*', null);
}
