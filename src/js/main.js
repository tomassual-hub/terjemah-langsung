// Terjemah Langsung: boot, tabs (hash router), theme, offline badge and the service worker.
import { $, h, icon } from './core/dom.js';
import { resolveLocale, setLocale, t } from './core/i18n.js';
import { history, settings } from './core/store.js';
import { createEngine } from './translate/engine.js';
import { createTranslateView } from './ui/translate-view.js';
import { createConversationView } from './ui/conversation-view.js';
import { createHistoryView } from './ui/history-view.js';
import { createSettingsView } from './ui/settings-view.js';
import { toast } from './ui/common.js';
import { stopSpeaking } from './speech/speaker.js';

const TABS = [
  { id: 'translate', icon: 'languages', label: 'tabTranslate' },
  { id: 'conversation', icon: 'chat', label: 'tabConversation' },
  { id: 'history', icon: 'history', label: 'tabHistory' },
  { id: 'settings', icon: 'settings', label: 'tabSettings' },
];
const FACTORIES = { translate: createTranslateView, conversation: createConversationView, history: createHistoryView, settings: createSettingsView };

const engine = createEngine({ getSettings: () => settings.all() });
const states = {}; // what each screen keeps across a rebuild (text being translated, the conversation, the history search)
let views = {};
let current = null;

const app = {
  engine,
  /** Only one microphone at a time: the other screen's is stopped. */
  stopOtherMics(except) { for (const [id, v] of Object.entries(views)) if (id !== except) v.stopMic?.(); },
  openInTranslator(entry) {
    navigate('translate');
    views.translate.load(entry);
  },
  /** The interface language changed (or everything was reset): build the screens again, keeping what is on them. */
  relocalize() { build(); applyTheme(); },
  applyTheme,
};

function applyTheme() {
  const pref = settings.get('theme');
  const dark = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1115' : '#f4f5f8');
}

function build() {
  const locale = setLocale(resolveLocale(settings.get('uiLang')));
  document.documentElement.lang = locale === 'en' ? 'en' : 'ms';
  document.title = t('appName');
  for (const [id, v] of Object.entries(views)) { states[id] = v.state ?? states[id]; v.destroy?.(); }
  views = {};
  for (const tab of TABS) views[tab.id] = FACTORIES[tab.id](app, states[tab.id]);
  for (const [id, v] of Object.entries(views)) if (v.state) states[id] = v.state;

  $('#app-title').textContent = t('appName');
  $('#net-badge').replaceChildren(icon('wifi-off'), h('span', {}, t('offline')));
  $('#view').replaceChildren(...Object.values(views).map(v => v.el));
  $('#tabs').replaceChildren(...TABS.map(tab => h('a', {
    // switch at once (the hash follows; its hashchange then finds the screen already shown)
    href: `#/${tab.id}`, class: 'tab', 'data-tab': tab.id, onClick: () => { if (tab.id === current) views[tab.id].show?.(); else show(tab.id); },
  }, icon(tab.icon), h('span', {}, t(tab.label)))));
  const was = current;
  current = null;
  show(was || routeFromHash());
}

const routeFromHash = () => {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return FACTORIES[id] ? id : 'translate';
};

function navigate(id) {
  if (location.hash !== `#/${id}`) location.hash = `#/${id}`;
  show(id);
}

function show(id) {
  if (id === current) return;
  if (current) views[current]?.hide?.();
  current = id;
  for (const [vid, v] of Object.entries(views)) v.el.hidden = vid !== id;
  for (const a of document.querySelectorAll('.tab')) {
    if (a.dataset.tab === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.documentElement.dataset.view = id;
  views[id].show?.();
}

function watchNetwork() {
  const set = () => document.documentElement.toggleAttribute('data-offline', navigator.onLine === false);
  addEventListener('online', () => { set(); views.translate?.retry(); });
  addEventListener('offline', set);
  set();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast(t('updateReady'), { action: { label: t('reload'), run: () => location.reload() } });
  });
}

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  build();
  addEventListener('hashchange', () => show(routeFromHash()));
  // the microphone and the voice stop when the app goes to the background (iOS would cut them off anyway)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { for (const v of Object.values(views)) v.stopMic?.(); stopSpeaking(); }
  });
  watchNetwork();
  registerWorker();
  // for the tests (and curious people): the app's state, read only
  window.__tl = { engine, settings, history, get views() { return views; }, get current() { return current; } };
}

boot();
