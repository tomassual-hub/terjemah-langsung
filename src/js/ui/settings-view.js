// Settings: interface language and theme, the translation service (and its key), speech, history, help and the data on this device.
import { h, icon } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { settings, wipeAll } from '../core/store.js';
import { canRecognize } from '../speech/recognizer.js';
import { canSpeak } from '../speech/speaker.js';
import { validRegion } from '../speech/interpreter-sources.js';
import { confirmSheet, speechErrorText, toast, translateErrorText } from './common.js';

function segmented(name, value, options, onChange) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    ...options.map(([v, label]) => h('button', {
      type: 'button', role: 'radio', class: v === value ? 'on' : '', 'aria-checked': v === value ? 'true' : 'false', dataset: { value: v },
      onClick: () => onChange(v),
    }, label)));
}

function toggle(label, key, onChange, note) {
  const box = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: !!settings.get(key), onChange: () => { settings.set(key, box.checked); onChange?.(box.checked); } });
  return h('label', { class: 'row' }, h('span', { class: 'row-text' }, h('span', {}, label), note ? h('small', {}, note) : null), box);
}

function secretField(label, key, { placeholder = '', type = 'password', onSaved = () => {} } = {}) {
  const input = h('input', {
    type, class: 'text-input', value: settings.get(key), placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    'aria-label': label, dataset: { setting: key },
    onChange: () => { settings.set(key, input.value.trim()); onSaved(); },
  });
  const show = type === 'password' ? h('button', { type: 'button', class: 'link-btn', onClick: () => { input.type = input.type === 'password' ? 'text' : 'password'; show.textContent = input.type === 'password' ? t('show') : t('hide'); } }, t('show')) : null;
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-row' }, input, show));
}

/** Checks an Azure AI Speech key by asking for a token with it (nothing is recognised, nothing is billed). Resolves with an error code or null. */
export async function checkSpeechKey(key, region, fetchImpl = fetch) {
  if (!key || !validRegion(region)) return 'azsetup';
  try {
    const res = await fetchImpl(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout?.(15000),
    });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) return 'azauth';
    if (res.status === 429) return 'azquota';
    return 'failed';
  } catch { return 'network'; }
}

