import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// a localStorage for Node
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const { DEFAULTS, HISTORY_MAX, history, settings, wipeAll } = await import('../../src/js/core/store.js');

beforeEach(() => mem.clear());

test('settings: defaults, stored values, wrong types fall back to the default', () => {
  assert.equal(settings.get('provider'), 'mymemory');
  settings.set('provider', 'google');
  assert.equal(settings.get('provider'), 'google');
  assert.equal(mem.get('tl.provider'), '"google"');
  mem.set('tl.speechRate', '"fast"');
  assert.equal(settings.get('speechRate'), DEFAULTS.speechRate);
  mem.set('tl.recent', '{"a":1}');
  assert.deepEqual(settings.get('recent'), []);
  mem.set('tl.theme', 'not json');
  assert.equal(settings.get('theme'), 'auto');
});

test('settings.touchRecent: newest first, no duplicates, at most 6, never "auto"', () => {
  for (const id of ['ms', 'en', 'zh', 'ms', 'ta', 'th', 'vi', 'ja', 'auto']) settings.touchRecent(id);
  assert.deepEqual(settings.get('recent'), ['ja', 'vi', 'th', 'ta', 'ms', 'zh']);
});

test('history: put adds, put with an id updates in place and moves it to the top', () => {
  const a = history.put({ from: 'en', to: 'ms', src: 'Hello', out: 'Helo' });
  const b = history.put({ from: 'en', to: 'ms', src: 'Bye', out: 'Selamat tinggal' });
  assert.deepEqual(history.list().map(e => e.id), [b, a]);
  const a2 = history.put({ id: a, from: 'en', to: 'ms', src: 'Hello there', out: 'Helo di sana' });
  assert.equal(a2, a);
  assert.deepEqual(history.list().map(e => e.src), ['Hello there', 'Bye']);
});

test('history: favourites survive the cap and "clear"; broken entries are ignored', () => {
  const fav = history.put({ from: 'en', to: 'ms', src: 'keep', out: 'simpan' });
  history.toggleFav(fav);
  for (let i = 0; i < HISTORY_MAX + 20; i++) history.put({ from: 'en', to: 'ms', src: `n${i}`, out: `o${i}` });
  const list = history.list();
  assert.equal(list.length, HISTORY_MAX);
  assert.ok(list.some(e => e.id === fav), 'the oldest entry stays because it is a favourite');
  history.clear();
  assert.deepEqual(history.list().map(e => e.id), [fav]);
  mem.set('tl.history', JSON.stringify([{ id: 1 }, null, { id: 'x', src: 'a', out: 'b' }]));
  assert.equal(history.list().length, 1);
});

test('wipeAll: removes only this app\'s keys', () => {
  settings.set('googleKey', 'secret');
  history.put({ from: 'en', to: 'ms', src: 'a', out: 'b' });
  mem.set('other.app', '1');
  wipeAll();
  assert.deepEqual([...mem.keys()], ['other.app']);
  assert.equal(settings.get('googleKey'), '');
});
