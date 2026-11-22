// Where the Interpreter screen gets its speech from. Both sources turn a continuous stream of speech into SEGMENTS (one
// finished sentence or phrase each) plus a PARTIAL (the words of the segment still being spoken):
//
//   createWebSpeechSource: the browser's own recognizer (on iPhone: Siri dictation). Free, but it hears ONE language, chosen
//     beforehand: the Web Speech API cannot detect the spoken language. A segment ends at a short pause.
//   createAzureSource: Azure AI Speech with continuous language identification (the user's own key; 5 audio hours a month are
//     free). It listens for up to 10 candidate languages at once and says which one each segment was spoken in: speakers can
//     take turns in different languages and nobody has to press anything. The SDK (~400 KB) is loaded only when this is used.
//
// Both report: onPartial(text, langId|null), onSegment(text, langId), onState('listening'|'stopped'), onError(code).

import { lang, LANGUAGES, fromServiceCode } from '../core/languages.js';
import { createRecognizer } from './recognizer.js';

export const SEGMENT_PAUSE_MS = 1100; // Web Speech: this much silence ends a segment
export const AZURE_MAX_LANGUAGES = 10; // Azure continuous language identification takes at most 10 candidates

/**
 * The language a sentence spoken in `spoken` is translated into: the listener's language, or, for a sentence spoken in the
 * listener's own language (a reply), the other side's language.
 */
export function targetFor(spoken, { to, candidates = [], from }) {
  if (spoken !== to) return to;
  const other = [from, ...candidates].find(id => id && id !== 'auto' && id !== to);
  return other ?? (to === 'en' ? 'ms' : 'en');
}

/** Splits a transcript into units: words, or characters for languages written without spaces. */
const unitsOf = (text, noSpace) => (noSpace ? Array.from(text.replace(/\s+/g, '')) : text.trim().split(/\s+/).filter(Boolean));

/**
 * The part of a growing transcript that is new since `done` units were handed out. Engines revise the last words they heard,
 * so the cut is made by counting units (not characters): a revised word never ends up half in one segment and half in the next.
 */
export function newPart(text, done, noSpace = false) {
  const units = unitsOf(text, noSpace);
  return { part: units.slice(done).join(noSpace ? '' : ' '), count: Math.max(done, units.length) };
}

/**
 * @param {{ langId: string, noisy?: () => boolean, onPartial: Function, onSegment: Function, onState?: Function, onError?: Function, pauseMs?: number }} o
 */
