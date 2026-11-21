// Speech to text with the Web Speech API (on iPhone and iPad: Safari 14.5+, which uses Siri's dictation, so "Siri & Dictation"
// must be on). The wrapper smooths over the engines' differences:
//   - the whole transcript is rebuilt from event.results on every event (iOS repeats and re-flags results; Chrome does not),
//   - a recognizer that stops by itself after a pause is started again while the user still wants to listen (continuous mode),
//     and what it heard so far is kept,
//   - errors become one of a few codes the interface explains.
// onText({ text, final }) fires with the full transcript of this listening session.

export const SpeechRecognitionImpl = () => (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
export const canRecognize = () => !!SpeechRecognitionImpl();

/** Error codes: denied, nosiri, nomic, lang, network, nospeech, failed */
export function errorCode(e) {
  switch (e) {
    case 'not-allowed': return 'denied';
    case 'service-not-allowed': return 'nosiri'; // iOS: Siri & Dictation is off, or Screen Time blocks it
    case 'audio-capture': return 'nomic';
    case 'language-not-supported': return 'lang';
    case 'network': return 'network';
    case 'no-speech': return 'nospeech';
    default: return 'failed';
  }
}

/** The transcript in a result list: final parts and the part still being heard, joined with spaces where needed. */
export function transcriptOf(results) {
  let finalText = '', interim = '';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = r?.[0]?.transcript ?? '';
    if (r.isFinal) finalText = joinWords(finalText, t); else interim = joinWords(interim, t);
  }
  return { finalText, interim, text: joinWords(finalText, interim) };
}

export function joinWords(a, b) {
  if (!a) return b.trim() ? b.replace(/^\s+/, '') : '';
  if (!b.trim()) return a;
  // Chinese, Japanese, Thai, ... are written without spaces between words
  const cjk = /[฀-๿က-႟ក-៿぀-ヿ㐀-鿿가-힯豈-﫿]$/.test(a) && /^\s*[฀-๿က-႟ក-៿぀-ヿ㐀-鿿豈-﫿]/.test(b);
  if (cjk) return a + b.trim();
  return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
}

/**
 * @param {{ lang: string, continuous?: boolean, onText: Function, onState?: Function, onError?: Function, maxSilentRestarts?: number }} o
 *   onState('listening' | 'stopped'), onError(code)
 */
export function createRecognizer({ lang, continuous = true, onText, onState = () => {}, onError = () => {}, maxSilentRestarts = 2 }) {
  const Impl = SpeechRecognitionImpl();
  let rec = null;
  let wanted = false; // the user wants to listen
  let kept = ''; // what earlier sessions (before an automatic restart) heard
  let current = ''; // this session's transcript
  let heardThisSession = false;
  let silentRestarts = 0;
  let fatal = false;
  let restartTimer = null;

  const full = () => joinWords(kept, current);

  function startSession() {
    rec = new Impl();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    current = '';
    heardThisSession = false;
    rec.onresult = ev => {
      const { text } = transcriptOf(ev.results);
      if (text && text !== current) heardThisSession = true;
      current = text;
      onText({ text: full(), final: false });
    };
    rec.onerror = ev => {
      const c = errorCode(ev.error);
      if (ev.error === 'aborted') return;
      if (c === 'nospeech') return; // the end handler decides whether to try again
      fatal = true;
      onError(c);
    };
    rec.onend = () => {
      rec = null;
      kept = full();
      current = '';
      if (wanted && !fatal && continuous) {
        silentRestarts = heardThisSession ? 0 : silentRestarts + 1;
        if (silentRestarts <= maxSilentRestarts) {
          restartTimer = setTimeout(() => { if (wanted) begin(); }, 150);
          return;
        }
      }
      finish();
    };
    rec.start();
  }

  function begin() {
    try { startSession(); } catch (err) {
      rec = null;
      fatal = true;
      onError(err?.name === 'NotAllowedError' ? 'denied' : 'failed');
      finish();
    }
  }

  let finished = true;
  let stopTimer = null;

  function finish() {
    if (finished) return;
    finished = true;
    wanted = false;
    clearTimeout(restartTimer);
    clearTimeout(stopTimer);
    onText({ text: full(), final: true });
    onState('stopped');
  }

  function detach() {
    if (!rec) return;
    rec.onend = null; rec.onresult = null; rec.onerror = null;
    try { rec.abort(); } catch {}
    rec = null;
  }

  return {
    get listening() { return wanted; },
    start() {
      if (!Impl) { onError('unsupported'); return false; }
      if (wanted) return true;
      wanted = true; fatal = false; kept = ''; current = ''; silentRestarts = 0; finished = false;
      onState('listening');
      begin();
      return true;
    },
    /** Stops listening; the final transcript comes through onText({ final: true }). */
    stop() {
      if (finished) return;
      wanted = false;
      clearTimeout(restartTimer);
      if (!rec) { finish(); return; }
      try { rec.stop(); } catch { detach(); kept = full(); current = ''; finish(); return; }
      // iOS sometimes never sends "end" after stop(): do not leave the button stuck on "listening"
      stopTimer = setTimeout(() => { detach(); kept = full(); current = ''; finish(); }, 1500);
    },
    /** Stops at once and throws away what was not delivered yet. */
    abort() {
      wanted = false;
      clearTimeout(restartTimer);
      clearTimeout(stopTimer);
      detach();
      if (!finished) { finished = true; onState('stopped'); }
    },
  };
}
