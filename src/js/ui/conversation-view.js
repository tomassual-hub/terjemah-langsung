// Conversation: two people, one phone. Each half has its own language and microphone; whatever one person says appears in
// their half as they speak and, translated live, in the other person's half (which can be upside down for sitting opposite).
// When the speaker pauses, the translation is read aloud in the other person's language.
import { h, icon, iconButton } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { lang } from '../core/languages.js';
import { history, settings } from '../core/store.js';
import { createLive } from '../translate/engine.js';
import { canRecognize, createRecognizer } from '../speech/recognizer.js';
import { canSpeak, speak, stopSpeaking, unlock } from '../speech/speaker.js';
import { confirmSheet, langLabel, pickLanguage, speechErrorText, translateErrorText } from './common.js';

const SILENCE_MS = 1800; // a pause this long ends a turn
const MAX_MESSAGES = 60;

/** `state.messages` survives a rebuild of the screen. Message: { id, by: 'a'|'b', src, out, from, to, status, error? } */
export function createConversationView(app, state = { messages: [] }) {
  const sides = { a: null, b: null };
  let active = null; // { side, msg, rec, silence }
  let typing = !canRecognize();
  let seq = 0;

  const langOf = side => settings.get(side === 'a' ? 'convA' : 'convB');
  const otherSide = side => (side === 'a' ? 'b' : 'a');

  function buildSide(side) {
    const langBtn = h('button', { type: 'button', class: 'lang-btn', 'data-role': `conv-${side}`, onClick: () => choose(side) });
    const log = h('div', { class: 'conv-log', 'aria-live': 'polite' });
    const mic = h('button', { type: 'button', class: 'mic-btn conv-mic', 'data-side': side, 'aria-pressed': 'false', onClick: () => toggle(side) }, icon('mic'));
    const field = h('input', {
      type: 'text', class: 'text-input conv-input', enterKeyHint: 'send', autocomplete: 'off',
      onKeydown: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendTyped(side); } },
    });
    const send = h('button', { type: 'button', class: 'btn btn-primary conv-send', onClick: () => sendTyped(side) }, t('send'));
    const typeRow = h('div', { class: 'conv-type' }, field, send);
    const hint = h('p', { class: 'mic-hint conv-hint', hidden: true });
    const panel = h('div', { class: `conv-side side-${side}`, 'data-side': side },
      h('div', { class: 'conv-head' }, langBtn),
      log,
      hint,
      typeRow,
      h('div', { class: 'conv-foot' }, mic));
    sides[side] = { panel, langBtn, log, mic, field, typeRow, hint };
    return panel;
  }

  const faceBtn = iconButton('rotate', t('faceToFace'), () => { settings.set('faceToFace', !settings.get('faceToFace')); renderLayout(); }, { class: 'small' });
  const swapBtn = iconButton('swap', t('swapLanguages'), () => {
    const a = langOf('a');
    settings.set('convA', langOf('b'));
    settings.set('convB', a);
    renderAll();
  }, { class: 'small' });
  const keysBtn = iconButton('keyboard', t('typeInstead'), () => { typing = !typing; renderLayout(); }, { class: 'small' });
  const speakToggle = iconButton('speak', t('autoSpeak'), () => { settings.set('autoSpeak', !settings.get('autoSpeak')); renderLayout(); }, { class: 'small' });
  const clearBtn = iconButton('trash', t('clearConversation'), async () => {
    if (!state.messages.length) return;
    if (await confirmSheet({ title: t('clearConversation'), message: t('clearConversationQ'), ok: t('clear'), danger: true })) {
      abortTurn();
      state.messages = [];
      renderAll();
    }
  }, { class: 'small' });

  const el = h('section', { class: 'view view-conversation', 'data-view': 'conversation', 'aria-label': t('tabConversation') },
    buildSide('b'),
    h('div', { class: 'conv-divider' }, faceBtn, swapBtn, keysBtn, speakToggle, clearBtn),
    buildSide('a'));

  // ---- live translation of the turn in progress (one at a time: newer text replaces older). A finished message is translated
  // on its own (translateFinal), so that two quick messages never cancel each other.
  const live = createLive(app.engine, {
    delay: 300,
    onState: s => {
      const msg = active?.msg;
      if (!msg || msg.final || s.text !== msg.src || s.from !== msg.from || s.to !== msg.to) return;
      msg.status = s.status;
      msg.error = s.error ?? null;
      if (s.status === 'done') msg.out = s.out;
      renderLogs();
    },
  });

  function translateFinal(msg) {
    live.cancel();
    msg.final = true;
    msg.status = 'pending';
    app.engine.translate(msg.src, msg.from, msg.to).then(
      r => { msg.out = r.text; msg.status = 'done'; msg.error = null; renderLogs(); finishMessage(msg); },
      err => { msg.status = 'error'; msg.error = err; renderLogs(); },
    );
  }

  function retry(msg) {
    msg.spoken = false;
    translateFinal(msg);
    renderLogs();
  }

  function newMessage(side, src = '') {
    const msg = { id: `m${++seq}`, by: side, src, out: '', from: langOf(side), to: langOf(otherSide(side)), status: 'idle', final: false, spoken: false };
    state.messages.push(msg);
    if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
    return msg;
  }

  /** The turn is over and translated: read it aloud and keep it. */
  async function finishMessage(msg) {
    if (msg.spoken || !state.messages.includes(msg)) return;
    msg.spoken = true;
    if (!msg.out.trim()) return;
    if (settings.get('saveHistory')) history.put({ from: msg.from, to: msg.to, src: msg.src, out: msg.out, mode: 'conversation', provider: settings.get('provider') });
    if (settings.get('autoSpeak') && canSpeak() && !active) {
      const tag = lang(msg.to)?.speech;
      if (tag) await speak(msg.out, tag, { rate: settings.get('speechRate') });
    }
  }

  async function toggle(side) {
    unlock();
    if (active?.side === side) { active.rec.stop(); return; }
    if (active) abortTurn(true);
    if (!canRecognize()) { typing = true; renderLayout(); showHint(side, t('micUnsupported')); return; }
    stopSpeaking();
    app.stopOtherMics('conversation');
    hideHints();
    const msg = newMessage(side);
    const turn = { side, msg, rec: null, silence: null };
    active = turn;
    turn.rec = createRecognizer({
      lang: lang(msg.from)?.speech,
      continuous: true,
      onText: ({ text, final }) => {
        if (active !== turn && !final) return;
        if (msg.final) return;
        msg.src = text;
        clearTimeout(turn.silence);
        if (!final) {
          turn.silence = setTimeout(() => turn.rec.stop(), SILENCE_MS);
          live.update(msg.src, msg.from, msg.to);
        } else {
          if (active === turn) active = null; // (so that the translation may be read aloud at once)
          if (!text.trim()) state.messages = state.messages.filter(m => m !== msg);
          else translateFinal(msg);
        }
        renderLogs();
      },
      onState: s => {
        if (s === 'stopped' && active === turn) { clearTimeout(turn.silence); active = null; }
        renderMics();
      },
      onError: code => { if (code !== 'nospeech') showHint(side, speechErrorText(code)); },
    });
    turn.rec.start();
    renderMics();
    renderLogs();
  }

  function abortTurn(keep = false) {
    if (!active) return;
    const turn = active;
    active = null;
    clearTimeout(turn.silence);
    turn.rec.abort();
    if (!keep || !turn.msg.src.trim()) state.messages = state.messages.filter(m => m !== turn.msg);
    else if (!turn.msg.final) translateFinal(turn.msg);
    renderMics();
    renderLogs();
  }

  function sendTyped(side) {
    unlock();
    const f = sides[side].field;
    const text = f.value.trim();
    if (!text) return;
    if (active) abortTurn(true);
    f.value = '';
    const msg = newMessage(side, text);
    translateFinal(msg);
    renderLogs();
  }

  async function choose(side) {
    const id = await pickLanguage({ title: side === 'a' ? t('yourLanguage') : t('theirLanguage'), current: langOf(side) });
    if (!id) return;
    if (active) abortTurn(true);
    const key = side === 'a' ? 'convA' : 'convB';
    const otherKey = side === 'a' ? 'convB' : 'convA';
    if (id === settings.get(otherKey)) settings.set(otherKey, settings.get(key)); // the same on both sides: they swap
    settings.set(key, id);
    renderAll();
  }

  const showHint = (side, text) => { sides[side].hint.textContent = text; sides[side].hint.hidden = false; };
  const hideHints = () => { for (const s of Object.values(sides)) s.hint.hidden = true; };

  // ---- rendering
  function bubble(msg, side) {
    const mine = msg.by === side;
    const text = mine ? msg.src : msg.out;
    const l = lang(mine ? msg.from : msg.to);
    const live = msg === active?.msg;
    const failed = msg.status === 'error' && msg.final;
    let body = text;
    if (!mine && failed) body = translateErrorText(msg.error);
    else if (!mine && !text) body = '…';
    return h('div', { class: `bubble ${mine ? 'mine' : 'theirs'}${live ? ' live' : ''}${failed && !mine ? ' error' : ''}`, 'data-id': msg.id },
      h('p', { class: 'bubble-text', lang: l?.speech, dir: l?.rtl ? 'rtl' : 'auto' }, body),
      failed ? h('button', { type: 'button', class: 'link-btn', onClick: () => retry(msg) }, t('tryAgain')) : null,
      !mine && msg.out ? h('button', {
        type: 'button', class: 'bubble-say', 'aria-label': t('listen'), title: t('listen'),
        onClick: () => { unlock(); if (active) abortTurn(true); speak(msg.out, lang(msg.to)?.speech, { rate: settings.get('speechRate') }); },
      }, icon('speak')) : null);
  }

  function renderLogs() {
    for (const side of ['a', 'b']) {
      const { log } = sides[side];
      const items = state.messages.map(m => bubble(m, side));
      if (!items.length) items.push(h('p', { class: 'conv-empty', lang: lang(langOf(side))?.speech }, side === 'a' ? t('convEmptyA', { lang: langLabel(langOf('a')) }) : t('convEmptyB', { lang: langLabel(langOf('b')) })));
      log.replaceChildren(...items);
      log.scrollTop = log.scrollHeight;
    }
  }

  function renderMics() {
    for (const side of ['a', 'b']) {
      const { mic } = sides[side];
      const on = active?.side === side;
      mic.classList.toggle('listening', on);
      mic.setAttribute('aria-pressed', on ? 'true' : 'false');
      mic.replaceChildren(icon(on ? 'stop' : 'mic'));
      mic.setAttribute('aria-label', on ? t('listeningIn', { lang: langLabel(langOf(side)) }) : t('speakIn', { lang: langLabel(langOf(side)) }));
    }
  }

  function renderLayout() {
    el.classList.toggle('face', settings.get('faceToFace'));
    faceBtn.classList.toggle('on', settings.get('faceToFace'));
    faceBtn.setAttribute('aria-pressed', settings.get('faceToFace') ? 'true' : 'false');
    speakToggle.classList.toggle('on', settings.get('autoSpeak'));
    speakToggle.setAttribute('aria-pressed', settings.get('autoSpeak') ? 'true' : 'false');
    keysBtn.classList.toggle('on', typing);
    keysBtn.setAttribute('aria-pressed', typing ? 'true' : 'false');
    for (const side of ['a', 'b']) {
      const s = sides[side];
      s.typeRow.hidden = !typing;
      s.field.placeholder = t('typeIn', { lang: langLabel(langOf(side)) });
      s.field.setAttribute('aria-label', t('typeIn', { lang: langLabel(langOf(side)) }));
      s.field.setAttribute('lang', lang(langOf(side))?.speech ?? '');
    }
  }

  function renderAll() {
    for (const side of ['a', 'b']) sides[side].langBtn.replaceChildren(h('span', {}, langLabel(langOf(side))), icon('chevron'));
    sides.a.langBtn.setAttribute('aria-label', `${t('yourLanguage')}: ${langLabel(langOf('a'))}`);
    sides.b.langBtn.setAttribute('aria-label', `${t('theirLanguage')}: ${langLabel(langOf('b'))}`);
    renderLayout();
    renderMics();
    renderLogs();
  }

  renderAll();

  return {
    el,
    state,
    hide() { if (active) active.rec.stop(); },
    stopMic() { if (active) active.rec.stop(); },
    destroy() { live.cancel(); if (active) abortTurn(); },
    get debug() { return { active: active?.side ?? null, messages: state.messages.map(({ by, src, out, status, from, to }) => ({ by, src, out, status, from, to })) }; },
  };
}
