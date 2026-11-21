// Telling speech from music in what the recognizer heard. The browser gives us text, not audio, so this works on the words:
//   - markers some engines put in for sounds ("[Music]", "(applause)", "♪") are always removed,
//   - "noise-like" text: only singing syllables ("la la la", "oh oh", "na na na"), or the same few words over and over (a chorus),
//   - results the engine itself is unsure about (a low confidence score).
// In Noisy place mode these are dropped; in normal mode they only count as a sign that the mode would help.
// Pure functions, unit-tested in tests/unit/speech-filter.test.mjs.

const TAG = /[[(（【]\s*(?:music|musik|muzik|muzik latar|background music|instrumental|singing|nyanyian|song|lagu|applause|tepukan|laughter|ketawa|noise|bunyi|bising|inaudible|tidak jelas|音乐|音樂|掌声)\s*[\])）】]/giu;
const NOTES = /[♪♫♬♩🎵🎶]/gu;

const FILLERS = new Set([
  'la', 'lala', 'lalala', 'na', 'nana', 'nanana', 'da', 'dada', 'doo', 'du', 'dum', 'ba', 'bam',
  'oh', 'ohh', 'ooh', 'oo', 'ah', 'aah', 'ahh', 'uh', 'um', 'umm', 'hm', 'hmm', 'mm', 'mmm', 'eh', 'yeah', 'yea', 'ye', 'woah', 'whoa', 'wo', 'hey', 'ho', 'ha', 'haha',
  'yo', 'baby', 'ooo', 'oooh',
]);
const SYLLABLES = /^(?:la|na|da|du|do|oh|ah|uh|mm|hm|ha|o)+h*$/;
const CJK_FILLERS = /^[啦啊哦噢嗯呀哈呜嘿啦～~\s,，.。!！]+$/u;

export const hasSoundTags = text => { TAG.lastIndex = 0; NOTES.lastIndex = 0; return TAG.test(text) || NOTES.test(text); };

/** The text without sound markers and note symbols, with spaces tidied. */
export function cleanTranscript(text) {
  return String(text ?? '').replace(TAG, ' ').replace(NOTES, ' ').replace(/\s+/g, ' ').trim();
}

/** True for text that is most likely music or noise rather than someone talking. */
export function looksLikeNoise(text) {
  const t = cleanTranscript(text).toLocaleLowerCase();
  if (!t) return true;
  if (CJK_FILLERS.test(t)) return true;
  const words = t.match(/[\p{L}\p{N}']+/gu) ?? [];
  if (!words.length) return true;
  if (words.every(w => FILLERS.has(w) || SYLLABLES.test(w))) return true;
  // a chorus: many words, few different ones ("baby baby baby oh baby baby")
  if (words.length >= 6 && new Set(words).size / words.length < 0.34) return true;
  return false;
}

/** Below this confidence (0..1, when the engine gives one: 0 means "not given") a result is treated as unsure. */
export const MIN_CONFIDENCE = 0.45;
export const isUnsure = (confidence, min = MIN_CONFIDENCE) => Number(confidence) > 0 && Number(confidence) < min;
