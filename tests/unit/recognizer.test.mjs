import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRecognizer, errorCode, joinWords, transcriptOf } from '../../src/js/speech/recognizer.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = list => list.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal }));

/** A stand-in for webkitSpeechRecognition that the test drives. */
class FakeSR {
  static instances = [];
  static endOnStop = true;
  constructor() { this.started = false; FakeSR.instances.push(this); }
  start() { this.started = true; }
  stop() { if (FakeSR.endOnStop) setTimeout(() => this.onend?.(), 5); }
  abort() { this.aborted = true; }
  say(list) { this.onresult?.({ results: results(list) }); }
  end() { this.onend?.(); }
  fail(error) { this.onerror?.({ error }); this.onend?.(); }
}

beforeEach(() => {
  FakeSR.instances = [];
  FakeSR.endOnStop = true;
  globalThis.window = { webkitSpeechRecognition: FakeSR };
});

test('transcriptOf / joinWords: the whole transcript from a result list, spaces only where the script uses them', () => {
  assert.deepEqual(transcriptOf(results([['hello', true], [' world', false]])), { finalText: 'hello', interim: 'world', text: 'hello world', dropped: 0, noise: 0 });
  assert.equal(joinWords('你好', '世界'), '你好世界');
  assert.equal(joinWords('apa', 'khabar'), 'apa khabar');
  assert.equal(joinWords('', '  hi'), 'hi');
  assert.equal(joinWords('hi', ''), 'hi');
});

test('errorCode: Web Speech errors become the codes the interface explains', () => {
  assert.equal(errorCode('not-allowed'), 'denied');
  assert.equal(errorCode('service-not-allowed'), 'nosiri');
  assert.equal(errorCode('language-not-supported'), 'lang');
  assert.equal(errorCode('audio-capture'), 'nomic');
  assert.equal(errorCode('whatever'), 'failed');
});

test('recognizer: interim text live, keeps listening across the engine\'s own stops, final text on stop()', async () => {
  const texts = [], states = [];
  const r = createRecognizer({ lang: 'ms-MY', onText: x => texts.push(x), onState: s => states.push(s) });
  r.start();
  const first = FakeSR.instances[0];
  assert.equal(first.lang, 'ms-MY');
  assert.equal(first.interimResults, true);
  first.say([['selamat', false]]);
  first.say([['selamat pagi', true]]);
  assert.deepEqual(texts.at(-1), { text: 'selamat pagi', final: false });
  first.end(); // the engine stops by itself after a pause (iOS does this)
  await sleep(200);
  assert.equal(FakeSR.instances.length, 2, 'started again');
  FakeSR.instances[1].say([['apa khabar', false]]);
  assert.equal(texts.at(-1).text, 'selamat pagi apa khabar', 'what was heard before the restart is kept');
  r.stop();
  await sleep(20);
  assert.deepEqual(texts.at(-1), { text: 'selamat pagi apa khabar', final: true });
  assert.deepEqual(states, ['listening', 'stopped']);
  assert.equal(r.listening, false);
});

test('recognizer: iOS-style repeated results do not repeat words', () => {
  const texts = [];
  const r = createRecognizer({ lang: 'en-US', onText: x => texts.push(x.text) });
  r.start();
  const sr = FakeSR.instances[0];
  // iOS sends the growing transcript again and again as one result that is not final
  sr.say([['good', false]]);
  sr.say([['good morning', false]]);
  sr.say([['good morning everyone', false]]);
  assert.equal(texts.at(-1), 'good morning everyone');
  r.abort();
});

