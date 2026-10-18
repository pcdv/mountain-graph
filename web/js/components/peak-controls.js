// @ts-check
/**
 * What sets the peaks: what each gathers, their most number, the coverage at
 * which no more are taken, the samples left out as waits, the frames hidden,
 * whether native samples count, the shape of the mountains and the view they
 * are shown in. Remembered in the browser.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {WAITS} from '../model/samples.js';

/** @typedef {import('../model/peaks.js').Grain} Grain */
/** @typedef {import('../model/terrain.js').Shape} Shape */

/**
 * @typedef {object} PeakSettings
 * @property {Grain} grain what a peak gathers: a method, a class or a package
 * @property {number} count the most peaks
 * @property {number} coverage 0 to 1: no more peaks once the ones taken hold this share
 * @property {string} waits a regular expression for the top frames of the samples left out, empty
 *           for none
 * @property {string} hide a regular expression for the frames hidden, empty for none
 * @property {boolean} java keeps the Java samples only, leaving out the native ones: those of
 *           threads blocked in native code (a socket read, a poll) weigh time waited, not CPU
 * @property {Shape} shape of the mountains: a massif or ridges
 * @property {'map' | '3d'} view what shows them: a topographic map or a terrain in 3D
 * @property {'height' | 'package'} colour of the land: by height only, or the hue of each frame's
 *           package too
 */

/**
 * By default the threads waiting are left out, and the JDK is hidden: a
 * sample's time goes to the application code under it.
 *
 * @type {PeakSettings}
 */
const DEFAULTS = {grain: 'method', count: 10, coverage: 1, waits: WAITS, hide: '^(java|javax|jdk|sun|com\\.sun)\\.',
                  java: false, shape: 'massif', view: 'map', colour: 'height'};

const KEY = 'mountaingraph.peaks.';

/** @returns {PeakSettings} those remembered, or the defaults */
export function peakSettings() {
  const count = Number(readSetting(KEY + 'count'));
  const coverage = Number(readSetting(KEY + 'coverage'));
  const grain = readSetting(KEY + 'grain');
  return {
    grain: grain === 'class' || grain === 'package' ? grain : DEFAULTS.grain,
    count: Number.isInteger(count) && count >= 1 ? count : DEFAULTS.count,
    coverage: coverage > 0 && coverage <= 1 ? coverage : DEFAULTS.coverage,
    waits: readSetting(KEY + 'waits') ?? DEFAULTS.waits,
    hide: readSetting(KEY + 'hide') ?? DEFAULTS.hide,
    java: readSetting(KEY + 'java') === 'true',
    shape: readSetting(KEY + 'shape') === 'ridges' ? 'ridges' : DEFAULTS.shape,
    view: readSetting(KEY + 'view') === '3d' ? '3d' : DEFAULTS.view,
    colour: readSetting(KEY + 'colour') === 'package' ? 'package' : DEFAULTS.colour,
  };
}

/**
 * @param {PeakSettings} settings the current ones
 * @param {(settings: PeakSettings) => void} changed given the new ones, each time one changes
 * @returns {HTMLElement}
 */
export function peakControls(settings, changed) {
  const grain = h('select', null, ['method', 'class', 'package'].map(g =>
    h('option', {value: g, selected: g === settings.grain}, g)));
  const count = h('input', {type: 'number', min: 1, max: 100, value: settings.count});
  const coverage = h('input', {type: 'number', min: 1, max: 100, value: Math.round(settings.coverage * 100)});
  const waits = h('input', {type: 'text', class: 'pattern', spellcheck: false, value: settings.waits,
                            placeholder: 'none'});
  const hide = h('input', {type: 'text', class: 'pattern', spellcheck: false, value: settings.hide,
                           placeholder: 'none'});
  const java = h('input', {type: 'checkbox', checked: settings.java});
  const shape = h('select', null, ['massif', 'ridges'].map(s =>
    h('option', {value: s, selected: s === settings.shape}, s)));
  const view = h('select', null, [['map', 'a map'], ['3d', '3D']].map(([v, label]) =>
    h('option', {value: v, selected: v === settings.view}, label)));
  const colour = h('select', null, ['height', 'package'].map(c =>
    h('option', {value: c, selected: c === settings.colour}, c)));

  const update = () => {
    for (const input of [waits, hide]) {
      const valid = isPattern(input.value);
      input.classList.toggle('invalid', !valid);
      input.title = valid ? input.value : 'Not a regular expression: it does nothing';
    }
    const n = count.valueAsNumber, c = coverage.valueAsNumber;
    if (!Number.isInteger(n) || n < 1 || !(c > 0 && c <= 100))
      return;
    /** @type {PeakSettings} */
    const next = {grain: /** @type {Grain} */ (grain.value), count: n, coverage: c / 100, waits: waits.value,
                  hide: hide.value, java: java.checked, shape: /** @type {Shape} */ (shape.value),
                  view: view.value === '3d' ? '3d' : 'map', colour: colour.value === 'package' ? 'package' : 'height'};
    for (const [key, value] of Object.entries(next))
      writeSetting(KEY + key, value);
    changed(next);
  };
  for (const input of [grain, count, coverage, waits, hide, java, shape, view, colour])
    input.addEventListener('input', update);
  update();

  return h('div', {class: 'controls'},
    h('label', null, 'Peaks by ', grain),
    h('label', null, 'at most ', count),
    h('label', null, 'up to ', coverage, '% covered'),
    h('label', {title: 'The samples whose top frame this finds are left out: threads waiting'},
      'Leave out waits ', waits),
    h('label', {title: 'The frames this finds are left out of the stacks, their time given to their callers'},
      'Hide ', hide),
    h('label', {title: 'Leaves out the native samples: threads blocked in native code, waiting'},
      java, ' Java samples only (CPU)'),
    h('label', {title: 'A massif: each caller a sector as high as its time. Ridges: each a ridge out to it'},
      'Mountains as ', shape, ' in ', view),
    h('label', {title: 'By package: a hue per package, sub-packages near their parent; the height still sets how light'},
      'coloured by ', colour),
    h('button', {type: 'button', class: 'button', onclick: () => {
      grain.value = DEFAULTS.grain;
      count.value = String(DEFAULTS.count);
      coverage.value = String(DEFAULTS.coverage * 100);
      waits.value = DEFAULTS.waits;
      hide.value = DEFAULTS.hide;
      java.checked = DEFAULTS.java;
      shape.value = DEFAULTS.shape;
      view.value = DEFAULTS.view;
      colour.value = DEFAULTS.colour;
      update();
    }}, 'Defaults'));
}

/** @param {string} s */
function isPattern(s) {
  try {
    new RegExp(s);
    return true;
  }
  catch (e) {
    return false;
  }
}
