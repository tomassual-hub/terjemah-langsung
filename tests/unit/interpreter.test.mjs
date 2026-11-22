// The Interpreter's speech sources: cutting a growing transcript into sentences, choosing the direction of each sentence, and
// the Azure AI Speech source (driven here through a stand-in SDK: no microphone, no network).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  azureErrorCode, azureLocales, createAzureSource, createWebSpeechSource, langFromLocale, newPart, targetFor, validRegion,
} from '../../src/js/speech/interpreter-sources.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('newPart: only the words after those already handed out, counted in words (or characters without spaces)', () => {
  assert.deepEqual(newPart('good morning everyone', 0), { part: 'good morning everyone', count: 3 });
  assert.deepEqual(newPart('good morning everyone welcome to', 3), { part: 'welcome to', count: 5 });
  // the engine revised an earlier word: the cut stays at the word count, nothing is repeated
  assert.deepEqual(newPart('good mourning everyone welcome to the summit', 5), { part: 'the summit', count: 7 });
  // the transcript shrank (revision): nothing new, and the count never goes back
  assert.deepEqual(newPart('good morning', 5), { part: '', count: 5 });
  assert.deepEqual(newPart('大家好欢迎', 3, true), { part: '欢迎', count: 5 });
});

test('targetFor: into the listener language; a sentence in the listener language goes the other way', () => {
  assert.equal(targetFor('en', { to: 'ms', from: 'auto', candidates: ['ms', 'en', 'zh'] }), 'ms');
  assert.equal(targetFor('zh', { to: 'ms', from: 'auto', candidates: ['ms', 'en', 'zh'] }), 'ms');
  assert.equal(targetFor('ms', { to: 'ms', from: 'auto', candidates: ['ms', 'en', 'zh'] }), 'en');
  assert.equal(targetFor('ms', { to: 'ms', from: 'auto', candidates: ['ms'] }), 'en');
  assert.equal(targetFor('en', { to: 'en', from: 'auto', candidates: [] }), 'ms');
  assert.equal(targetFor('ms', { to: 'ms', from: 'ja', candidates: [] }), 'ja');
});

test('azureLocales / langFromLocale / validRegion', () => {
  assert.deepEqual(azureLocales(['ms', 'en', 'zh', 'bn', 'nope', 'ms']), ['ms-MY', 'en-US', 'zh-CN', 'bn-IN']);
  assert.equal(azureLocales(['ms', 'en', 'zh', 'zh-TW', 'ta', 'id', 'th', 'vi', 'tl', 'ja', 'ko', 'hi']).length, 10);
  assert.equal(langFromLocale('ms-MY', ['ms', 'en']), 'ms');
  assert.equal(langFromLocale('zh-TW', ['zh', 'zh-TW']), 'zh-TW');
  assert.equal(langFromLocale('bn-IN', ['bn']), 'bn');
  assert.equal(langFromLocale('en-GB', []), 'en');
  assert.equal(langFromLocale('', []), null);
  assert.ok(validRegion('southeastasia'));
  assert.ok(!validRegion('evil.example.com/x'));
  assert.ok(!validRegion(''));
});

// ---- a stand-in for microsoft-cognitiveservices-speech-sdk: records the configuration, lets the test fire the events
function fakeSdk() {
  const sdk = {
    made: [],
    CancellationErrorCode: { AuthenticationFailure: 1, Forbidden: 2, TooManyRequests: 3, BadRequestParameters: 4, ConnectionFailure: 5, ServiceTimeout: 6, ServiceUnavailable: 7 },
    CancellationReason: { Error: 1, EndOfStream: 0 },
    ResultReason: { RecognizedSpeech: 3, NoMatch: 0 },
    PropertyId: { SpeechServiceConnection_LanguageIdMode: 'LID_MODE' },
    SpeechConfig: { fromEndpoint: (url, key) => ({ url: String(url), key, props: {}, setProperty(k, v) { this.props[k] = v; } }) },
    AudioConfig: { fromDefaultMicrophoneInput: () => ({ props: {}, setProperty(k, v) { this.props[k] = v; } }) },
    AutoDetectSourceLanguageConfig: { fromLanguages: list => ({ list }) },
    AutoDetectSourceLanguageResult: { fromResult: r => ({ language: r.lang }) },
    SpeechRecognizer: {
      FromConfig(config, auto, audio) {
        const rec = {
          config, auto, audio, started: 0, stopped: 0, closed: 0,
          startContinuousRecognitionAsync(ok) { this.started++; ok(); },
          stopContinuousRecognitionAsync(ok) { this.stopped++; setTimeout(() => { this.sessionStopped?.(); ok(); }, 5); },
          close() { this.closed++; },
        };
        sdk.made.push(rec);
        return rec;
      },
    },
  };
  return sdk;
}

function azure(sdk, extra = {}) {
  const log = { partial: [], segments: [], states: [], errors: [] };
  const src = createAzureSource({
    key: 'k123', region: 'southeastasia', candidates: ['ms', 'en', 'zh'], loadSdk: async () => sdk, workletUrl: 'https://app/speech-processor.js',
    onPartial: (t, l) => log.partial.push([t, l]), onSegment: (t, l) => log.segments.push([t, l]),
    onState: s => log.states.push(s), onError: c => log.errors.push(c), ...extra,
  });
  return { src, log };
}