export function createWebSpeechSource({ langId, noisy = () => false, onPartial, onSegment, onState = () => {}, onError = () => {}, pauseMs = SEGMENT_PAUSE_MS }) {
  const l = lang(langId);
  const noSpace = !!l?.noSpace;
  let done = 0; // units of the transcript already handed out as segments
  let latest = '';
  let timer = null;

  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const { part, count } = newPart(latest, done, noSpace);
    done = count;
    onPartial('', langId);
    if (part.trim()) onSegment(part, langId);
  };

  const rec = createRecognizer({
    lang: l?.speech,
    continuous: true,
    noisy,
    // an interpreter listens for a long time, with long silences between speakers: keep starting again
    maxSilentRestarts: 1000,
    onText: ({ text, final }) => {
      latest = text;
      if (final) { flush(); return; }
      onPartial(newPart(text, done, noSpace).part, langId);
      clearTimeout(timer);
      timer = setTimeout(flush, pauseMs);
    },
    onState: s => { if (s === 'stopped') clearTimeout(timer); onState(s); },
    onError,
  });

  return {
    get listening() { return rec.listening; },
    start: () => { done = 0; latest = ''; return rec.start(); },
    stop: () => rec.stop(),
    abort: () => { clearTimeout(timer); rec.abort(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------- Azure

/** Azure speech locales for our language ids (at most 10, no repeats, unknown ids skipped). */
export function azureLocales(ids) {
  const out = [];
  for (const id of ids) {
    const s = AZURE_LOCALE[id] ?? lang(id)?.speech;
    if (s && !out.includes(s)) out.push(s);
    if (out.length === AZURE_MAX_LANGUAGES) break;
  }
  return out;
}
// where Azure's speech locale differs from the one Safari uses
const AZURE_LOCALE = { bn: 'bn-IN' };

/** The language id of a locale Azure reported ("ms-MY", "zh-CN", "fil-PH"), preferring one of the candidates. */
export function langFromLocale(locale, candidates = []) {
  if (!locale || typeof locale !== 'string') return null;
  const c = locale.toLowerCase();
  const byLocale = id => (AZURE_LOCALE[id] ?? lang(id)?.speech ?? '').toLowerCase() === c;
  return candidates.find(byLocale) ?? LANGUAGES.find(l => byLocale(l.id))?.id ?? fromServiceCode(c, 'az');
}

/** A cancellation from the Speech service, as one of our error codes. */
export function azureErrorCode(sdk, e) {
  const C = sdk.CancellationErrorCode || {};
  const details = String(e?.errorDetails ?? '');
  if (/NotAllowedError|Permission|denied/i.test(details)) return 'denied';
  if (/NotFoundError|getUserMedia|microphone/i.test(details)) return 'nomic';
  switch (e?.errorCode) {
    case C.AuthenticationFailure: case C.Forbidden: return /quota/i.test(details) ? 'azquota' : 'azauth';
    case C.TooManyRequests: return 'azquota';
    case C.BadRequestParameters: return 'azlang';
    case C.ConnectionFailure: case C.ServiceTimeout: case C.ServiceUnavailable: return 'network';
    default: return /1006|websocket|connect/i.test(details) ? 'network' : 'failed';
  }
}

export const validRegion = r => /^[a-z0-9]{2,40}$/.test(r || '');

/**
 * The Speech SDK. Tests put a stand-in at window.__tlSpeechSdk (headless browsers have no microphone and no Azure); the real
 * one is a separate chunk, downloaded the first time it is needed.
 */
export const loadSpeechSdk = async () => (typeof window !== 'undefined' && window.__tlSpeechSdk) || import('microsoft-cognitiveservices-speech-sdk');

/**
 * @param {{ key: string, region: string, candidates: string[], loadSdk?: () => Promise<any>, workletUrl?: string,
 *   onPartial: Function, onSegment: Function, onState?: Function, onError?: Function }} o
 */
export function createAzureSource({ key, region, candidates, loadSdk = loadSpeechSdk, workletUrl, onPartial, onSegment, onState = () => {}, onError = () => {} }) {
  let rec = null;
  let wanted = false;
  let finished = true;
  let stopTimer = null;
  let sdk = null;
  const locales = azureLocales(candidates);

  function finish() {
    if (finished) return;
    finished = true;
    wanted = false;
    clearTimeout(stopTimer);
    const r = rec;
    rec = null;
    try { r?.close(); } catch {}
    onPartial('', null);
    onState('stopped');
  }

  const langOf = result => {
    try { return langFromLocale(sdk.AutoDetectSourceLanguageResult.fromResult(result).language, candidates); } catch { return null; }
  };

  async function begin() {
    try {
      sdk = await loadSdk();
    } catch {
      onError('azload');
      finish();
      return;
    }
    if (!wanted) return;
    try {
      const config = sdk.SpeechConfig.fromEndpoint(new URL(`wss://${region}.stt.speech.microsoft.com/speech/universal/v2`), key);
      config.setProperty(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
      const audio = sdk.AudioConfig.fromDefaultMicrophoneInput();
      // the SDK would load its audio worklet from a blob: URL, which the CSP forbids: hand it our own copy
      if (workletUrl) try { audio.setProperty('MICROPHONE-WorkletSourceUrl', workletUrl); } catch {}
      rec = sdk.SpeechRecognizer.FromConfig(config, sdk.AutoDetectSourceLanguageConfig.fromLanguages(locales), audio);
      rec.recognizing = (_, e) => { if (wanted) onPartial(e.result.text || '', langOf(e.result)); };
      rec.recognized = (_, e) => {
        if (e.result.reason !== sdk.ResultReason.RecognizedSpeech || !e.result.text?.trim()) return;
        onPartial('', null);
        const id = langOf(e.result) ?? candidates[0];
        onSegment(e.result.text.trim(), id);
      };
      rec.canceled = (_, e) => {
        if (e.reason === sdk.CancellationReason.Error) onError(azureErrorCode(sdk, e));
        finish();
      };
      rec.sessionStopped = () => finish();
      rec.startContinuousRecognitionAsync(() => {}, err => { onError(azureErrorCode(sdk, { errorDetails: err })); finish(); });
    } catch (err) {
      onError(azureErrorCode(sdk, { errorDetails: err?.message ?? err }));
      finish();
    }
  }

  return {
    get listening() { return wanted; },
    start() {
      if (wanted) return true;
      if (!key || !validRegion(region)) { onError('azsetup'); return false; }
      if (!locales.length) { onError('azlang'); return false; }
      wanted = true;
      finished = false;
      onState('listening');
      begin();
      return true;
    },
    stop() {
      if (finished) return;
      wanted = false;
      if (!rec) { finish(); return; }
      const r = rec;
      r.stopContinuousRecognitionAsync(() => finish(), () => finish());
      stopTimer = setTimeout(finish, 3000); // never leave the button stuck on "listening"
    },
    abort() {
      wanted = false;
      const r = rec;
      if (r) try { r.stopContinuousRecognitionAsync(() => {}, () => {}); } catch {}
      finish();
    },
  };
}
