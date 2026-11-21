// The languages the app offers. Each one carries the code every service knows it by:
//   speech: the BCP-47 tag for speech recognition and speech output (Web Speech API; on iPhone that is Siri's dictation)
//   mm: MyMemory, g: Google Cloud Translation v2, az: Microsoft Translator
// `rtl` languages are shown right to left. Whether speech recognition exists for a language is up to the device: the
// recognizer reports "language-not-supported" and the app says so.

export const LANGUAGES = [
  { id: 'ms', ms: 'Bahasa Melayu', en: 'Malay', native: 'Bahasa Melayu', speech: 'ms-MY', mm: 'ms', g: 'ms', az: 'ms' },
  { id: 'en', ms: 'Inggeris', en: 'English', native: 'English', speech: 'en-US', mm: 'en', g: 'en', az: 'en' },
  { id: 'zh', ms: 'Cina (Ringkas)', en: 'Chinese (Simplified)', native: '中文（简体）', speech: 'zh-CN', mm: 'zh-CN', g: 'zh-CN', az: 'zh-Hans', noSpace: true },
  { id: 'zh-TW', ms: 'Cina (Tradisional)', en: 'Chinese (Traditional)', native: '中文（繁體）', speech: 'zh-TW', mm: 'zh-TW', g: 'zh-TW', az: 'zh-Hant', noSpace: true },
  { id: 'ta', ms: 'Tamil', en: 'Tamil', native: 'தமிழ்', speech: 'ta-IN', mm: 'ta', g: 'ta', az: 'ta' },
  { id: 'id', ms: 'Indonesia', en: 'Indonesian', native: 'Bahasa Indonesia', speech: 'id-ID', mm: 'id', g: 'id', az: 'id' },
  { id: 'th', ms: 'Thai', en: 'Thai', native: 'ไทย', speech: 'th-TH', mm: 'th', g: 'th', az: 'th', noSpace: true },
  { id: 'vi', ms: 'Vietnam', en: 'Vietnamese', native: 'Tiếng Việt', speech: 'vi-VN', mm: 'vi', g: 'vi', az: 'vi' },
  { id: 'tl', ms: 'Filipino', en: 'Filipino', native: 'Filipino', speech: 'fil-PH', mm: 'tl', g: 'tl', az: 'fil' },
  { id: 'my', ms: 'Myanmar', en: 'Burmese', native: 'မြန်မာ', speech: 'my-MM', mm: 'my', g: 'my', az: 'my', noSpace: true },
  { id: 'km', ms: 'Khmer', en: 'Khmer', native: 'ខ្មែរ', speech: 'km-KH', mm: 'km', g: 'km', az: 'km', noSpace: true },
  { id: 'ja', ms: 'Jepun', en: 'Japanese', native: '日本語', speech: 'ja-JP', mm: 'ja', g: 'ja', az: 'ja', noSpace: true },
  { id: 'ko', ms: 'Korea', en: 'Korean', native: '한국어', speech: 'ko-KR', mm: 'ko', g: 'ko', az: 'ko' },
  { id: 'hi', ms: 'Hindi', en: 'Hindi', native: 'हिन्दी', speech: 'hi-IN', mm: 'hi', g: 'hi', az: 'hi' },
  { id: 'bn', ms: 'Bengali', en: 'Bengali', native: 'বাংলা', speech: 'bn-BD', mm: 'bn', g: 'bn', az: 'bn' },
  { id: 'ur', ms: 'Urdu', en: 'Urdu', native: 'اردو', speech: 'ur-PK', mm: 'ur', g: 'ur', az: 'ur', rtl: true },
  { id: 'ne', ms: 'Nepal', en: 'Nepali', native: 'नेपाली', speech: 'ne-NP', mm: 'ne', g: 'ne', az: 'ne' },
  { id: 'ar', ms: 'Arab', en: 'Arabic', native: 'العربية', speech: 'ar-SA', mm: 'ar', g: 'ar', az: 'ar', rtl: true },
  { id: 'fa', ms: 'Parsi', en: 'Persian', native: 'فارسی', speech: 'fa-IR', mm: 'fa', g: 'fa', az: 'fa', rtl: true },
  { id: 'tr', ms: 'Turki', en: 'Turkish', native: 'Türkçe', speech: 'tr-TR', mm: 'tr', g: 'tr', az: 'tr' },
  { id: 'ru', ms: 'Rusia', en: 'Russian', native: 'Русский', speech: 'ru-RU', mm: 'ru', g: 'ru', az: 'ru' },
  { id: 'uk', ms: 'Ukraine', en: 'Ukrainian', native: 'Українська', speech: 'uk-UA', mm: 'uk', g: 'uk', az: 'uk' },
  { id: 'fr', ms: 'Perancis', en: 'French', native: 'Français', speech: 'fr-FR', mm: 'fr', g: 'fr', az: 'fr' },
  { id: 'de', ms: 'Jerman', en: 'German', native: 'Deutsch', speech: 'de-DE', mm: 'de', g: 'de', az: 'de' },
  { id: 'es', ms: 'Sepanyol', en: 'Spanish', native: 'Español', speech: 'es-ES', mm: 'es', g: 'es', az: 'es' },
  { id: 'pt', ms: 'Portugis', en: 'Portuguese', native: 'Português', speech: 'pt-BR', mm: 'pt', g: 'pt', az: 'pt' },
  { id: 'it', ms: 'Itali', en: 'Italian', native: 'Italiano', speech: 'it-IT', mm: 'it', g: 'it', az: 'it' },
  { id: 'nl', ms: 'Belanda', en: 'Dutch', native: 'Nederlands', speech: 'nl-NL', mm: 'nl', g: 'nl', az: 'nl' },
  { id: 'pl', ms: 'Poland', en: 'Polish', native: 'Polski', speech: 'pl-PL', mm: 'pl', g: 'pl', az: 'pl' },
];

/** The pseudo language "detect automatically" (typing only: speech recognition needs to know the language). */
export const AUTO = 'auto';

const BY_ID = new Map(LANGUAGES.map(l => [l.id, l]));
export const lang = id => BY_ID.get(id) ?? null;
export const isLang = id => BY_ID.has(id);

/** The display name of a language in the interface language. */
export const langName = (id, ui = 'ms') => (id === AUTO ? null : BY_ID.get(id)?.[ui === 'en' ? 'en' : 'ms'] ?? id);

/**
 * The language a service reported as detected, as one of our ids (or null).
 * Services answer in their own codes ("zh-Hans", "zh-CN", "fil", "id"), with or without a region.
 */
export function fromServiceCode(code, service) {
  if (!code || typeof code !== 'string') return null;
  const c = code.toLowerCase();
  const exact = LANGUAGES.find(l => [l[service], l.id, l.mm, l.g, l.az].some(x => x && x.toLowerCase() === c));
  if (exact) return exact.id;
  const base = c.split('-')[0];
  if (base === 'zh') return /hant|tw|hk/.test(c) ? 'zh-TW' : 'zh';
  if (base === 'fil') return 'tl';
  return LANGUAGES.find(l => l.id === base)?.id ?? null;
}
