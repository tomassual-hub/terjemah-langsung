// DOM building without innerHTML: the CSP forbids inline script and style, and nearly every string shown here (translations
// from outside services, speech transcripts, history) is untrusted, so it only ever goes in as text.
import iconMic from 'lucide-static/icons/mic.svg';
import iconMicOff from 'lucide-static/icons/mic-off.svg';
import iconSwap from 'lucide-static/icons/arrow-left-right.svg';
import iconCopy from 'lucide-static/icons/copy.svg';
import iconSpeak from 'lucide-static/icons/volume-2.svg';
import iconShare from 'lucide-static/icons/share.svg';
import iconStar from 'lucide-static/icons/star.svg';
import iconTrash from 'lucide-static/icons/trash-2.svg';
import iconX from 'lucide-static/icons/x.svg';
import iconSettings from 'lucide-static/icons/settings.svg';
import iconHistory from 'lucide-static/icons/history.svg';
import iconChat from 'lucide-static/icons/messages-square.svg';
import iconLanguages from 'lucide-static/icons/languages.svg';
import iconStop from 'lucide-static/icons/square.svg';
import iconSearch from 'lucide-static/icons/search.svg';
import iconCheck from 'lucide-static/icons/check.svg';
import iconWifiOff from 'lucide-static/icons/wifi-off.svg';
import iconKeyboard from 'lucide-static/icons/keyboard.svg';
import iconPaste from 'lucide-static/icons/clipboard-paste.svg';
import iconChevron from 'lucide-static/icons/chevron-down.svg';
import iconExpand from 'lucide-static/icons/maximize-2.svg';
import iconRotate from 'lucide-static/icons/rotate-cw.svg';
import iconInfo from 'lucide-static/icons/info.svg';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  mic: iconMic, 'mic-off': iconMicOff, swap: iconSwap, copy: iconCopy, speak: iconSpeak, share: iconShare, star: iconStar,
  trash: iconTrash, x: iconX, settings: iconSettings, history: iconHistory, chat: iconChat, languages: iconLanguages, stop: iconStop,
  search: iconSearch, check: iconCheck, 'wifi-off': iconWifiOff, keyboard: iconKeyboard, paste: iconPaste, chevron: iconChevron,
  expand: iconExpand, rotate: iconRotate, info: iconInfo,
};
const SHAPE_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const shapeCache = new Map();

/** The simple self-closing shapes inside a Lucide SVG file, as [tag, attrs] pairs (Lucide uses nothing else). */
function shapesOf(source) {
  const inner = source.slice(source.indexOf('>', source.indexOf('<svg')) + 1, source.lastIndexOf('</svg>'));
  const list = [];
  for (const m of inner.matchAll(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*\/>/g)) {
    if (!SHAPE_TAGS.has(m[1])) continue;
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    list.push([m[1], attrs]);
  }
  return list;
}

/** A Lucide icon as an inline <svg>, built node by node (no markup parsing). Colour and size come from CSS (currentColor, .icon). */
export function icon(name) {
  let shapes = shapeCache.get(name);
  if (!shapes) {
    shapes = shapesOf(ICONS[name] ?? ICONS.info);
    shapeCache.set(name, shapes);
  }
  return svg('svg', {
    class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, ...shapes.map(([tag, attrs]) => svg(tag, attrs)));
}

function append(el, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) child.forEach(c => append(el, c));
  else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

/**
 * h('button', { class: 'btn', onClick: fn, 'aria-label': 'x' }, icon('x'), 'Text')
 * `style` takes an object applied through the CSSOM (a style *attribute* would be blocked by the CSP).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (/^on[A-Z]/.test(k)) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'for') el.htmlFor = v;
    else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role' || k === 'tabindex' || k === 'dir' || k === 'lang') el.setAttribute(k, v === true ? 'true' : v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

/** An SVG element: svg('path', { d: '...', fill: 'none' }). */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) el.setAttribute(k, v);
  append(el, children);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** A round icon button with an accessible name (and the same text as a tooltip). */
export const iconButton = (name, label, onClick, { class: cls = '', ...rest } = {}) =>
  h('button', { type: 'button', class: `icon-btn ${cls}`.trim(), 'aria-label': label, title: label, onClick, ...rest }, icon(name));
