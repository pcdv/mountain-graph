// @ts-check
/**
 * Advanced settings: the values the terrain and the 3D view are raised
 * with, as sliders, remembered. The defaults stay with the modules that use
 * them (TUNING in terrain.js, VIEW_TUNING in terrain3d.js); this lists them.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {TUNING} from '../model/terrain.js';
import {VIEW_TUNING} from '../views/terrain3d.js';

const KEY = 'mountaingraph.tuning';

/**
 * @typedef {object} Knob
 * @property {string} key
 * @property {string} label
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} title what it does
 */

/** @type {Knob[]} */
const KNOBS = [
  {key: 'foot', label: 'Foot height', min: 0, max: 0.6, step: 0.05,
   title: 'Ridges and ranges: a low dome under each mountain, as high as this share of its peak, so that its bulk shows its weight'},
  {key: 'ridge', label: 'Ridge width', min: 0.06, max: 0.4, step: 0.02,
   title: "Ridges and ranges: the peak's ridge, as a share of the mountain's radius"},
  {key: 'near', label: 'Saddle reach', min: 1, max: 3, step: 0.1,
   title: 'Ranges: how far apart two mountains may stand, in the sum of their radii, for a caller they share to make a saddle'},
  {key: 'trail', label: 'Trail threshold', min: 0.05, max: 1, step: 0.05,
   title: "The least share of the smaller mountain's time through a shared caller, for a trail"},
  {key: 'trails', label: 'Trails per mountain', min: 0, max: 8, step: 1, title: 'The most trails from a mountain'},
  {key: 'curve', label: '3D height curve', min: 0.3, max: 1, step: 0.05,
   title: 'Heights as the time to this power: 0.5 lets small peaks show, 1 makes them as high as their time'},
  {key: 'bump', label: 'Island bumps', min: 0, max: 0.03, step: 0.002, title: 'How rough the islands are'},
  {key: 'rock', label: 'Island rock slope', min: 1, max: 8, step: 0.5,
   title: 'How steep a slope turns to rock: lower, more rock'},
];

/** @typedef {import('../model/terrain.js').Tuning & import('../views/terrain3d.js').ViewTuning} AllTuning */

/** @returns {AllTuning} as last set, or the defaults */
export function tuning() {
  /** @type {AllTuning} */
  const all = {...TUNING, ...VIEW_TUNING};
  try {
    const kept = JSON.parse(readSetting(KEY) ?? '{}');
    for (const knob of KNOBS)
      if (typeof kept[knob.key] === 'number' && kept[knob.key] >= knob.min && kept[knob.key] <= knob.max)
        /** @type {any} */ (all)[knob.key] = kept[knob.key];
  }
  catch (e) {
    // the defaults
  }
  return all;
}

/**
 * @param {(tuning: AllTuning) => void} changed given the new values, each time one is let go
 * @returns {HTMLElement}
 */
export function advanced(changed) {
  const now = tuning();
  /** @type {any} */
  const values = now;
  const save = () => {
    writeSetting(KEY, JSON.stringify(values));
    changed(now);
  };
  const rows = KNOBS.map(knob => {
    const out = h('span', {class: 'value'}, String(values[knob.key]));
    const set = () => {
      values[knob.key] = Number(input.value);
      out.textContent = input.value;
      save();
    };
    const input = h('input', {type: 'range', min: knob.min, max: knob.max, step: knob.step, value: values[knob.key],
                              oninput: () => out.textContent = input.value, onchange: set});
    // a step at a time: easier than dragging
    /** @param {number} by -1 or 1 */
    const nudge = by => h('button', {type: 'button', class: 'nudge', title: by < 0 ? 'Less' : 'More', onclick: () => {
      const was = input.value;
      if (by < 0)
        input.stepDown();
      else
        input.stepUp();
      if (input.value !== was)
        set();
    }}, by < 0 ? '−' : '+');
    return {knob, input, out, row: h('div', {class: 'knob', title: knob.title}, h('span', null, knob.label), nudge(-1), input,
                                     nudge(1), out)};
  });
  const reset = h('button', {type: 'button', class: 'button', onclick: () => {
    /** @type {any} */
    const defaults = {...TUNING, ...VIEW_TUNING};
    for (const {knob, input, out} of rows) {
      values[knob.key] = defaults[knob.key];
      input.value = out.textContent = String(defaults[knob.key]);
    }
    save();
  }}, 'Defaults');
  return h('div', {class: 'knobs'}, rows.map(r => r.row), reset);
}
