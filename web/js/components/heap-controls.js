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
import {segmented, field, section, resetButton} from './form.js';
import {SHAPES, VIEWS, COLOURS, SHAPE_TITLE, COLOUR_TITLE, viewOf} from './peak-controls.js';

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
 * @property {'map' | '3d' | 'flame'} view what shows them
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
    view: viewOf(readSetting(KEY + 'view')),
    colour: readSetting(KEY + 'colour') === 'package' ? 'package' : DEFAULTS.colour,
  };
}

/**
 * The settings a profile of duplicate Strings is drawn with, whatever was chosen for a heap: a
 * peak is a value, the last frame of its paths, ranked by its own weight, with the holders as
 * slopes. They are not remembered, so that the next heap is drawn as it was left.
 */
const DUPLICATES = /** @type {const} */ ({basis: 'shallow', grain: 'method', context: 1, colour: 'height'});

/**
 * @param {HeapSettings} settings as chosen for a heap
 * @returns {HeapSettings} those a profile of duplicate Strings is drawn with: the rest, the number of
 *          peaks, the shape and the view, are as chosen
 */
export function asDuplicates(settings) {
  return {...settings, ...DUPLICATES};
}

/**
 * @param {HeapSettings} settings the current ones
 * @param {(settings: HeapSettings) => void} changed given the new ones, each time one changes
 * @param {HTMLElement} relief where the 3D view puts its own controls: in the landscape, shown in 3D only
 * @param {boolean} [duplicates] the profile is of duplicate Strings: what ranks and gathers its peaks
 *        is fixed, and not shown
 * @returns {import('./peak-controls.js').Controls} those that do not apply to the ranking chosen hidden
 */
export function heapControls(settings, changed, relief, duplicates = false) {
  const basis = segmented([['owned', 'What they hold', 'Which objects keep the memory alive. A chain of holders is one '
                                                        + 'peak, as deep as the object that actually retains the memory; '
                                                        + 'the slopes go down to what it holds'],
                           ['shallow', 'Own size', 'Which classes take the most room themselves: the shallow size of '
                                                   + 'their instances, not what they point to. The slopes are the '
                                                   + 'objects that hold them']], settings.basis);
  const wrappers = segmented([['skip', 'Skipped'], ['show', 'As peaks']], settings.wrappers);
  const grain = segmented([['method', 'Class'], ['package', 'Package']], settings.grain);
  const context = h('select', null, [1, 2, 3, 4, 5].map(n =>
    h('option', {value: n, selected: n === settings.context}, n === 1 ? 'The class alone' : `${n} frames`)));
  const count = h('input', {type: 'number', min: 1, max: 100, value: settings.count});
  const coverage = h('input', {type: 'number', min: 1, max: 100, value: Math.round(settings.coverage * 100)});
  const shape = segmented(SHAPES, settings.shape);
  const view = segmented(VIEWS, settings.view);
  const colour = segmented(COLOURS, settings.colour);

  const wrapped = field('Thin wrappers', wrappers, 'A thin wrapper owns almost none of what it holds: a handler or a '
                        + 'manager the walk entered the graph by. Skipped, what it holds belongs to the objects inside it',
                        'wrappers');
  const gathered = field('One per', grain, 'What a peak gathers: the instances of a class, or of a package', 'grain');
  const framed = field('Context', context, 'How many frames make a peak: the class alone, or the class and the '
                       + 'objects holding it, so that a cache and the map it holds are one peak', 'context');
  const coloured = field('Colour', colour, COLOUR_TITLE, 'colour');
  const ranked = field('Ranked by', basis, 'What a peak is: the objects that keep the memory alive, or the classes that take '
                       + 'the most room themselves', 'basis');
  // the flame graph has every path of the heap: none of these change it, and a line says so in their place
  const peaked = section('Peaks', ranked, wrapped, gathered, framed,
    field('At most', h('span', {class: 'unit'}, count, ' peaks'), 'The most peaks, the heaviest first', 'count'),
    field('Until', h('span', {class: 'unit'}, coverage, ' % covered'),
          'No more peaks once those taken hold this share of the memory', 'coverage'),
    resetButton('the peaks', () => {
      basis.value = DEFAULTS.basis;
      wrappers.value = DEFAULTS.wrappers;
      grain.value = DEFAULTS.grain;
      context.value = String(DEFAULTS.context);
      count.value = String(DEFAULTS.count);
      coverage.value = String(DEFAULTS.coverage * 100);
      update();
    }));
  const landscape = section('Landscape', field('Mountains', shape, SHAPE_TITLE.heap, 'shapes'), coloured, relief);
  const whole = h('p', {class: 'muted'}, 'The flame graph shows every path of the heap, from its roots to the objects. '
                  + 'Nothing here changes it: these settings are for the peaks.');

  const update = () => {
    const flame = view.value === 'flame';
    peaked.hidden = landscape.hidden = flame;
    relief.hidden = view.value !== '3d';
    whole.hidden = !flame;
    const n = count.valueAsNumber, c = coverage.valueAsNumber, k = Number(context.value);
    // what the ranking chosen does not use is not shown: it would change nothing
    const owned = basis.value === 'owned';
    ranked.hidden = duplicates;
    wrapped.hidden = duplicates || !owned;
    gathered.hidden = framed.hidden = duplicates || owned;
    coloured.hidden = duplicates || owned || k !== 1;
    if (!Number.isInteger(n) || n < 1 || !(c > 0 && c <= 100) || !(k >= 1 && k <= 5))
      return;
    /** @type {HeapSettings} */
    const next = {basis: /** @type {'owned' | 'shallow'} */ (basis.value),
                  wrappers: /** @type {'skip' | 'show'} */ (wrappers.value),
                  grain: /** @type {Grain} */ (grain.value), context: k, count: n, coverage: c / 100,
                  shape: shapeOf(shape.value), view: viewOf(view.value),
                  colour: colour.value === 'package' ? 'package' : 'height'};
    for (const [key, value] of Object.entries(next))
      writeSetting(KEY + key, value);
    changed(duplicates ? asDuplicates(next) : next);
  };
  for (const input of [basis, wrappers, grain, context, count, coverage, shape, view, colour])
    input.addEventListener('input', update);
  update();

  return {view, settings: h('div', null, whole, peaked, landscape)};
}

/**
 * @param {string | null} s
 * @returns {Shape} the one named, or the default
 */
function shapeOf(s) {
  return s === 'ridges' || s === 'ranges' ? s : DEFAULTS.shape;
}
