// History: every translation that stood still for a moment, newest first; favourites are kept when the rest is cleared.
import { h, icon, iconButton } from '../core/dom.js';
import { t, uiLang } from '../core/i18n.js';
import { lang } from '../core/languages.js';
import { history, settings } from '../core/store.js';
import { speak, unlock } from '../speech/speaker.js';
import { confirmSheet, copyText, langLabel, toast } from './common.js';

export function createHistoryView(app, state = { query: '', favOnly: false }) {
  const search = h('input', {
    type: 'search', class: 'text-input', placeholder: t('searchHistory'), 'aria-label': t('searchHistory'), value: state.query,
    autocomplete: 'off', onInput: () => { state.query = search.value; render(); },
  });
  const allChip = h('button', { type: 'button', class: 'chip', onClick: () => { state.favOnly = false; render(); } }, t('all'));
  const favChip = h('button', { type: 'button', class: 'chip', onClick: () => { state.favOnly = true; render(); } }, icon('star'), t('favourites'));
  const clearBtn = h('button', { type: 'button', class: 'link-btn danger', onClick: () => clearAll() }, t('clearHistory'));
  const list = h('div', { class: 'hist-list' });
  const offNote = h('p', { class: 'note', hidden: true }, t('historyOffNote'));

  const el = h('section', { class: 'view view-history', 'data-view': 'history', 'aria-label': t('tabHistory') },
    h('div', { class: 'search-wrap' }, icon('search'), search),
    h('div', { class: 'chips' }, allChip, favChip, h('span', { class: 'grow' }), clearBtn),
    offNote,
    list);

  const fmt = ts => {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const locale = uiLang() === 'en' ? 'en-GB' : 'ms-MY';
    return sameDay ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  };

  function item(e) {
    const fl = lang(e.from), tl = lang(e.to);
    return h('article', { class: 'hist-item', 'data-id': e.id },
      h('button', { type: 'button', class: 'hist-open', 'aria-label': t('openInTranslator'), onClick: () => app.openInTranslator(e) },
        h('div', { class: 'hist-meta' },
          h('span', { class: 'hist-langs' }, `${fl ? langLabel(e.from) : t('autoDetect')} → ${tl ? langLabel(e.to) : e.to}`),
          e.mode === 'speech' || e.mode === 'conversation' || e.mode === 'interpreter' ? icon({ conversation: 'chat', interpreter: 'interpreter' }[e.mode] ?? 'mic') : null,
          h('span', { class: 'hist-time' }, fmt(e.at))),
        h('p', { class: 'hist-src', lang: fl?.speech, dir: fl?.rtl ? 'rtl' : 'auto' }, e.src),
        h('p', { class: 'hist-out', lang: tl?.speech, dir: tl?.rtl ? 'rtl' : 'auto' }, e.out)),
      h('div', { class: 'hist-actions' },
        iconButton('speak', t('listen'), () => { unlock(); if (tl) speak(e.out, tl.speech, { rate: settings.get('speechRate') }); }, { class: 'small' }),
        iconButton('copy', t('copy'), () => copyText(e.out), { class: 'small' }),
        iconButton('star', e.fav ? t('unfavourite') : t('favourite'), () => { history.toggleFav(e.id); render(); }, { class: `small fav-btn${e.fav ? ' on' : ''}`, 'aria-pressed': e.fav ? 'true' : 'false' }),
        iconButton('trash', t('delete'), () => { history.remove(e.id); render(); toast(t('deleted')); }, { class: 'small' })));
  }

  function render() {
    const q = state.query.trim().toLocaleLowerCase();
    const all = history.list();
    const shown = all.filter(e => (!state.favOnly || e.fav) && (!q || e.src.toLocaleLowerCase().includes(q) || e.out.toLocaleLowerCase().includes(q)));
    allChip.classList.toggle('on', !state.favOnly);
    allChip.setAttribute('aria-pressed', state.favOnly ? 'false' : 'true');
    favChip.classList.toggle('on', state.favOnly);
    favChip.setAttribute('aria-pressed', state.favOnly ? 'true' : 'false');
    clearBtn.hidden = !all.some(e => !e.fav);
    offNote.hidden = settings.get('saveHistory');
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty-state' }, icon(state.favOnly ? 'star' : 'history'),
        h('p', {}, q ? t('noMatches') : state.favOnly ? t('noFavourites') : t('noHistory'))));
      return;
    }
    list.replaceChildren(...shown.map(item));
  }

  async function clearAll() {
    if (!(await confirmSheet({ title: t('clearHistory'), message: t('clearHistoryQ'), ok: t('clear'), danger: true }))) return;
    history.clear({ keepFavourites: true });
    render();
    toast(t('historyCleared'));
  }

  render();
  return { el, state, show: render, hide() {}, destroy() {} };
}
