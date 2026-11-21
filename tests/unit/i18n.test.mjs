// Every interface text exists in Malay and English, with the same {placeholders}, and every key the code asks for exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, resolveLocale, setLocale, t } from '../../src/js/core/i18n.js';
import { LANGUAGES } from '../../src/js/core/languages.js';

const SRC = fileURLToPath(new URL('../../src/js', import.meta.url));
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('both languages have the same keys and the same placeholders, and no empty text', () => {
  assert.deepEqual(Object.keys(STRINGS.en).sort(), Object.keys(STRINGS.ms).sort());
  for (const [k, v] of Object.entries(STRINGS.ms)) {
    assert.ok(v.trim(), `ms.${k} is empty`);
    assert.ok(STRINGS.en[k].trim(), `en.${k} is empty`);
    assert.deepEqual(holes(STRINGS.en[k]), holes(v), `placeholders of ${k}`);
  }
});

test('every t("key") in the source exists, and the keys built at run time too', () => {
  const used = new Set();
  for (const f of files(SRC).filter(f => !f.endsWith('i18n.js'))) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([\w-]+)'/g)) used.add(m[1]);
  // labels kept in tables: main.js TABS
  for (const m of readFileSync(join(SRC, 'main.js'), 'utf8').matchAll(/label: '(\w+)'/g)) used.add(m[1]);
  // built from codes: translate errors (providers.js) and speech errors (recognizer.js)
  for (const c of ['offline', 'network', 'quota', 'lang', 'server', 'aborted']) used.add(`err_${c}`);
  for (const c of ['denied', 'nosiri', 'nomic', 'lang', 'network', 'nospeech', 'unsupported', 'failed']) used.add(`mic_${c}`);
  assert.ok(used.size > 100, `found ${used.size} keys: is the scan still working?`);
  const missing = [...used].filter(k => !(k in STRINGS.ms));
  assert.deepEqual(missing, []);
});

test('t(): placeholders, the English locale, unknown keys', () => {
  setLocale('ms');
  assert.equal(t('detected', { lang: 'Indonesia' }), 'Dikesan: Indonesia');
  setLocale('en');
  assert.equal(t('detected', { lang: 'Indonesian' }), 'Detected: Indonesian');
  assert.equal(t('no-such-key'), '');
  setLocale('ms');
});

test('resolveLocale: an explicit choice wins; "auto" is English only on an English device', () => {
  assert.equal(resolveLocale('en', 'ms-MY'), 'en');
  assert.equal(resolveLocale('ms', 'en-US'), 'ms');
  assert.equal(resolveLocale('auto', 'en-GB'), 'en');
  assert.equal(resolveLocale('auto', 'ms-MY'), 'ms');
  assert.equal(resolveLocale('auto', 'zh-CN'), 'ms');
});

test('languages: unique ids, every service code and speech tag present', () => {
  const ids = LANGUAGES.map(l => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LANGUAGES) for (const k of ['ms', 'en', 'native', 'speech', 'mm', 'g', 'az']) assert.ok(l[k], `${l.id}.${k}`);
  for (const l of LANGUAGES) assert.match(l.speech, /^[a-z]{2,3}-[A-Z]{2}$/);
});
