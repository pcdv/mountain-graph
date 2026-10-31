// @ts-check
/**
 * The pieces the settings are built of, so that every view lays its own out
 * the same way: a section with a title, which folds, open or not as it was last left; a field with its
 * label, and a choice of a few values shown side by side.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
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
  return choice(h('div', {class: 'segmented', role: 'radiogroup'},
    options.map(([, label, title], i) => h('label', {title}, radios[i], h('span', null, label)))), radios);
}

/**
 * A choice among colours, each a swatch: radio buttons as a row of small plates. It fires `input` as a
 * select does. The colour of a swatch is the CSS's, by its `data-colour`.
 *
 * @param {[string, string][]} options each its value, which is its colour's name, and its label
 * @param {string} value the one chosen
 * @returns {Choice}
 */
export function swatches(options, value) {
  const name = `choice-${++groups}`;
  const radios = options.map(([v]) => h('input', {type: 'radio', name, value: v, checked: v === value}));
  return choice(h('div', {class: 'swatches', role: 'radiogroup'},
    options.map(([v, label], i) => h('label', {title: label}, radios[i],
                                     h('span', {'data-colour': v, 'aria-label': label})))), radios);
}

/**
 * @param {HTMLElement} el the radio buttons' container
 * @param {HTMLInputElement[]} radios
 * @returns {Choice} el, read and set by value as a select is
 */
function choice(el, radios) {
  Object.defineProperty(el, 'value', {
    get: () => radios.find(r => r.checked)?.value ?? '',
    set: (/** @type {string} */ v) => radios.forEach(r => r.checked = r.value === v),
  });
  return /** @type {Choice} */ (el);
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
 * The small button that ends a section: its own settings back to their defaults, and nothing else.
 *
 * @param {string} what the settings of the section, in words: "the peaks"
 * @param {() => void} action sets them back
 * @returns {HTMLElement}
 */
export function resetButton(what, action) {
  return h('button', {type: 'button', class: 'reset', title: `Sets ${what} back to their defaults`, onclick: action},
           'Reset');
}

/** Where a section's state is kept, by its title: a habit of the person, not a setting of the view. */
const FOLD = 'mountaingraph.fold.';

/**
 * @param {string} title
 * @param {boolean} open whether it is open the first time, before the person has chosen
 * @param {(HTMLElement | null)[]} rows
 * @returns {HTMLElement} the section, open or folded as it was last left
 */
function foldable(title, open, rows) {
  const key = FOLD + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const details = h('details', {class: 'settings-section'}, h('summary', null, h('h3', null, title)),
                    h('div', {class: 'settings-body'}, rows));
  const kept = readSetting(key);
  details.open = kept === null ? open : kept === 'open';
  details.addEventListener('toggle', () => writeSetting(key, details.open ? 'open' : 'closed'));
  return details;
}

/**
 * A section with a title, open at first.
 *
 * @param {string} title
 * @param {...(HTMLElement | null)} rows
 * @returns {HTMLElement}
 */
export function section(title, ...rows) {
  return foldable(title, true, rows);
}

/**
 * A section folded at first, for what is rarely changed.
 *
 * @param {string} title
 * @param {...(HTMLElement | null)} rows
 * @returns {HTMLElement}
 */
export function folded(title, ...rows) {
  return foldable(title, false, rows);
}
