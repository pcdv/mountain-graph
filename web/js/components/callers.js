// @ts-check
/**
 * A mountain as a tree to unfold: the peak, its callers, theirs, down to the
 * operation or thread where execution entered. Each caller with its ms and
 * its share of the peak, the heaviest first. Only forks indent and fold: a
 * frame with a single caller has it listed under it at the same level, so a
 * path dozens of frames deep reads straight down. Built as it unfolds: a
 * mountain can hold thousands of paths. The same for what a peak called,
 * each callee under the frame that called it.
 */
import {h} from '../lib/dom.js';
import {mainType, SYNTHETIC} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * @param {Frame} mountain the tree of the peak, as mountains() or callees() gives it
 * @param {string} [noun] what the children of a frame are: callers, or callees
 * @returns {HTMLElement}
 */
export function callersTree(mountain, noun = 'callers') {
  return h('ul', {class: 'callers'}, callers(mountain, mountain.total, noun));
}

/**
 * @param {Frame} f
 * @param {number} peak ms of the peak
 * @param {string} noun
 * @returns {HTMLElement[]} the items of f's callers: of its single caller and that one's, or of
 *          each of its callers, the heaviest first
 */
function callers(f, peak, noun) {
  return f.children.length === 1
    ? path(f.children[0], peak, noun)
    : [...f.children].sort((a, b) => b.total - a.total).flatMap(c => path(c, peak, noun));
}

/**
 * @param {Frame} f
 * @param {number} peak
 * @param {string} noun
 * @returns {HTMLElement[]} its item, then, while each frame has a single caller, theirs
 */
function path(f, peak, noun) {
  /** @type {HTMLElement[]} */
  const items = [];
  for (;; f = f.children[0]) {
    if (f.children.length !== 1) {
      items.push(fork(f, peak, noun));
      return items;
    }
    items.push(h('li', {class: 'leaf'}, label(f, peak)));
  }
}

/**
 * @param {Frame} f with no child, or more than one
 * @param {number} peak
 * @param {string} noun
 * @returns {HTMLElement}
 */
function fork(f, peak, noun) {
  if (f.children.length === 0)
    return h('li', {class: 'leaf'}, label(f, peak));
  const details = h('details', null, h('summary', null, label(f, peak),
                                       h('span', {class: 'muted'}, ` (${f.children.length} ${noun})`)));
  details.addEventListener('toggle', () => {
    if (details.childElementCount === 1)
      details.append(h('ul', null, callers(f, peak, noun)));
  });
  return h('li', null, details);
}

/**
 * @param {Frame} f
 * @param {number} peak
 */
function label(f, peak) {
  return [
    h('span', {class: mainType(f) === SYNTHETIC ? 'entry' : 'frame'}, f.name),
    h('span', {class: 'muted'}, ` ${Math.round(f.total).toLocaleString()} ms, ${(100 * f.total / peak).toFixed(1)}%`),
  ];
}