export function createSettingsView(app) {
  const el = h('section', { class: 'view view-settings', 'data-view': 'settings', 'aria-label': t('tabSettings') });

  function render() {
    const provider = settings.get('provider');
    const testOut = h('p', { class: 'test-out', 'aria-live': 'polite' });
    const runTest = async () => {
      testOut.className = 'test-out';
      testOut.textContent = t('testing');
      try {
        const r = await app.engine.translate('Good morning, how are you?', 'en', 'ms');
        testOut.className = 'test-out ok';
        testOut.textContent = `${t('testOk')} "${r.text}"`;
      } catch (err) {
        testOut.className = 'test-out bad';
        testOut.textContent = translateErrorText(err);
      }
    };
    const speechOut = h('p', { class: 'test-out', 'aria-live': 'polite' });
    const runSpeechTest = async () => {
      speechOut.className = 'test-out';
      speechOut.textContent = t('testing');
      const code = await checkSpeechKey(settings.get('speechKey'), settings.get('speechRegion'));
      speechOut.className = `test-out ${code ? 'bad' : 'ok'}`;
      speechOut.textContent = code ? speechErrorText(code) : t('testSpeechOk');
    };
    const onSaved = () => app.engine.clear(); // answers of the old key/account must not be mixed in
    const providerFields = {
      mymemory: [
        h('p', { class: 'note' }, t('mymemoryNote')),
        secretField(t('mmEmail'), 'mmEmail', { type: 'email', placeholder: 'nama@contoh.com', onSaved }),
      ],
      google: [
        h('p', { class: 'note' }, t('googleNote')),
        secretField(t('apiKey'), 'googleKey', { placeholder: 'AIza…', onSaved }),
      ],
      microsoft: [
        h('p', { class: 'note' }, t('microsoftNote')),
        secretField(t('apiKey'), 'msKey', { onSaved }),
        secretField(t('region'), 'msRegion', { type: 'text', placeholder: 'southeastasia', onSaved }),
      ],
    };

    const rate = h('input', {
      type: 'range', min: '0.5', max: '1.5', step: '0.1', value: String(settings.get('speechRate')), class: 'range', 'aria-label': t('speechRate'),
      onInput: () => { settings.set('speechRate', Number(rate.value)); rateOut.textContent = `${Number(rate.value).toFixed(1)}×`; },
    });
    const rateOut = h('output', { class: 'range-out' }, `${Number(settings.get('speechRate')).toFixed(1)}×`);

    el.replaceChildren(
      h('h2', { class: 'group-title' }, t('appearance')),
      h('div', { class: 'group' },
        h('div', { class: 'row col' }, h('span', {}, t('interfaceLanguage')),
          segmented(t('interfaceLanguage'), settings.get('uiLang'), [['auto', t('auto')], ['ms', 'Bahasa Melayu'], ['en', 'English']], v => { settings.set('uiLang', v); app.relocalize(); })),
        h('div', { class: 'row col' }, h('span', {}, t('theme')),
          segmented(t('theme'), settings.get('theme'), [['auto', t('auto')], ['light', t('light')], ['dark', t('dark')]], v => { settings.set('theme', v); app.applyTheme(); render(); }))),

      h('h2', { class: 'group-title' }, t('translationService')),
      h('div', { class: 'group' },
        h('div', { class: 'row col' },
          segmented(t('translationService'), provider, [['mymemory', t('pMyMemory')], ['google', 'Google'], ['microsoft', 'Microsoft']], v => { settings.set('provider', v); app.engine.clear(); render(); })),
        ...providerFields[provider],
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onClick: runTest }, t('testService')), testOut),
        h('p', { class: 'note' }, icon('info'), t('keysStayHere'))),

      h('h2', { class: 'group-title' }, t('azureSpeech')),
      h('div', { class: 'group', 'data-group': 'azure-speech' },
        h('p', { class: 'note' }, t('azureSpeechNote')),
        secretField(t('apiKey'), 'speechKey'),
        secretField(t('region'), 'speechRegion', { type: 'text', placeholder: 'southeastasia', onSaved: () => settings.set('speechRegion', settings.get('speechRegion').toLowerCase().replace(/s+/g, '')) }),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', 'data-role': 'test-speech', onClick: runSpeechTest }, t('testService')), speechOut)),

      h('h2', { class: 'group-title' }, t('speech')),
      h('div', { class: 'group' },
        h('div', { class: 'row' }, h('span', { class: 'row-text' }, h('span', {}, t('speechRate'))), rate, rateOut),
        toggle(t('noiseMode'), 'noiseMode', null, t('noiseModeNote')),
        toggle(t('autoSpeak'), 'autoSpeak', null, t('autoSpeakNote')),
        toggle(t('faceToFace'), 'faceToFace', null, t('faceToFaceNote')),
        h('p', { class: 'note' }, `${t('micSupport')}: ${canRecognize() ? t('yes') : t('no')} · ${t('voiceSupport')}: ${canSpeak() ? t('yes') : t('no')}`)),

      h('h2', { class: 'group-title' }, t('historyTitle')),
      h('div', { class: 'group' }, toggle(t('saveHistory'), 'saveHistory', null, t('saveHistoryNote'))),

      h('h2', { class: 'group-title' }, t('help')),
      h('div', { class: 'group help' },
        h('h3', {}, t('helpInstallTitle')), h('p', {}, t('helpInstall')),
        h('h3', {}, t('helpMicTitle')), h('p', {}, t('helpMic')),
        h('h3', {}, t('helpDictationTitle')), h('p', {}, t('helpDictation')),
        h('h3', {}, t('helpPrivacyTitle')), h('p', {}, t('helpPrivacy'))),

      h('div', { class: 'group' },
        h('button', { type: 'button', class: 'btn btn-danger wide', onClick: async () => {
          if (!(await confirmSheet({ title: t('wipeAll'), message: t('wipeAllQ'), ok: t('delete'), danger: true }))) return;
          wipeAll();
          app.engine.clear();
          app.relocalize();
          toast(t('wiped'));
        } }, t('wipeAll'))),
      h('p', { class: 'version' }, `Terjemah Langsung v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`),
    );
  }

  render();
  return { el, show: render, hide() {}, destroy() {} };
}
