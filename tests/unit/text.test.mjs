import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, joinParts, segmentText, splitLong, splitSentences, utf8Length } from '../../src/js/translate/text.js';

test('decodeEntities: the entities services put into plain text, and nothing else', () => {
  assert.equal(decodeEntities('I&#39;m &quot;fine&quot; &amp; you?'), 'I\'m "fine" & you?');
  assert.equal(decodeEntities('&#x4F60;&#22909;'), '你好');
  assert.equal(decodeEntities('a &lt;b&gt; c'), 'a <b> c');
  assert.equal(decodeEntities('&unknown; &#0; &#xD800;'), '&unknown; &#0; &#xD800;', 'unknown or invalid entities stay as they are');
  assert.equal(decodeEntities('no entities'), 'no entities');
  assert.equal(decodeEntities(undefined), '');
});

test('splitSentences: joining the pieces gives the line back exactly', () => {
  for (const line of ['Good morning. How are you?  Fine!', 'Selamat pagi. Apa khabar?', '你好。你好吗？', 'no punctuation at all', '']) {
    assert.equal(splitSentences(line, 'en').join(''), line);
  }
  assert.equal(splitSentences('Good morning. How are you?', 'en').length, 2);
});

test('splitLong: no piece over the byte limit, nothing lost, also for text without spaces', () => {
  const words = 'lorem ipsum dolor sit amet '.repeat(60);
  const parts = splitLong(words, 100);
  assert.ok(parts.every(p => utf8Length(p) <= 100));
  assert.equal(parts.join(''), words);
  const cjk = '这是一个没有空格的很长的中文句子'.repeat(20);
  const c = splitLong(cjk, 50);
  assert.ok(c.every(p => utf8Length(p) <= 50));
  assert.equal(c.join(''), cjk);
  assert.deepEqual(splitLong('short', 100), ['short']);
});

test('segmentText + joinParts: an identity "translation" gives the text back, with line breaks and spacing', () => {
  const text = 'Hello there.  How are you?\n\nSecond paragraph!\n   indented line';
  for (const unit of ['sentence', 'line']) {
    const parts = segmentText(text, { unit });
    const map = new Map(parts.filter(p => typeof p === 'object').map(p => [p.core, p.core]));
    assert.equal(joinParts(parts, map), text, unit);
  }
  const cores = segmentText(text, { unit: 'sentence' }).filter(p => typeof p === 'object' && p.core).map(p => p.core);
  assert.deepEqual(cores, ['Hello there.', 'How are you?', 'Second paragraph!', 'indented line']);
});

test('joinParts: languages written without spaces drop the spaces between sentences', () => {
  const parts = segmentText('Hi. How are you?', { unit: 'sentence' });
  const map = new Map([['Hi.', '你好。'], ['How are you?', '你好吗？']]);
  assert.equal(joinParts(parts, map, { noSpace: true }), '你好。你好吗？');
  assert.equal(joinParts(parts, map), '你好。 你好吗？');
});
