// How a microphone button behaves.
//   Normal: tap to start listening, tap again to stop.
//   Noisy place mode: press and hold while you speak, release when done (like a walkie-talkie): music before and after your
//   sentence is never heard. A short tap listens for one sentence and stops at the first pause.
// If the browser refuses to start the microphone from a press (a "user gesture" rule on some versions), the button falls back
// to tapping for the rest of the visit (markHoldBlocked()).
import { settings } from '../core/store.js';

export const HOLD_MS = 350; // pressed at least this long = held (release stops); shorter = a tap (one sentence)
export const NOISY_PAUSE_MS = 1200; // in Noisy place mode, a tap's listening ends after this much silence

let holdBlocked = false;
export const markHoldBlocked = () => { holdBlocked = true; };
export const holdAvailable = () => !holdBlocked;
export const noiseMode = () => !!settings.get('noiseMode');

/**
 * @param {HTMLButtonElement} btn
 * @param {{ listening: () => boolean, start: () => void, stop: () => void }} o
 * @returns {{ held: () => boolean, via: () => 'press'|'click' }}
 */
export function bindMic(btn, { listening, start, stop }) {
  let press = null;
  let via = 'click';
  btn.addEventListener('pointerdown', e => {
    if (!noiseMode() || holdBlocked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no focus ring, no text selection, no iOS callout
    if (listening()) { press = null; stop(); return; }
    press = { t: Date.now() };
    via = 'press';
    try { btn.setPointerCapture(e.pointerId); } catch {}
    btn.classList.add('held');
    start();
  });
  const release = () => {
    if (!press) return;
    const long = Date.now() - press.t >= HOLD_MS;
    press = null;
    btn.classList.remove('held');
    if (long && listening()) stop(); // released after holding: done speaking
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, release);
  btn.addEventListener('click', e => {
    if (noiseMode() && !holdBlocked && e.detail > 0) return; // a pointer: already handled by the press
    via = 'click';
    if (listening()) stop(); else start();
  });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  return { held: () => !!press, via: () => via };
}
