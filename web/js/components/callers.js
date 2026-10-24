// @ts-check
/**
 * A mountain as a tree to unfold: the peak, its callers, theirs, down to the
 * operation or thread where execution entered. Each caller with its weight and
 * its share of the peak, the heaviest first. Only forks indent and fold: a
 * frame with a single caller has it listed under it at the same level, so a
 * path dozens of frames deep reads straight down. Built as it unfolds: a
 * mountain can hold thousands of paths. The same for what a peak called,
 * each callee under the frame that called it.
 */
import {h} from '../lib/dom.js';
import {mainType, SYNTHETIC} from '../profile/profile.js';
import {amount} from '../model/units.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * How a tree is listed: its total, what the children of a frame are, what the weights count, and
 * whether a frame with a single child is listed under it at the same level.
 *
 * @typedef {{total: number, noun: string, unit: import('../model/units.js').Unit,
 *            flat?: boolean, shareTotal?: number, onPick?: (f: Frame) => void}} Tree
 */


/**
 * @param {Frame} mountain the tree of the peak, as mountains() or callees() gives it
 * @param {string} [noun] what the children of a frame are: callers, or callees
 * @param {import('../model/units.js').Unit} [unit] what the weights count, as the profile tells
 * @param {{flat?: boolean, shareTotal?: number, onPick?: (f: Frame) => void}} [options] flat: a
 *        frame with a single child is listed under it at the same level, so a long chain reads
 *        straight down; false nests every step, for a tree where each step is a different thing, as
 *        a heap dump's holders are. shareTotal: what the shares are taken of, the mountain's own
 *        total by default; a chain of holders grows outward, so its shares are of the top of the
 *        chain. onPick: given a frame when its name is clicked, for a tree that can be walked
 * @returns {HTMLElement}
 */
export function callersTree(mountain, noun = 'callers', unit = 'ms', {flat = true, shareTotal, onPick} = {}) {
  return h('ul', {class: 'callers'},
    callers(mountain, {total: mountain.total, noun, unit, flat, shareTotal, onPick}));
}

/**
 * @param {Frame} f
 * @param {Tree} tree
 * @returns {HTMLElement[]} the items of f's callers: of its single caller and that one's, or of
 *          each of its callers, the heaviest first
 */
function callers(f, tree) {
  if (tree.flat && f.children.length === 1)
    return path(f.children[0], tree);
  return [...f.children].sort((a, b) => b.total - a.total)
    .flatMap(c => tree.flat ? path(c, tree) : [fork(c, tree)]);
}

/**
 * @param {Frame} f
 * @param {Tree} tree
 * @returns {HTMLElement[]} its item, then, while each frame has a single caller, theirs
 */
function path(f, tree) {
  /** @type {HTMLElement[]} */
  const items = [];
  for (;; f = f.children[0]) {
    if (f.children.length !== 1) {
      items.push(fork(f, tree));
      return items;
    }
    items.push(h('li', {class: 'leaf'}, label(f, tree)));
  }
}

/**
 * @param {Frame} f with no child, or more than one
 * @param {Tree} tree
 * @returns {HTMLElement}
 */
function fork(f, tree) {
  if (f.children.length === 0)
    return h('li', {class: 'leaf'}, label(f, tree));
  const details = h('details', null, h('summary', null, label(f, tree),
                                       h('span', {class: 'muted'}, ` (${f.children.length} ${tree.noun})`)));
  details.addEventListener('toggle', () => {
    if (details.childElementCount === 1)
      details.append(h('ul', null, callers(f, tree)));
  });
  return h('li', null, details);
}

/**
 * @param {Frame} f
 * @param {Tree} tree
 */
function label(f, tree) {
  const of = tree.shareTotal ?? tree.total;
  const name = h('span', {class: mainType(f) === SYNTHETIC ? 'entry' : 'frame'}, f.name);
  if (tree.onPick) {
    name.classList.add('pick');
    name.title = 'Show what this object holds, and who holds it';
    name.addEventListener('click', e => {
      e.stopPropagation();
      tree.onPick?.(f);
    });
  }
  return [
    name,
    h('span', {class: 'muted'}, ` ${amount(f.total, tree.unit)}, ${(100 * f.total / (of || 1)).toFixed(1)}%`),
  ];
}