test('Azure: continuous language identification on the v2 endpoint, each sentence with the language it was spoken in', async () => {
  const sdk = fakeSdk();
  const { src, log } = azure(sdk);
  assert.equal(src.start(), true);
  await sleep(5);
  const rec = sdk.made[0];
  assert.equal(rec.config.url, 'wss://southeastasia.stt.speech.microsoft.com/speech/universal/v2');
  assert.equal(rec.config.key, 'k123');
  assert.equal(rec.config.props.LID_MODE, 'Continuous');
  assert.deepEqual(rec.auto.list, ['ms-MY', 'en-US', 'zh-CN']);
  assert.equal(rec.audio.props['MICROPHONE-WorkletSourceUrl'], 'https://app/speech-processor.js');
  assert.equal(rec.started, 1);

  rec.recognizing(null, { result: { text: 'selamat pagi', lang: 'ms-MY' } });
  rec.recognized(null, { result: { text: 'Selamat pagi semua.', lang: 'ms-MY', reason: 3 } });
  rec.recognizing(null, { result: { text: 'thank you', lang: 'en-US' } });
  rec.recognized(null, { result: { text: 'Thank you, minister.', lang: 'en-US', reason: 3 } });
  rec.recognized(null, { result: { text: '', lang: 'en-US', reason: 0 } }); // no match: nothing
  rec.recognized(null, { result: { text: '谢谢大家。', lang: 'zh-CN', reason: 3 } });
  assert.deepEqual(log.segments, [['Selamat pagi semua.', 'ms'], ['Thank you, minister.', 'en'], ['谢谢大家。', 'zh']]);
  assert.deepEqual(log.partial.filter(([t]) => t), [['selamat pagi', 'ms'], ['thank you', 'en']]);

  src.stop();
  await sleep(20);
  assert.equal(rec.stopped, 1);
  assert.equal(rec.closed, 1);
  assert.deepEqual(log.states, ['listening', 'stopped']);
  assert.equal(src.listening, false);
});

test('Azure: errors become codes; missing setup is refused before anything is loaded', async () => {
  let loaded = 0;
  const bad = createAzureSource({ key: '', region: 'x', candidates: ['ms'], loadSdk: async () => { loaded++; }, onPartial() {}, onSegment() {}, onError: c => bad.err = c });
  assert.equal(bad.start(), false);
  assert.equal(bad.err, 'azsetup');
  assert.equal(loaded, 0);

  const sdk = fakeSdk();
  const { src, log } = azure(sdk);
  src.start();
  await sleep(5);
  sdk.made[0].canceled(null, { reason: 1, errorCode: 1, errorDetails: 'Unauthorized' });
  assert.deepEqual(log.errors, ['azauth']);
  assert.deepEqual(log.states, ['listening', 'stopped']);
  assert.equal(sdk.made[0].closed, 1);

  const C = fakeSdk();
  assert.equal(azureErrorCode(C, { errorCode: 3 }), 'azquota');
  assert.equal(azureErrorCode(C, { errorCode: 2, errorDetails: 'quota exceeded' }), 'azquota');
  assert.equal(azureErrorCode(C, { errorCode: 4 }), 'azlang');
  assert.equal(azureErrorCode(C, { errorCode: 5 }), 'network');
  assert.equal(azureErrorCode(C, { errorDetails: 'NotAllowedError: Permission denied' }), 'denied');

  const failing = azure(null, { loadSdk: async () => { throw new Error('chunk 404'); } });
  failing.src.start();
  await sleep(5);
  assert.deepEqual(failing.log.errors, ['azload']);
  assert.deepEqual(failing.log.states, ['listening', 'stopped']);
});

test('Azure: stopped before the SDK arrived = no recognizer is ever made', async () => {
  const sdk = fakeSdk();
  let release;
  const { src, log } = azure(sdk, { loadSdk: () => new Promise(r => { release = () => r(sdk); }) });
  src.start();
  src.abort();
  release();
  await sleep(5);
  assert.equal(sdk.made.length, 0);
  assert.deepEqual(log.states, ['listening', 'stopped']);
});

// ---- the free source (Web Speech API)
class FakeSR {
  static last = null;
  constructor() { FakeSR.last = this; }
  start() {}
  stop() { setTimeout(() => this.onend?.(), 5); }
  abort() {}
  say(list) { this.onresult?.({ results: list.map(([t, f]) => Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: f })) }); }
}
beforeEach(() => { globalThis.window = { webkitSpeechRecognition: FakeSR }; });

test('Web Speech: a pause cuts the running transcript into sentences, each handed over once', async () => {
  const segs = [], parts = [];
  const src = createWebSpeechSource({ langId: 'en', pauseMs: 30, onPartial: t => parts.push(t), onSegment: (t, l) => segs.push([t, l]) });
  src.start();
  const sr = FakeSR.last;
  assert.equal(sr.lang, 'en-US');
  sr.say([['good morning', false]]);
  sr.say([['good morning everyone', false]]);
  await sleep(60);
  sr.say([['good morning everyone', true], ['welcome to', false]]);
  sr.say([['good morning everyone', true], ['welcome to the summit', false]]);
  assert.equal(parts.at(-1), 'welcome to the summit');
  await sleep(60);
  assert.deepEqual(segs, [['good morning everyone', 'en'], ['welcome to the summit', 'en']]);
  // stopping hands over what was not cut yet
  sr.say([['good morning everyone', true], ['welcome to the summit', true], ['thank you', false]]);
  src.stop();
  await sleep(30);
  assert.deepEqual(segs.at(-1), ['thank you', 'en']);
  assert.equal(segs.length, 3);
});
