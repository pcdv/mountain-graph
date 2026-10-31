// @ts-check
/**
 * A short message at the foot of the window, gone after a moment: what a key did (a picture saved, a view added
 * to the tour).
 */
import {h} from '../lib/dom.js';

/** How long the message stays, ms. */
const TOAST = 2000;

/** @type {HTMLElement | null} */
let toast = null;
/** @type {number | undefined} */
let hiding;

/** @param {string} text */
export function say(text) {
  toast ??= h('div', {class: 'toast', role: 'status'});
  toast.textContent = text;
  toast.hidden = false;
  document.body.append(toast);
  clearTimeout(hiding);
  hiding = setTimeout(() => toast && (toast.hidden = true), TOAST);
}
