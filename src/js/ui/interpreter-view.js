// Interpreter: like the interpreters at a summit. Press the mic ONCE; the app keeps listening, and every sentence anyone says is
// translated as soon as it is finished and shown in large type (with the words still being spoken, translated live, underneath).
// Optionally each translation is read aloud.
//
// Who is speaking which language:
//   - "Detect automatically" (Azure AI Speech key in Settings): the speakers may use any of up to 10 chosen languages and
//     switch between them; each sentence is translated into the listener's language. A sentence spoken IN the listener's own
//     language is translated into the other language instead, so two people can talk back and forth with no buttons at all.
//   - Otherwise the browser's recognizer (Siri on iPhone) hears one chosen language; the ⇄ button swaps direction.
import { h, icon, iconButton } from '../core/dom.js';
import { t, uiLang } from '../core/i18n.js';
import { AUTO, LANGUAGES, lang, langName } from '../core/languages.js';
import { history, settings } from '../core/store.js';
import { createLive } from '../translate/engine.js';
import { canRecognize } from '../speech/recognizer.js';
import { AZURE_MAX_LANGUAGES, createAzureSource, createWebSpeechSource, loadSpeechSdk, targetFor, validRegion } from '../speech/interpreter-sources.js';
import { canSpeak, speak, stopSpeaking, unlock } from '../speech/speaker.js';
import { confirmSheet, langLabel, openSheet, pickLanguage, shareText, speechErrorText, toast, translateErrorText } from './common.js';
import { noiseMode } from './mic-control.js';

const MAX_SEGMENTS = 200;

export const azureReady = () => !!settings.get('speechKey') && validRegion(settings.get('speechRegion'));


