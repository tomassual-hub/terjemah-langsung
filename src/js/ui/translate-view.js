// The main screen: type (or dictate with the keyboard's microphone) or speak, and the translation follows live.
import { h, icon, iconButton } from '../core/dom.js';
import { t, uiLang } from '../core/i18n.js';
import { AUTO, lang, langName } from '../core/languages.js';
import { history, settings } from '../core/store.js';
import { createLive } from '../translate/engine.js';
import { canRecognize, createRecognizer } from '../speech/recognizer.js';
import { canSpeak, speak, stopSpeaking, unlock } from '../speech/speaker.js';
import { copyText, langLabel, pickLanguage, providerName, shareText, showLarge, speechErrorText, toast, translateErrorText } from './common.js';
import { NOISY_PAUSE_MS, bindMic, holdAvailable, markHoldBlocked, noiseMode } from './mic-control.js';

const MAX_CHARS = 5000;
const COMMIT_AFTER = 1800; // ms of quiet after a translation before it goes into the history

/** `state` survives a rebuild of the screen (when the interface language changes). */
export function createTranslateView(app, state = { text: '', entryId: null, committedSrc: '' }) {
  let from = settings.get('from');
  let to = settings.get('to');
  let detected = null;
  let out = '';
  let status = 'idle';
  let lastError = null;
  let rec = null;
  let commitTimer = null;
  let mode = 'text'; // how the current text came in: 'text' or 'speech'

  // ---- elements
  const fromBtn = h('button', { type: 'button', class: 'lang-btn', 'data-role': 'from', onClick: () => choose('from') });
  const toBtn = h('button', { type: 'button', class: 'lang-btn', 'data-role': 'to', onClick: () => choose('to') });
  const swapBtn = iconButton('swap', t('swap'), () => swap(), { class: 'swap-btn' });

  const input = h('textarea', {
    class: 'src-input', rows: 4, maxLength: MAX_CHARS, placeholder: t('typePlaceholder'), 'aria-label': t('sourceText'),
    autocapitalize: 'sentences', spellcheck: true, enterKeyHint: 'done',
    onInput: () => { mode = 'text'; state.text = input.value; onTextChanged(); },
  });
  const count = h('span', { class: 'char-count' });
  const detectedChip = h('button', { type: 'button', class: 'chip detected', hidden: true, onClick: () => { if (detected) setLangs(detected, to); } });
  const srcSpeak = iconButton('speak', t('listenSource'), () => say(input.value, from === AUTO ? detected : from), { class: 'small' });
  const pasteBtn = iconButton('paste', t('paste'), () => paste(), { class: 'small' });
  const clearBtn = iconButton('x', t('clear'), () => clearAll(), { class: 'small' });

  const output = h('div', { class: 'out-text', 'aria-live': 'polite', 'aria-label': t('translation') });
  const statusLine = h('div', { class: 'out-status' });
  const outSpeak = iconButton('speak', t('listen'), () => say(out, to));
  const outCopy = iconButton('copy', t('copy'), () => copyText(out));
  const outShare = iconButton('share', t('share'), () => shareText(out));
  const outFav = iconButton('star', t('favourite'), () => toggleFav(), { class: 'fav-btn' });
  const outLarge = iconButton('expand', t('showLarge'), () => showLarge(out, to));

  const micLabel = h('span', { class: 'mic-label' });
  const micBtn = h('button', { type: 'button', class: 'mic-btn', 'aria-pressed': 'false' }, icon('mic'));
  const mic = bindMic(micBtn, { listening: () => !!rec, start: () => toggleMic(), stop: () => stopMic() });
  const micHint = h('p', { class: 'mic-hint', hidden: true });
  const noiseBtn = h('button', { type: 'button', class: 'chip noise-chip', onClick: () => settings.set('noiseMode', !noiseMode()) });
  const unwatch = settings.onChange(key => { if (key === 'noiseMode' || key === '*') renderMic(); });

  const el = h('section', { class: 'view view-translate', 'data-view': 'translate', 'aria-label': t('tabTranslate') },
    h('div', { class: 'lang-bar' }, fromBtn, swapBtn, toBtn),
    h('div', { class: 'card src-card' },
      input,
      h('div', { class: 'card-foot' }, detectedChip, count, h('span', { class: 'grow' }), srcSpeak, pasteBtn, clearBtn)),
    h('div', { class: 'card out-card' },
      output,
      statusLine,
      h('div', { class: 'card-foot out-actions' }, outSpeak, outCopy, outShare, outFav, outLarge)),
    h('div', { class: 'mic-wrap' }, micBtn, micLabel, noiseBtn, micHint));

  // ---- live translation
  const live = createLive(app.engine, {
    delay: 350,
    onState: s => {
      if (s.text !== input.value || s.from !== from || s.to !== to) return; // an answer for text that has changed since
      status = s.status;
      lastError = s.error ?? null;
      if (s.status === 'done') {
        out = s.out;
        if (from === AUTO) detected = s.detected ?? null;
        scheduleCommit();
      } else if (s.status === 'idle') {
        out = '';
      }
      renderOutput();
    },
  });

  function onTextChanged({ immediate = false } = {}) {
    clearTimeout(commitTimer);
    if (!input.value.trim()) { state.entryId = null; state.committedSrc = ''; detected = null; }
    else if (state.committedSrc && !input.value.startsWith(state.committedSrc.slice(0, Math.min(12, state.committedSrc.length)))) {
      // a different text, not the same one growing or being corrected: a new history entry
      state.entryId = null;
      state.committedSrc = '';
    }
    renderCount();
    live.update(input.value, from, to, { immediate });
  }

  function scheduleCommit(ms = COMMIT_AFTER) {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, ms);
  }

  function commit() {
    clearTimeout(commitTimer);
    if (status !== 'done' || !out.trim() || !input.value.trim() || !settings.get('saveHistory')) return null;
    const srcLang = from === AUTO ? detected || AUTO : from;
    state.entryId = history.put({ id: state.entryId, from: srcLang, to, src: input.value.trim(), out: out.trim(), mode, provider: settings.get('provider') });
    state.committedSrc = input.value;
    renderFav();
    return state.entryId;
  }

  // ---- languages
  /** `candidate` if it can stand opposite `id`, otherwise English (or Malay opposite English). */
  const other = (id, candidate) => (candidate && candidate !== AUTO && candidate !== id ? candidate : id === 'en' ? 'ms' : 'en');

  function setLangs(f, tt) {
    if (f === tt) tt = other(f, null);
    commit();
    from = f; to = tt;
    settings.set('from', from);
    settings.set('to', to);
    state.entryId = null;
    state.committedSrc = '';
    if (from !== AUTO) detected = null;
    renderLangs();
    if (rec) { stopMic(); }
    onTextChanged({ immediate: true });
  }

  async function choose(which) {
    const id = await pickLanguage({ title: which === 'from' ? t('translateFrom') : t('translateTo'), current: which === 'from' ? from : to, allowAuto: which === 'from' });
    if (!id) return;
    // the same language on both sides: the two swap places
    if (which === 'from') setLangs(id, id === to ? other(id, from === AUTO ? detected : from) : to);
    else setLangs(id === from || (from === AUTO && id === detected) ? other(id, to) : from, id);
  }

  function swap() {
    const src = from === AUTO ? detected : from;
    if (!src) { toast(t('swapNeedsLanguage')); return; }
    const newText = out;
    setLangs(to, src);
    if (newText.trim()) {
      input.value = newText;
      state.text = newText;
      onTextChanged({ immediate: true });
    }
  }

  // ---- speech
  const micTag = () => lang(from)?.speech;

  async function toggleMic() {
    unlock();
    if (rec) { stopMic(); return; }
    if (!canRecognize()) {
      showMicHint(t('micUnsupported'));
      input.focus();
      return;
    }
    if (from === AUTO) {
      toast(t('pickSpokenLanguage'));
      const id = await pickLanguage({ title: t('spokenLanguage'), current: null });
      if (!id) return;
      setLangs(id, id === to ? other(id, detected) : to);
      // pressed and held: the finger has long left the button while the list was open; press again to speak
      if (noiseMode() && mic.via() === 'press') { toast(t('pressAgain')); return; }
    }
    stopSpeaking();
    app.stopOtherMics('translate');
    micHint.hidden = true;
    state.entryId = null;
    state.committedSrc = '';
    input.value = '';
    state.text = '';
    mode = 'speech';
    onTextChanged();
    const startedBy = mic.via();
    let heard = false;
    rec = createRecognizer({
      lang: micTag(),
      continuous: true,
      noisy: noiseMode,
      // Noisy place mode: start again after the engine's own pauses only while the button is held
      keepAlive: () => !noiseMode() || mic.held(),
      onNoise: () => suggestNoiseMode(),
      onText: ({ text, final }) => {
        if (!rec && !final) return;
        if (text) heard = true;
        input.value = text.slice(0, MAX_CHARS);
        state.text = input.value;
        onTextChanged({ immediate: final });
        if (final) scheduleCommit(1200);
        else if (noiseMode()) armPause();
      },
      onState: s => { if (s === 'stopped') { rec = null; clearTimeout(pauseTimer); renderMic(); } else renderMic(); },
      onError: code => {
        if (code === 'nospeech') return;
        if (code === 'denied' && startedBy === 'press' && !heard) {
          // refused from a press (not a "user gesture" on this browser): tapping works, so the button switches to taps
          markHoldBlocked();
          renderMic();
          showMicHint(t('holdBlocked'));
          return;
        }
        showMicHint(speechErrorText(code));
      },
    });
    rec.start();
    renderMic();
  }

  // Noisy place mode, after a tap (not held): one sentence, so the first pause ends it, before the music fills the gap
  let pauseTimer = null;
  function armPause() {
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => { if (rec && noiseMode() && !mic.held()) stopMic(); }, NOISY_PAUSE_MS);
  }

  let suggested = false;
  function suggestNoiseMode() {
    if (noiseMode() || suggested) return;
    suggested = true;
    toast(t('noiseSuggest'), { action: { label: t('turnOn'), run: () => settings.set('noiseMode', true) } });
  }

  function stopMic() { clearTimeout(pauseTimer); rec?.stop(); }
  function showMicHint(text) { micHint.textContent = text; micHint.hidden = false; }

  async function say(text, langId) {
    unlock();
    if (!text?.trim()) return;
    if (!canSpeak()) { toast(t('speakUnsupported'), { kind: 'error' }); return; }
    const tag = lang(langId)?.speech;
    if (!tag) { toast(t('speakNeedsLanguage')); return; }
    if (rec) stopMic();
    const r = await speak(text, tag, { rate: settings.get('speechRate') });
    if (r === 'error') toast(t('speakFailed', { lang: langName(langId, uiLang()) }), { kind: 'error' });
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      input.value = text.slice(0, MAX_CHARS);
      state.text = input.value;
      onTextChanged({ immediate: true });
    } catch { toast(t('pasteFailed'), { kind: 'error' }); }
  }

  function clearAll() {
    commit();
    if (rec) rec.abort();
    rec = null;
    input.value = '';
    state.text = '';
    onTextChanged();
    renderMic();
    input.focus();
  }

  function toggleFav() {
    const id = state.entryId && history.get(state.entryId) ? state.entryId : commit();
    if (!id) { toast(settings.get('saveHistory') ? t('nothingToSave') : t('historyOff')); return; }
    const fav = history.toggleFav(id);
    toast(fav ? t('addedFavourite') : t('removedFavourite'));
    renderFav();
  }

  // ---- rendering
  function renderLangs() {
    fromBtn.replaceChildren(h('span', {}, from === AUTO && detected ? `${langLabel(detected)} (${t('auto')})` : langLabel(from)), icon('chevron'));
    toBtn.replaceChildren(h('span', {}, langLabel(to)), icon('chevron'));
    fromBtn.setAttribute('aria-label', `${t('translateFrom')}: ${langLabel(from)}`);
    toBtn.setAttribute('aria-label', `${t('translateTo')}: ${langLabel(to)}`);
    const srcL = lang(from);
    input.setAttribute('lang', srcL?.speech ?? '');
    input.dir = srcL?.rtl ? 'rtl' : 'auto';
    const outL = lang(to);
    output.setAttribute('lang', outL?.speech ?? '');
    output.dir = outL?.rtl ? 'rtl' : 'auto';
    renderMic();
  }

  function renderCount() {
    const n = input.value.length;
    count.textContent = n ? `${n} / ${MAX_CHARS}` : '';
    clearBtn.hidden = !n;
    srcSpeak.hidden = !n;
  }

  function renderOutput() {
    const has = !!out.trim();
    output.textContent = has ? out : input.value.trim() ? '' : t('translationAppearsHere');
    output.classList.toggle('placeholder', !has);
    output.classList.toggle('stale', has && status !== 'done'); // the previous translation, while the new one is on its way
    statusLine.replaceChildren();
    statusLine.className = `out-status ${status}`;
    if (status === 'pending') statusLine.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('translating'));
    else if (status === 'error') {
      statusLine.append(h('span', { class: 'err-text' }, translateErrorText(lastError)), h('button', { type: 'button', class: 'link-btn', onClick: () => live.retry() }, t('tryAgain')));
    } else if (status === 'done' && has) statusLine.append(h('span', { class: 'by' }, providerName(settings.get('provider'))));
    for (const b of [outSpeak, outCopy, outShare, outFav, outLarge]) b.disabled = !has;
    detectedChip.hidden = !(from === AUTO && detected);
    if (from === AUTO && detected) detectedChip.textContent = t('detected', { lang: langLabel(detected) });
    renderLangs();
    renderFav();
  }

  function renderFav() {
    const e = state.entryId ? history.get(state.entryId) : null;
    const on = !!e?.fav && e.src === input.value.trim();
    outFav.classList.toggle('on', on);
    outFav.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function renderMic() {
    const on = !!rec;
    micBtn.classList.toggle('listening', on);
    micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    micBtn.replaceChildren(icon(on ? 'stop' : 'mic'));
    const noisy = noiseMode();
    const hold = noisy && holdAvailable();
    const label = on
      ? (hold && mic.held() ? t('listeningHold', { lang: langLabel(from) }) : t('listeningIn', { lang: langLabel(from) }))
      : hold ? t('holdToSpeak') : t('tapToSpeak');
    micBtn.setAttribute('aria-label', label);
    micBtn.classList.toggle('noisy', noisy);
    micLabel.textContent = label;
    input.readOnly = on;
    noiseBtn.replaceChildren(icon('ear'), t('noiseShort'));
    noiseBtn.setAttribute('aria-label', t('noiseMode'));
    noiseBtn.classList.toggle('on', noisy);
    noiseBtn.setAttribute('aria-pressed', noisy ? 'true' : 'false');
    noiseBtn.title = t('noiseModeNote');
  }

  input.value = state.text;
  renderLangs();
  renderCount();
  renderOutput();
  if (state.text) onTextChanged({ immediate: true });

  return {
    el,
    state,
    /** Loads a text (from the history) into the screen. */
    load({ id = null, from: f, to: tt, src }) {
      if (rec) rec.abort();
      rec = null;
      clearTimeout(commitTimer);
      from = lang(f) ? f : AUTO; to = lang(tt) ? tt : other(from, null);
      settings.set('from', from); settings.set('to', to);
      detected = null;
      out = '';
      input.value = src;
      state.text = src;
      state.entryId = id; // the same entry, not a copy of it
      state.committedSrc = src;
      renderLangs();
      onTextChanged({ immediate: true });
    },
    hide() { commit(); if (rec) stopMic(); },
    stopMic: () => { if (rec) stopMic(); },
    retry: () => live.retry(),
    destroy() { live.cancel(); clearTimeout(commitTimer); clearTimeout(pauseTimer); unwatch(); if (rec) rec.abort(); },
    get debug() { return { from, to, out, status, detected, listening: !!rec, entryId: state.entryId }; },
  };
}
