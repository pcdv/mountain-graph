// @ts-check
/**
 * What sets the peaks of a heap: what ranks them, whether thin wrappers count,
 * what each gathers, how many frames make one, their most number, the coverage
 * at which no more are taken, the shape of the mountains and the view they are
 * shown in. Remembered in the browser, apart from the settings of samples:
 * their defaults differ.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';

/** @typedef {import('../model/peaks.js').Grain} Grain */
/** @typedef {import('../model/terrain.js').Shape} Shape */

/**
 * @typedef {object} HeapSettings
 * @property {'owned' | 'shallow'} basis what ranks a peak: the memory a chain of holders retains, or
 *           the shallow size of the objects at the top of a stack
 * @property {'skip' | 'show'} wrappers what to do with a thin wrapper: an object that owns almost
 *           none of what it holds, a handler the walk happened to enter the graph by
 * @property {Grain} grain what a peak gathers: a class ('method', a frame being a class here) or a
 *           package
 * @property {number} context how many frames make a peak: 1 the class alone, 2 the class with
 *           its holder, 3 with its holder's holder
 * @property {number} count the most peaks
 * @property {number} coverage 0 to 1: no more peaks once the ones taken hold this share
 * @property {Shape} shape of the mountains
 * @property {'map' | '3d'} view what shows them
 * @property {'height' | 'package'} colour of the land
 */

/** @type {HeapSettings} */
const DEFAULTS = {basis: 'owned', wrappers: 'skip', grain: 'method', context: 2, count: 10, coverage: 1,
                  shape: 'massif', view: 'map', colour: 'height'};

const KEY = 'mountaingraph.heap.';

/** @returns {HeapSettings} those remembered, or the defaults */
export function heapSettings() {
  const count = Number(readSetting(KEY + 'count'));
  const coverage = Number(readSetting(KEY + 'coverage'));
  const grain = readSetting(KEY + 'grain');
  const context = Number(readSetting(KEY + 'context'));
  return {
    basis: readSetting(KEY + 'basis') === 'shallow' ? 'shallow' : DEFAULTS.basis,
    wrappers: readSetting(KEY + 'wrappers') === 'show' ? 'show' : DEFAULTS.wrappers,
    grain: grain === 'package' ? grain : DEFAULTS.grain,
    context: Number.isInteger(context) && context >= 1 && context <= 5 ? context : DEFAULTS.context,
    count: Number.isInteger(count) && count >= 1 ? count : DEFAULTS.count,
    coverage: coverage > 0 && coverage <= 1 ? coverage : DEFAULTS.coverage,
    shape: shapeOf(readSetting(KEY + 'shape')),
    view: readSetting(KEY + 'view') === '3d' ? '3d' : DEFAULTS.view,
    colour: readSetting(KEY + 'colour') === 'package' ? 'package' : DEFAULTS.colour,
  };
}

/**
 * @param {HeapSettings} settings the current ones
 * @param {(settings: HeapSettings) => void} changed given the new ones, each time one changes
 * @returns {HTMLElement}
 */
export function heapControls(settings, changed) {
  const basis = h('select', null, [['owned', 'what they hold'], ['shallow', 'their own size']].map(([b, label]) =>
    h('option', {value: b, selected: b === settings.basis}, label)));
  const wrappers = h('select', null, [['skip', 'skipped'], ['show', 'as peaks']].map(([w, label]) =>
    h('option', {value: w, selected: w === settings.wrappers}, label)));
  const grain = h('select', null, [['method', 'class'], ['package', 'package']].map(([g, label]) =>
    h('option', {value: g, selected: g === settings.grain}, label)));
  const context = h('select', null, [1, 2, 3, 4, 5].map(n =>
    h('option', {value: n, selected: n === settings.context}, n === 1 ? 'class' : `${n} frames`)));
  const count = h('input', {type: 'number', min: 1, max: 100, value: settings.count});
  const coverage = h('input', {type: 'number', min: 1, max: 100, value: Math.round(settings.coverage * 100)});
  const shape = h('select', null, ['massif', 'ridges', 'ranges'].map(s =>
    h('option', {value: s, selected: s === settings.shape}, s)));
  const view = h('select', null, [['map', 'a map'], ['3d', '3D']].map(([v, label]) =>
    h('option', {value: v, selected: v === settings.view}, label)));
  const colour = h('select', null, ['height', 'package'].map(c =>
    h('option', {value: c, selected: c === settings.colour}, c)));

  const update = () => {
    const n = count.valueAsNumber, c = coverage.valueAsNumber, k = Number(context.value);
    if (!Number.isInteger(n) || n < 1 || !(c > 0 && c <= 100) || !(k >= 1 && k <= 5))
      return;
    /** @type {HeapSettings} */
    const next = {basis: /** @type {'owned' | 'shallow'} */ (basis.value),
                  wrappers: /** @type {'skip' | 'show'} */ (wrappers.value),
                  grain: /** @type {Grain} */ (grain.value), context: k, count: n, coverage: c / 100,
                  shape: shapeOf(shape.value), view: view.value === '3d' ? '3d' : 'map',
                  colour: colour.value === 'package' ? 'package' : 'height'};
    for (const [key, value] of Object.entries(next))
      writeSetting(KEY + key, value);
    changed(next);
  };
  for (const input of [basis, wrappers, grain, context, count, coverage, shape, view, colour])
    input.addEventListener('input', update);
  update();

  return h('div', {class: 'controls'},
    h('label', {title: 'What they hold: a chain of holders is one peak, as deep as the object that '
                       + 'actually retains the memory. Their own size: the objects at the top of a stack'},
      'Peaks ranked by ', basis),
    h('label', {title: 'A thin wrapper owns almost none of what it holds: a handler or a manager '
                       + 'the walk entered the graph by. Skipped, what it holds belongs to the objects '
                       + 'inside it'},
      'thin wrappers ', wrappers),
    h('label', null, 'gathered by ', grain),
    h('label', {title: 'How many frames make a peak: the class alone, or the class and the objects '
                       + 'holding it, so that a cache and the map it holds are one peak'},
      'context ', context),
    h('label', null, 'at most ', count),
    h('label', null, 'up to ', coverage, '% covered'),
    h('label', {title: 'A massif: each reference a sector as high as its size. Ridges: each a ridge out to it. '
                       + 'Ranges: ridges, a reference several classes share drawn once, a saddle between them'},
      'Mountains as ', shape, ' in ', view),
    h('label', {title: 'By package: a hue per package, sub-packages near their parent; the height still sets how light'},
      'coloured by ', colour),
    h('button', {type: 'button', class: 'button', onclick: () => {
      basis.value = DEFAULTS.basis;
      wrappers.value = DEFAULTS.wrappers;
      grain.value = DEFAULTS.grain;
      context.value = String(DEFAULTS.context);
      count.value = String(DEFAULTS.count);
      coverage.value = String(DEFAULTS.coverage * 100);
      shape.value = DEFAULTS.shape;
      view.value = DEFAULTS.view;
      colour.value = DEFAULTS.colour;
      update();
    }}, 'Defaults'));
}

/**
 * @param {string | null} s
 * @returns {Shape} the one named, or the default
 */
function shapeOf(s) {
  return s === 'ridges' || s === 'ranges' ? s : DEFAULTS.shape;
}
