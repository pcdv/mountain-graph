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
import {segmented, field, section} from './form.js';
import {helpTip} from './help.js';

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
 * @property {Shape} shape of the mountains: a massif, ridges, or ridges joined at the callers they
 *           share (ranges)
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

/** @type {[string, string, string?][]} the shapes of the mountains, for a heap's settings too */
export const SHAPES = [['massif', 'Massif'], ['ridges', 'Ridges'], ['ranges', 'Ranges']];

/** @type {[string, string, string?][]} */
export const VIEWS = [['map', '2D', 'A topographic map, zoomed with the wheel and moved by dragging'], ['3d', '3D', 'A terrain in 3D, turned with the mouse']];

/** @type {[string, string, string?][]} */
export const COLOURS = [['height', 'Height'], ['package', 'Package']];

export const SHAPE_TITLE = {
  samples: 'Massif: each caller a sector as high as its time. Ridges: each a ridge out to it. '
           + 'Ranges: ridges, a caller several mountains share drawn once, a saddle between them',
  heap: 'Massif: each reference a sector as high as its size. Ridges: each a ridge out to it. '
        + 'Ranges: ridges, a reference several classes share drawn once, a saddle between them',
};

export const COLOUR_TITLE = 'Package: a hue per package, sub-packages near their parent; the height still sets how light';

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
    shape: shapeOf(readSetting(KEY + 'shape')),
    view: readSetting(KEY + 'view') === '3d' ? '3d' : DEFAULTS.view,
    colour: readSetting(KEY + 'colour') === 'package' ? 'package' : DEFAULTS.colour,
  };
}

/**
 * @typedef {object} Controls
 * @property {HTMLElement} view the choice of a map or 3D, for the header
 * @property {HTMLElement} settings the rest, in sections, for the settings pane
 */

/**
 * @param {PeakSettings} settings the current ones
 * @param {(settings: PeakSettings) => void} changed given the new ones, each time one changes
 * @returns {Controls}
 */
export function peakControls(settings, changed) {
  const grain = segmented([['method', 'Method'], ['class', 'Class'], ['package', 'Package']], settings.grain);
  const count = h('input', {type: 'number', min: 1, max: 100, value: settings.count});
  const coverage = h('input', {type: 'number', min: 1, max: 100, value: Math.round(settings.coverage * 100)});
  const waits = h('input', {type: 'text', class: 'pattern', spellcheck: false, value: settings.waits,
                            placeholder: 'none'});
  const hide = h('input', {type: 'text', class: 'pattern', spellcheck: false, value: settings.hide,
                           placeholder: 'none'});
  const java = h('input', {type: 'checkbox', checked: settings.java});
  const shape = segmented(SHAPES, settings.shape);
  const view = segmented(VIEWS, settings.view);
  const colour = segmented(COLOURS, settings.colour);

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
                  hide: hide.value, java: java.checked, shape: shapeOf(shape.value),
                  view: view.value === '3d' ? '3d' : 'map', colour: colour.value === 'package' ? 'package' : 'height'};
    for (const [key, value] of Object.entries(next))
      writeSetting(KEY + key, value);
    changed(next);
  };
  for (const input of [grain, count, coverage, waits, hide, java, shape, view, colour])
    input.addEventListener('input', update);
  update();

  return {view, settings: h('div', null,
    section('Samples',
      field('Leave out waits', waits, 'The samples whose top frame this finds are left out: threads waiting', 'waits'),
      field('Hide frames', hide, 'The frames this finds are left out of the stacks, their time given to their callers',
            'hide'),
      helpTip(h('label', {class: 'check'}, java, ' Java samples only (CPU)'), 'java',
              'Leaves out the native samples: threads blocked in native code, waiting')),
    section('Peaks',
      field('One per', grain, 'What a peak gathers: a method, a class or a package', 'method'),
      field('At most', h('span', {class: 'unit'}, count, ' peaks'), 'The most peaks, the heaviest first', 'count'),
      field('Until', h('span', {class: 'unit'}, coverage, ' % covered'),
            'No more peaks once those taken hold this share of the samples', 'coverage')),
    section('Landscape',
      field('Mountains', shape, SHAPE_TITLE.samples, 'shapes'),
      field('Colour', colour, COLOUR_TITLE, 'colour')),
    h('button', {type: 'button', class: 'button', onclick: () => {
      grain.value = DEFAULTS.grain;
      count.value = String(DEFAULTS.count);
      coverage.value = String(DEFAULTS.coverage * 100);
      waits.value = DEFAULTS.waits;
      hide.value = DEFAULTS.hide;
      java.checked = DEFAULTS.java;
      shape.value = DEFAULTS.shape;
      colour.value = DEFAULTS.colour;
      update();
    }}, 'Reset to defaults'))};
}

/**
 * @param {string | null} s
 * @returns {Shape} the one named, or the default
 */
function shapeOf(s) {
  return s === 'ridges' || s === 'ranges' ? s : DEFAULTS.shape;
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
