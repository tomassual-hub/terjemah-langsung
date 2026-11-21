# Terjemah Langsung (Live Translate)

A web app (PWA) for iPhone and iPad (it also works on Android and desktop) that translates **live** as you type or speak.
The interface is in Malay and English.

## Features

- **Translate**: type, paste, or tap the microphone and speak. The translation updates while you are still typing or speaking.
  29 languages, auto-detect for typing, swap, listen to the original or the translation, copy, share, a large view to show
  someone, favourites.
- **Conversation**: two people, one phone. Each half has its own language and microphone. The top half is upside down for
  sitting face to face. When someone stops speaking (a 1.8 s pause), the translation is read aloud in the other language.
  Typing works too.
- **History**: everything that was translated, with search and favourites (favourites survive "clear"). Stored on the device only.
- **Settings**: app language, theme, translation service and key, voice speed, auto-read, history on/off, help, delete all data.
- Installable to the Home Screen; the interface opens without the internet (new translations need it).

## Translation services

| Service | Key | Free allowance |
|---|---|---|
| MyMemory (default) | none | 5,000 characters a day; 50,000 with an e-mail in Settings |
| Google Cloud Translation v2 | your API key (enable "Cloud Translation API"; restrict the key to your site) | 500,000 characters a month |
| Microsoft Translator (Azure) | your key + region | 2 million characters a month |

All three are called directly from the browser (they allow CORS). Keys live in `localStorage` on the device and are sent only
to their own service. To save allowance, the text is translated **sentence by sentence (MyMemory) or line by line (Google,
Microsoft) with a cache**, so typing at the end of a paragraph only sends the sentence that changed.

## Speech on the iPhone

- Speech to text uses Safari's Web Speech API (`webkitSpeechRecognition`, iOS 14.5+), which uses **Siri's dictation**. It needs
  Settings › Siri › "Siri & Dictation" turned on and microphone permission for Safari. The app explains each error in plain words.
- If speech recognition is not available (some Home Screen/WebView versions, other browsers), the mic button points to the
  **microphone on the keyboard** (dictation): it types into the box and the translation still follows live.
- Text to speech uses `speechSynthesis` with the device's voice for that language.
- iOS stops recognition after a pause; the app restarts it while you are still in listening mode, and keeps what it heard.

## Development

```
npm install
npm start          # build + http://localhost:8080
npm test           # lint + unit tests (node:test)
npm run e2e        # Playwright: Chromium (phone) + WebKit with the iPhone 14 profile
npm run icons      # redraw src/icons/*.png
```

**Hosting: GitHub Pages.** Every push to `main` runs lint + unit tests, builds, and publishes `dist/`
(`.github/workflows/pages.yml`). All paths are relative and the CSP is also in a `<meta>` tag, so the app works from the
`/terjemah-langsung/` sub-folder and without custom headers. (`npm run deploy:netlify` is kept as an alternative.)

- `src/js/translate/`: text splitting, the three services, and the engine (cache, live debounce, dropping stale answers).
- `src/js/speech/`: the recognizer wrapper (iOS quirks) and speech output.
- `src/js/ui/`: the four screens and shared parts (toast, bottom sheets, language picker).
- XSS policy: there is no `innerHTML` anywhere (enforced by ESLint). Translations and transcripts go in as text.
  The CSP allows connections only to the three services.
- E2E tests run with a fake recognizer and synthesizer (`tests/e2e/harness.mjs`). The service worker is blocked except in
  `offline.e2e.mjs` (Playwright's WebKit cannot route requests that pass through a service worker).

## Not verified

On a real iPhone: the Siri dictation, the microphone permission prompt, actual voices, and Home Screen app behaviour.
Test on a device before relying on it.
