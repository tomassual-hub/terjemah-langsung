import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTranscript, hasSoundTags, isUnsure, looksLikeNoise } from '../../src/js/speech/speech-filter.js';

test('cleanTranscript: sound markers and note symbols go, words stay', () => {
  assert.equal(cleanTranscript('[Music] where is ♪ the station (applause)'), 'where is the station');
  assert.equal(cleanTranscript('(muzik) di mana stesen [BUNYI]'), 'di mana stesen');
  assert.equal(cleanTranscript('【音乐】你好'), '你好');
  assert.equal(cleanTranscript('I play music (on Sundays)'), 'I play music (on Sundays)', 'ordinary words in brackets are kept');
  assert.equal(hasSoundTags('[Music] hi'), true);
  assert.equal(hasSoundTags('♪'), true);
  assert.equal(hasSoundTags('music is nice'), false);
  assert.equal(hasSoundTags('[Music] hi'), true, 'no state left over between calls');
});

test('looksLikeNoise: singing and choruses yes, real sentences no', () => {
  for (const s of ['la la la la', 'Na na na na na', 'ooh yeah', 'oh oh oh', 'lalala', 'mmm hmm', '♪', '', '啦啦啦', '啊啊啊', 'baby baby oh baby baby baby', 'hey hey hey hey hey hey hey']) {
    assert.equal(looksLikeNoise(s), true, s);
  }
  for (const s of ['where is the train station', 'oh I see, thank you', 'Selamat pagi, apa khabar?', 'yeah that is fine', '你好吗', 'no no I said the other one', 'la paz is in bolivia']) {
    assert.equal(looksLikeNoise(s), false, s);
  }
});

test('isUnsure: only a low confidence the engine actually reported', () => {
  assert.equal(isUnsure(0.2), true);
  assert.equal(isUnsure(0.9), false);
  assert.equal(isUnsure(0), false, '0 = not given (iOS interim results)');
  assert.equal(isUnsure(undefined), false);
});