test('recognizer: gives up after a few silent restarts; a fatal error stops at once and is reported', async () => {
  const states = [], errors = [];
  const r = createRecognizer({ lang: 'en-US', onText: () => {}, onState: s => states.push(s), onError: e => errors.push(e), maxSilentRestarts: 2 });
  r.start();
  for (let i = 0; i < 3; i++) { FakeSR.instances.at(-1).fail('no-speech'); await sleep(200); }
  assert.equal(FakeSR.instances.length, 3);
  assert.equal(states.at(-1), 'stopped');
  assert.deepEqual(errors, [], 'silence is not an error');

  const r2 = createRecognizer({ lang: 'en-US', onText: () => {}, onState: s => states.push(s), onError: e => errors.push(e) });
  r2.start();
  const n = FakeSR.instances.length;
  FakeSR.instances.at(-1).fail('service-not-allowed');
  await sleep(200);
  assert.equal(FakeSR.instances.length, n, 'not restarted');
  assert.deepEqual(errors, ['nosiri']);
  assert.equal(r2.listening, false);
});

test('recognizer: when the engine never sends "end" after stop(), the button does not stay stuck', async () => {
  FakeSR.endOnStop = false;
  const texts = [], states = [];
  const r = createRecognizer({ lang: 'en-US', onText: x => texts.push(x), onState: s => states.push(s) });
  r.start();
  FakeSR.instances[0].say([['hello', false]]);
  r.stop();
  await sleep(1700);
  assert.deepEqual(states, ['listening', 'stopped']);
  assert.deepEqual(texts.at(-1), { text: 'hello', final: true });
  assert.ok(FakeSR.instances[0].aborted);
});

const scored = list => list.map(([t, isFinal, confidence = 0]) => Object.assign([{ transcript: t, confidence }], { isFinal }));

test('transcriptOf, Noisy place mode: unsure and music-like final parts are dropped, sound markers always removed', () => {
  const list = scored([['where is the station', true, 0.92], ['la la la la', true, 0.8], ['baby baby oh baby baby baby', true, 0.7], ['mumble', true, 0.2], ['[Music] how far', false]]);
  const normal = transcriptOf(list);
  assert.equal(normal.text, 'where is the station la la la la baby baby oh baby baby baby mumble how far', 'normal mode keeps everything but the markers');
  assert.equal(normal.noise, 4, 'but counts the signs: 2 music-like, 1 unsure, 1 marker');
  const noisy = transcriptOf(list, { noisy: true });
  assert.equal(noisy.text, 'where is the station how far');
  assert.equal(noisy.dropped, 3);
  // the part still being heard is hidden while it is only singing
  assert.equal(transcriptOf(scored([['okay', true, 0.9], ['na na na', false]]), { noisy: true }).text, 'okay');
  assert.equal(transcriptOf(scored([['♪ ♪', false]])).text, '');
});

test('recognizer, Noisy place mode: filtered text, onNoise once, and no restart unless keepAlive says so', async () => {
  let noisy = true, held = true, noiseCalls = 0;
  const texts = [];
  const r = createRecognizer({ lang: 'en-US', onText: x => texts.push(x), noisy: () => noisy, keepAlive: () => held, onNoise: () => noiseCalls++ });
  r.start();
  FakeSR.instances[0].onresult({ results: scored([['hello there', true, 0.9], ['la la la', true, 0.9]]) });
  FakeSR.instances[0].onresult({ results: scored([['hello there', true, 0.9], ['la la la', true, 0.9], ['oh oh oh', false]]) });
  assert.equal(texts.at(-1).text, 'hello there');
  assert.equal(noiseCalls, 1, 'reported once per listening');
  FakeSR.instances[0].end();
  await sleep(200);
  assert.equal(FakeSR.instances.length, 2, 'held: started again after the engine paused');
  held = false;
  FakeSR.instances[1].end();
  await sleep(200);
  assert.equal(FakeSR.instances.length, 2, 'let go: no restart (music would keep coming in)');
  assert.deepEqual(texts.at(-1), { text: 'hello there', final: true });
  noisy = false;
});

test('recognizer: no Web Speech API -> "unsupported"', () => {
  globalThis.window = {};
  const errors = [];
  const r = createRecognizer({ lang: 'en-US', onText: () => {}, onError: e => errors.push(e) });
  assert.equal(r.start(), false);
  assert.deepEqual(errors, ['unsupported']);
});
