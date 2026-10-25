// @ts-check
/**
 * The pieces the settings are built of, so that every view lays its own out
 * the same way: a section with a title, a field with its label, and a choice
 * of a few values shown side by side.
 */
import {h} from '../lib/dom.js';
import {helpTip} from './help.js';

/** @typedef {HTMLElement & {value: string}} Choice a segmented control, read and set as a select */

let groups = 0;

/**
 * A choice of a few values, all in sight: radio buttons drawn as one segmented
 * control. It fires `input` as a select does.
 *
 * @param {[string, string, string?][]} options each its value, its label and what it means
 * @param {string} value the one chosen
 * @returns {Choice}
 */
export function segmented(options, value) {
  const name = `choice-${++groups}`;
  const radios = options.map(([v]) => h('input', {type: 'radio', name, value: v, checked: v === value}));
  /** @type {any} given a value below */
  const el = h('div', {class: 'segmented', role: 'radiogroup'},
    options.map(([, label, title], i) => h('label', {title}, radios[i], h('span', null, label))));
  Object.defineProperty(el, 'value', {
    get: () => radios.find(r => r.checked)?.value ?? '',
    set: (/** @type {string} */ v) => radios.forEach(r => r.checked = r.value === v),
  });
  return el;
}

/**
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} [title] what it does, shown on hover: as a tip with a button to the help when it has help
 * @param {string} [help] the id of its section of the help
 * @returns {HTMLElement} the label beside the control, or above it for a wide one (CSS)
 */
export function field(label, control, title, help) {
  const name = h('span', {class: 'field-label'}, label);
  if (help)
    helpTip(name, help, title ?? label);
  return h('label', {class: 'field', title: help ? undefined : title}, name, control);
}

/**
 * @param {string} title
 * @param {...(HTMLElement | null)} rows
 * @returns {HTMLElement}
 */
export function section(title, ...rows) {
  return h('section', {class: 'settings-section'}, h('h3', null, title), rows);
}

/**
 * A section folded at first, for what is rarely changed.
 *
 * @param {string} title
 * @param {...(HTMLElement | null)} rows
 * @returns {HTMLElement}
 */
export function folded(title, ...rows) {
  return h('details', {class: 'settings-section'}, h('summary', null, h('h3', null, title)), rows);
}