/** `state.segments` survives a rebuild of the screen. Segment: { id, src, out, from, to, status, error? } */
export function createInterpreterView(app, state = { segments: [], session: null }) {
  let source = null;
  let wantListen = false; // the user turned the interpreter on (it stays on while translations are read aloud)
  let pausedForSpeech = false;
  let partial = { text: '', from: null };
  let seq = state.segments.length;
  let wakeLock = null;
  const speechQueue = [];
  let speaking = false;

  const from = () => settings.get('interpFrom');
  const to = () => settings.get('interpTo');
  const candidates = () => settings.get('interpLangs').filter(id => lang(id));
  const autoMode = () => from() === AUTO;
  const opts = () => ({ to: to(), from: from(), candidates: candidates() });

  // ---- the screen
  const fromBtn = h('button', { type: 'button', class: 'lang-btn', 'data-role': 'interp-from', onClick: () => chooseFrom() });
  const toBtn = h('button', { type: 'button', class: 'lang-btn', 'data-role': 'interp-to', onClick: () => chooseTo() });
  const swapBtn = iconButton('swap', t('swap'), () => swap(), { class: 'swap-btn' });
  const note = h('p', { class: 'interp-note' });
  const feed = h('div', { class: 'interp-feed', 'aria-live': 'polite' });
  const mic = h('button', { type: 'button', class: 'mic-btn interp-mic', 'aria-pressed': 'false', onClick: () => toggle() }, icon('mic'));
  const micLabel = h('p', { class: 'mic-label' });
  const hint = h('p', { class: 'mic-hint', hidden: true });
  const speakBtn = iconButton('speak', t('interpSpeak'), () => { settings.set('interpSpeak', !settings.get('interpSpeak')); if (!settings.get('interpSpeak')) { speechQueue.length = 0; stopSpeaking(); } renderControls(); }, { class: 'small' });
  const shareBtn = iconButton('share', t('shareTranscript'), () => {
    const done = state.segments.filter(s => s.out);
    if (!done.length) { toast(t('nothingToSave')); return; }
    shareText(done.map(s => `${s.src}\n→ ${s.out}`).join('\n\n'));
  }, { class: 'small' });
  const clearBtn = iconButton('trash', t('clearTranscript'), async () => {
    if (!state.segments.length) return;
    if (await confirmSheet({ title: t('clearTranscript'), message: t('clearTranscriptQ'), ok: t('clear'), danger: true })) {
      state.segments = [];
      state.session = null;
      renderFeed();
    }
  }, { class: 'small' });

  const el = h('section', { class: 'view view-interpreter', 'data-view': 'interpreter', 'aria-label': t('tabInterpreter') },
    h('div', { class: 'lang-bar' }, fromBtn, swapBtn, toBtn),
    note,
    feed,
    h('div', { class: 'interp-foot' },
      h('div', { class: 'interp-tools' }, speakBtn),
      mic,
      h('div', { class: 'interp-tools end' }, shareBtn, clearBtn)),
    micLabel,
    hint);

  // ---- live translation of the sentence still being spoken
  const live = createLive(app.engine, {
    delay: 500,
    onState: s => {
      if (s.text !== partial.text) return;
      partial.out = s.status === 'done' ? s.out : partial.out;
      renderPartial();
    },
  });

  function onPartial(text, spoken) {
    const f = spoken ?? partial.from ?? (autoMode() ? candidates()[0] : from());
    if (text === partial.text && f === partial.from) return;
    partial = { text, from: f, out: text && partial.text && text.startsWith(partial.text.slice(0, 8)) ? partial.out : '' };
    if (text.trim() && f) live.update(text, f, targetFor(f, opts())); else live.cancel();
    renderPartial();
  }

  function onSegment(text, spoken) {
    const f = spoken ?? (autoMode() ? candidates()[0] : from());
    const seg = { id: `s${++seq}`, src: text, out: '', from: f, to: targetFor(f, opts()), status: 'pending', error: null, at: Date.now() };
    state.segments.push(seg);
    if (state.segments.length > MAX_SEGMENTS) state.segments.splice(0, state.segments.length - MAX_SEGMENTS);
    translate(seg);
    renderFeed();
  }

  function translate(seg) {
    seg.status = 'pending';
    app.engine.translate(seg.src, seg.from, seg.to).then(
      r => {
        seg.out = r.text; seg.status = 'done'; seg.error = null;
        renderSegment(seg);
        keep();
        if (settings.get('interpSpeak') && canSpeak() && seg.out.trim()) { speechQueue.push(seg); drainSpeech(); }
      },
      err => { seg.status = 'error'; seg.error = err; renderSegment(seg); },
    );
  }

  /** The whole listening session is one history entry, growing as it goes. */
  function keep() {
    if (!settings.get('saveHistory')) return;
    const done = state.segments.filter(s => s.status === 'done' && s.out.trim() && (!state.session || s.at >= state.session.since));
    if (!done.length) return;
    const one = new Set(done.map(s => s.from)).size === 1 ? done[0].from : AUTO;
    state.session ??= { id: null, since: 0 };
    state.session.id = history.put({
      id: state.session.id, from: one, to: done.at(-1).to, src: done.map(s => s.src).join('\n'), out: done.map(s => s.out).join('\n'),
      mode: 'interpreter', provider: settings.get('provider'),
    });
  }

  // ---- reading aloud: the microphone pauses while the phone speaks (or it would translate its own voice)
  async function drainSpeech() {
    if (speaking) return;
    speaking = true;
    while (speechQueue.length && settings.get('interpSpeak')) {
      const seg = speechQueue.shift();
      if (source?.listening) { pausedForSpeech = true; source.stop(); }
      renderControls();
      const tag = lang(seg.to)?.speech;
      if (tag) await speak(seg.out, tag, { rate: settings.get('speechRate') });
    }
    speaking = false;
    if (pausedForSpeech) {
      pausedForSpeech = false;
      if (wantListen) startSource();
    }
    renderControls();
  }

  // ---- listening
  function makeSource() {
    let me = null;
    const common = {
      onPartial: (text, spoken) => { if (source === me) onPartial(text, spoken); },
      onSegment, // (a source that is being replaced may still hand over its last sentence)
      onState: s => {
        if (source !== me) return; // an old source finishing after it was replaced
        if (s === 'stopped' && !pausedForSpeech) { wantListen = false; releaseWake(); onPartial('', null); }
        renderControls();
      },
      onError: code => {
        if (code === 'nospeech') return;
        if (code === 'azsetup') { offerSetup(); return; }
        showHint(speechErrorText(code));
      },
    };
    me = autoMode()
      ? createAzureSource({
        key: settings.get('speechKey'), region: settings.get('speechRegion'), candidates: candidates(),
        workletUrl: new URL('./speech-processor.js', location.href).href, ...common,
      })
      : createWebSpeechSource({ langId: from(), noisy: noiseMode, ...common });
    return me;
  }

  function startSource() {
    source = makeSource();
    source.start();
  }

  function toggle() {
    unlock();
    if (wantListen) { stopListening(); return; }
    if (autoMode() && !azureReady()) { offerSetup(); return; }
    if (!autoMode() && !canRecognize()) { showHint(t('micUnsupported')); return; }
    app.stopOtherMics('interpreter');
    stopSpeaking();
    hint.hidden = true;
    wantListen = true;
    state.session = { id: null, since: Date.now() };
    startSource();
    holdWake();
    renderControls();
  }

  function stopListening() {
    wantListen = false;
    pausedForSpeech = false;
    speechQueue.length = 0;
    source?.stop();
    releaseWake();
    renderControls();
  }

  /** Direction changed while listening: start again with the new languages. */
  function restartIfListening() {
    if (!wantListen) return;
    const old = source;
    source = null; // (so that the old source's "stopped" does not turn the interpreter off)
    old?.abort();
    startSource();
  }

  // the screen stays on while interpreting (iOS 16.4+, Chrome)
  async function holdWake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
    if (!wantListen) releaseWake();
  }
  function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }

  // ---- languages
  async function chooseFrom() {
    const id = await pickLanguage({ title: t('speakerLanguage'), current: from(), allowAuto: true });
    if (!id) return;
    if (id === AUTO) {
      if (!azureReady()) { offerSetup(); return; }
      const picked = await pickCandidates();
      if (!picked) return;
      settings.set('interpLangs', picked);
      settings.set('interpFrom', AUTO);
    } else {
      if (id === to()) settings.set('interpTo', from() === AUTO ? (candidates().find(c => c !== id) ?? 'en') : from());
      settings.set('interpFrom', id);
    }
    if (autoMode()) preloadSdk();
    renderLangs();
    restartIfListening();
  }

  async function chooseTo() {
    const id = await pickLanguage({ title: t('listenerLanguage'), current: to() });
    if (!id) return;
    if (id === from()) settings.set('interpFrom', to());
    settings.set('interpTo', id);
    renderLangs();
    restartIfListening();
  }

  function swap() {
    if (autoMode()) { toast(t('interpAutoNoSwap')); return; }
    const f = from();
    settings.set('interpFrom', to());
    settings.set('interpTo', f);
    renderLangs();
    restartIfListening();
  }

  /** The languages the speakers may use (Detect automatically). Resolves with the ids, or null. */
  function pickCandidates() {
    const chosen = new Set(candidates().length ? candidates() : [to(), 'en']);
    const ui = uiLang();
    const sorted = [...LANGUAGES].sort((a, b) => (chosen.has(b.id) - chosen.has(a.id)) || langName(a.id, ui).localeCompare(langName(b.id, ui), ui));
    return openSheet({
      title: t('autoLanguages'),
      className: 'sheet-langs',
      build: close => {
        const count = h('p', { class: 'note' });
        const done = h('button', { type: 'button', class: 'btn btn-primary wide', 'data-role': 'cands-done', onClick: () => close([...chosen]) }, t('done'));
        const update = () => {
          count.textContent = t('autoLanguagesNote', { n: chosen.size, max: AZURE_MAX_LANGUAGES });
          done.disabled = chosen.size < 1;
        };
        const rows = sorted.map(l => {
          const box = h('input', {
            type: 'checkbox', checked: chosen.has(l.id), dataset: { lang: l.id },
            onChange: () => {
              if (box.checked && chosen.size >= AZURE_MAX_LANGUAGES) { box.checked = false; toast(t('autoLanguagesMax', { max: AZURE_MAX_LANGUAGES })); return; }
              if (box.checked) chosen.add(l.id); else chosen.delete(l.id);
              update();
            },
          });
          return h('label', { class: 'cand-row' }, box, h('span', { class: 'lang-name' }, langName(l.id, ui)),
            l.native !== langName(l.id, ui) ? h('span', { class: 'lang-native', lang: l.speech }, l.native) : null);
        });
        update();
        return [count, h('div', { class: 'cand-list' }, ...rows), h('div', { class: 'cand-foot' }, done)];
      },
    });
  }

  async function offerSetup() {
    if (await confirmSheet({ title: t('autoNeedsAzureTitle'), message: t('autoNeedsAzure'), ok: t('openSettings') })) app.navigate('settings');
  }

  let sdkLoading = null;
  const preloadSdk = () => { if (azureReady()) sdkLoading ??= loadSpeechSdk().catch(() => { sdkLoading = null; }); };

  const showHint = text => { hint.textContent = text; hint.hidden = false; };

  // ---- rendering
  function segmentEl(seg) {
    const lf = lang(seg.from), lt = lang(seg.to);
    const failed = seg.status === 'error';
    return h('article', { class: `seg${failed ? ' error' : ''}`, 'data-id': seg.id },
      h('p', { class: 'seg-meta' }, h('span', { class: 'seg-badge' }, `${langLabel(seg.from)} → ${langLabel(seg.to)}`)),
      h('p', { class: 'seg-src', lang: lf?.speech, dir: lf?.rtl ? 'rtl' : 'auto' }, seg.src),
      failed
        ? h('p', { class: 'seg-out error' }, translateErrorText(seg.error), ' ', h('button', { type: 'button', class: 'link-btn', onClick: () => { translate(seg); renderSegment(seg); } }, t('tryAgain')))
        : h('p', { class: `seg-out${seg.out ? '' : ' pending'}`, lang: lt?.speech, dir: lt?.rtl ? 'rtl' : 'auto' }, seg.out || t('translating')),
      seg.out ? h('button', {
        type: 'button', class: 'bubble-say', 'aria-label': t('listen'), title: t('listen'),
        onClick: () => { unlock(); speechQueue.push(seg); drainSpeech(); },
      }, icon('speak')) : null);
  }

  const partialEl = h('article', { class: 'seg live', hidden: true },
    h('p', { class: 'seg-meta' }, h('span', { class: 'seg-badge' })),
    h('p', { class: 'seg-src' }),
    h('p', { class: 'seg-out' }));

  function renderSegment(seg) {
    const old = feed.querySelector(`.seg[data-id="${seg.id}"]`);
    if (old) old.replaceWith(segmentEl(seg));
  }

  function renderPartial() {
    const on = !!partial.text.trim();
    partialEl.hidden = !on;
    if (on) {
      const lf = lang(partial.from), target = targetFor(partial.from, opts()), lt = lang(target);
      partialEl.children[0].firstChild.textContent = `${langLabel(partial.from)} → ${langLabel(target)}`;
      Object.assign(partialEl.children[1], { textContent: partial.text, lang: lf?.speech ?? '' });
      Object.assign(partialEl.children[2], { textContent: partial.out || '…', lang: lt?.speech ?? '' });
    }
    scrollDown();
  }

  function renderFeed() {
    const items = state.segments.map(segmentEl);
    if (!items.length) items.push(h('p', { class: 'conv-empty interp-empty' }, t('interpEmpty')));
    feed.replaceChildren(...items, partialEl);
    renderPartial();
  }

  let stick = true; // follow new sentences unless the user scrolled up to read
  feed.addEventListener('scroll', () => { stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60; }, { passive: true });
  const scrollDown = () => { if (stick) feed.scrollTop = feed.scrollHeight; };

  function renderLangs() {
    fromBtn.replaceChildren(h('span', {}, autoMode() ? t('autoDetect') : langLabel(from())), icon('chevron'));
    fromBtn.setAttribute('aria-label', `${t('speakerLanguage')}: ${autoMode() ? t('autoDetect') : langLabel(from())}`);
    toBtn.replaceChildren(h('span', {}, langLabel(to())), icon('chevron'));
    toBtn.setAttribute('aria-label', `${t('listenerLanguage')}: ${langLabel(to())}`);
    swapBtn.disabled = autoMode();
    note.textContent = autoMode()
      ? t('interpAutoNote', { langs: candidates().map(langLabel).join(', '), to: langLabel(to()) })
      : t('interpFixedNote', { from: langLabel(from()), to: langLabel(to()) });
    renderControls();
  }

  function renderControls() {
    const on = wantListen;
    mic.classList.toggle('listening', on);
    mic.setAttribute('aria-pressed', on ? 'true' : 'false');
    mic.replaceChildren(icon(on ? 'stop' : 'mic'));
    mic.setAttribute('aria-label', on ? t('interpStop') : t('interpStart'));
    mic.title = mic.getAttribute('aria-label');
    micLabel.textContent = !on ? t('interpStart') : pausedForSpeech ? t('interpSpeaking') : t('interpListening');
    speakBtn.classList.toggle('on', settings.get('interpSpeak'));
    speakBtn.setAttribute('aria-pressed', settings.get('interpSpeak') ? 'true' : 'false');
  }

  const unwatch = settings.onChange(key => { if (key === '*' || key === 'speechKey' || key === 'speechRegion') renderLangs(); });

  renderLangs();
  renderFeed();

  return {
    el,
    state,
    show() { renderLangs(); if (autoMode()) preloadSdk(); },
    hide() { stopListening(); },
    stopMic() { stopListening(); },
    destroy() { live.cancel(); unwatch(); wantListen = false; source?.abort(); releaseWake(); },
    get debug() {
      return {
        listening: wantListen, paused: pausedForSpeech, partial: { ...partial },
        segments: state.segments.map(({ src, out, from: f, to: tt, status }) => ({ src, out, from: f, to: tt, status })),
      };
    },
  };
}
