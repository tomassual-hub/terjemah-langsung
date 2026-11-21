import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createLive } from '../../src/js/translate/engine.js';

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A fake MyMemory: records each text asked for; `delay(q)` ms before answering. */
function fakeMyMemory({ delay = () => 0, fail = () => false } = {}) {
  const asked = [];
  const fetch = async url => {
    const q = new URL(url).searchParams.get('q');
    asked.push(q);
    await sleep(delay(q));
    if (fail(q)) return json({ responseStatus: 429, quotaFinished: true, responseData: { translatedText: '' } });
    return json({ responseStatus: 200, responseData: { translatedText: `<${q}>` } });
  };
  return { asked, fetch };
}

test('engine: as the text grows, only the new sentence is sent again', async () => {
  const mm = fakeMyMemory();
  const e = createEngine({ fetch: mm.fetch, getSettings: () => ({ provider: 'mymemory' }) });
  assert.equal((await e.translate('Hello there.', 'en', 'ms')).text, '<Hello there.>');
  assert.equal((await e.translate('Hello there. How are', 'en', 'ms')).text, '<Hello there.> <How are>');
  assert.equal((await e.translate('Hello there. How are you?', 'en', 'ms')).text, '<Hello there.> <How are you?>');
  assert.deepEqual(mm.asked, ['Hello there.', 'How are', 'How are you?']);
  assert.ok(e.cached('Hello there. How are you?', 'en', 'ms'));
  assert.equal(e.cached('Something new', 'en', 'ms'), null);
});

test('engine: the same part in flight is not asked for twice', async () => {
  const mm = fakeMyMemory({ delay: () => 40 });
  const e = createEngine({ fetch: mm.fetch, getSettings: () => ({ provider: 'mymemory' }) });
  const [a, b] = await Promise.all([e.translate('One. Two.', 'en', 'ms'), e.translate('One. Two. Three.', 'en', 'ms')]);
  assert.equal(a.text, '<One.> <Two.>');
  assert.equal(b.text, '<One.> <Two.> <Three.>');
  assert.deepEqual(mm.asked.sort(), ['One.', 'Three.', 'Two.']);
});

test('engine: same language on both sides, empty text, cache per service and language pair, errors propagate', async () => {
  const mm = fakeMyMemory({ fail: q => q === 'boom' });
  let provider = 'mymemory';
  const e = createEngine({ fetch: mm.fetch, getSettings: () => ({ provider, googleKey: '' }) });
  assert.equal((await e.translate('abc', 'en', 'en')).text, 'abc');
  assert.equal((await e.translate('   ', 'en', 'ms')).text, '');
  assert.equal(mm.asked.length, 0);
  await e.translate('Hi', 'en', 'ms');
  await e.translate('Hi', 'en', 'id');
  assert.equal(mm.asked.length, 2, 'another target language is another translation');
  provider = 'google';
  assert.equal(e.cached('Hi', 'en', 'ms'), null, 'another service does not reuse MyMemory answers');
  await assert.rejects(e.translate('Hi', 'en', 'ms'), { code: 'nokey' });
  provider = 'mymemory';
  await assert.rejects(e.translate('boom', 'en', 'ms'), { code: 'quota' });
  // a failure is not cached: once the service works again, the text goes through
  assert.equal(e.cached('boom', 'en', 'ms'), null);
});

test('engine: an abort stops waiting, but the parts already asked for still land in the cache', async () => {
  const mm = fakeMyMemory({ delay: () => 30 });
  const e = createEngine({ fetch: mm.fetch, getSettings: () => ({ provider: 'mymemory' }) });
  const ctrl = new AbortController();
  const p = e.translate('Keep me.', 'en', 'ms', { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, { code: 'aborted' });
  await sleep(60);
  assert.equal(e.cached('Keep me.', 'en', 'ms')?.text, '<Keep me.>');
});

test('createLive: waits for a pause, shows a known translation at once, drops answers for older text', async () => {
  const mm = fakeMyMemory({ delay: q => (q.startsWith('slow') ? 120 : 10) });
  const e = createEngine({ fetch: mm.fetch, getSettings: () => ({ provider: 'mymemory' }) });
  const states = [];
  const live = createLive(e, { delay: 40, onState: s => states.push({ status: s.status, text: s.text, out: s.out }) });

  live.update('H', 'en', 'ms');
  live.update('He', 'en', 'ms');
  live.update('Hel', 'en', 'ms');
  await sleep(100);
  assert.deepEqual(mm.asked, ['Hel'], 'only the text after the pause is sent');
  assert.deepEqual(states.at(-1), { status: 'done', text: 'Hel', out: '<Hel>' });

  // an older, slower answer must not overwrite a newer one
  states.length = 0;
  live.update('slow one', 'en', 'ms', { immediate: true });
  await sleep(5);
  live.update('fast', 'en', 'ms', { immediate: true });
  await sleep(200);
  const done = states.filter(s => s.status === 'done');
  assert.deepEqual(done.map(s => s.text), ['fast']);

  // known text: no request, no "pending"
  states.length = 0;
  const before = mm.asked.length;
  live.update('Hel', 'en', 'ms');
  assert.deepEqual(states, [{ status: 'done', text: 'Hel', out: '<Hel>' }]);
  assert.equal(mm.asked.length, before);

  live.update('', 'en', 'ms');
  assert.equal(states.at(-1).status, 'idle');
});

test('createLive: an error is reported for the newest text only, and retry() asks again', async () => {
  let failing = true;
  const fetch = async () => (failing ? json({ responseStatus: 429, quotaFinished: true, responseData: {} }) : json({ responseStatus: 200, responseData: { translatedText: 'ok' } }));
  const e = createEngine({ fetch, getSettings: () => ({ provider: 'mymemory' }) });
  const states = [];
  const live = createLive(e, { delay: 5, onState: s => states.push(s) });
  live.update('x', 'en', 'ms', { immediate: true });
  await sleep(20);
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).error.code, 'quota');
  failing = false;
  live.retry();
  await sleep(20);
  assert.equal(states.at(-1).status, 'done');
  assert.equal(states.at(-1).out, 'ok');
});
