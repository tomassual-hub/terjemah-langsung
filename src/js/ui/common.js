// Pieces every screen uses: the toast, bottom sheets (the language picker, confirmations), copy and share.
// Sheets are plain overlays, not history entries, so there is no back-button race to get wrong.
import { $, h, icon, iconButton } from '../core/dom.js';
import { t, uiLang } from '../core/i18n.js';
import { AUTO, LANGUAGES, langName, lang } from '../core/languages.js';
import { settings } from '../core/store.js';

let toastTimer = null;

/** A short message at the bottom of the screen; `action` adds one button ({ label, run }). Patched in place, never re-rendered. */
export function toast(message, { action = null, ms = 3200, kind = '' } = {}) {
  const root = $('#toast-root');
  if (!root) return;
  clearTimeout(toastTimer);
  const box = h('div', { class: `toast ${kind}`.trim(), role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-text' }, message),
    action ? h('button', { type: 'button', class: 'toast-btn', onClick: () => { root.replaceChildren(); action.run(); } }, action.label) : null);
  root.replaceChildren(box);
  toastTimer = setTimeout(() => box.remove(), action ? Math.max(ms, 6000) : ms);
}

/**
 * Opens a bottom sheet. `build(close)` returns its content; the promise resolves with what close() was given (null when it was
 * dismissed with the backdrop, the X or Escape).
 */
export function openSheet({ title, build, className = '' }) {
  const root = $('#sheet-root');
  return new Promise(resolve => {
    let done = false;
    const previous = document.activeElement;
    const close = value => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 160);
      if (previous && typeof previous.focus === 'function' && previous.isConnected) try { previous.focus({ preventScroll: true }); } catch {}
      resolve(value ?? null);
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    const sheet = h('div', { class: `sheet ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title' }, title), iconButton('x', t('close'), () => close(null), { class: 'sheet-close' })),
      h('div', { class: 'sheet-body' }, build(close)));
    const backdrop = h('div', { class: 'sheet-backdrop', onClick: e => { if (e.target === backdrop) close(null); } }, sheet);
    root.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      const first = sheet.querySelector('[data-autofocus]') || sheet.querySelector('.sheet-close');
      // (no autofocus of the search field on touch screens: the keyboard would cover half the list)
      if (first && !(first.matches('input') && matchMedia('(pointer: coarse)').matches)) first.focus({ preventScroll: true });
    });
  });
}

/** A yes/no question in a sheet. Resolves true only for the confirming button. */
export function confirmSheet({ title, message, ok, danger = false }) {
  return openSheet({
    title,
    className: 'sheet-confirm',
    build: close => [
      h('p', { class: 'confirm-text' }, message),
      h('div', { class: 'confirm-actions' },
        h('button', { type: 'button', class: 'btn', onClick: () => close(false) }, t('cancel')),
        h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, 'data-autofocus': '', onClick: () => close(true) }, ok)),
    ],
  }).then(v => v === true);
}

const sortKey = l => (langName(l.id, uiLang()) || '').toLocaleLowerCase();

/** The language picker. Resolves with the chosen id, or null. */
export function pickLanguage({ title, current, allowAuto = false }) {
  const ui = uiLang();
  const all = [...LANGUAGES].sort((a, b) => sortKey(a).localeCompare(sortKey(b), ui));
  const recent = settings.get('recent').filter(id => lang(id));
  return openSheet({
    title,
    className: 'sheet-langs',
    build: close => {
      const list = h('div', { class: 'lang-list', role: 'listbox', 'aria-label': title });
      const row = (id, primary, secondary) => h('button', {
        type: 'button', class: `lang-row${id === current ? ' current' : ''}`, role: 'option', 'aria-selected': id === current ? 'true' : 'false',
        dataset: { lang: id }, onClick: () => { settings.touchRecent(id); close(id); },
      }, h('span', { class: 'lang-main' }, h('span', { class: 'lang-name' }, primary), secondary ? h('span', { class: 'lang-native', lang: lang(id)?.speech, dir: lang(id)?.rtl ? 'rtl' : null }, secondary) : null),
      id === current ? icon('check') : null);
      const langRow = l => row(l.id, langName(l.id, ui), l.native !== langName(l.id, ui) ? l.native : null);

      const render = q => {
        const needle = q.trim().toLocaleLowerCase();
        const match = l => !needle || [l.ms, l.en, l.native, l.id].some(s => s.toLocaleLowerCase().includes(needle));
        const items = [];
        if (allowAuto && !needle) items.push(row(AUTO, t('autoDetect'), null));
        if (!needle && recent.length) {
          items.push(h('div', { class: 'lang-section' }, t('recent')));
          for (const id of recent) items.push(langRow(lang(id)));
          items.push(h('div', { class: 'lang-section' }, t('allLanguages')));
        }
        const found = all.filter(match);
        for (const l of found) items.push(langRow(l));
        if (!found.length) items.push(h('p', { class: 'empty' }, t('noLanguageFound')));
        list.replaceChildren(...items);
      };
      const search = h('input', {
        type: 'search', class: 'text-input lang-search', placeholder: t('searchLanguage'), 'aria-label': t('searchLanguage'),
        autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'data-autofocus': '', onInput: e => render(e.target.value),
      });
      render('');
      return [h('div', { class: 'search-wrap' }, icon('search'), search), list];
    },
  });
}

/** The label of a language button: the language's name in the interface language. */
export const langLabel = id => (id === AUTO ? t('autoDetect') : langName(id, uiLang()));

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'));
    return true;
  } catch {
    toast(t('copyFailed'), { kind: 'error' });
    return false;
  }
}

export async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return true; } catch (err) { if (err?.name === 'AbortError') return false; }
  }
  return copyText(text);
}

/** A full-screen view of a text in big letters, to show it to someone. Tap anywhere to close. */
export function showLarge(text, langId) {
  const l = lang(langId);
  const box = h('div', { class: 'large-view', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('showLarge'), tabindex: '-1' },
    h('p', { class: 'large-text', lang: l?.speech, dir: l?.rtl ? 'rtl' : 'auto' }, text),
    h('p', { class: 'large-hint' }, t('tapToClose')));
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  $('#sheet-root').append(box);
  box.focus();
}

/** A message for a translation error, by code (see translate/providers.js). */
export function translateErrorText(err) {
  const code = err?.code || 'server';
  const p = settings.get('provider');
  if (code === 'quota' && p === 'mymemory') return t('errQuotaMyMemory');
  if (code === 'auth' || code === 'nokey') return t(code === 'nokey' ? 'errNoKey' : 'errAuth', { service: providerName(p) });
  return t(`err_${code}`) || t('err_server');
}

export const providerName = id => ({ mymemory: 'MyMemory', google: 'Google Cloud', microsoft: 'Microsoft Translator' })[id] || id;

/** A message for a speech recognition error, by code (see speech/recognizer.js). */
export const speechErrorText = code => t(`mic_${code}`) || t('mic_failed');
