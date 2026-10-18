// @ts-check
/**
 * A mountain as a tree to unfold: the peak, its callers, theirs, down to the
 * operation or thread where execution entered. Each caller with its ms and
 * its share of the peak, the heaviest first. Only forks indent and fold: a
 * frame with a single caller has it listed under it at the same level, so a
 * path dozens of frames deep reads straight down. Built as it unfolds: a
 * mountain can hold thousands of paths.
 */
import {h} from '../lib/dom.js';
import {mainType, SYNTHETIC} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * @param {Frame} mountain the tree of the peak, as mountains() gives it
 * @returns {HTMLElement}
 */
export function callersTree(mountain) {
  return h('ul', {class: 'callers'}, callers(mountain, mountain.total));
}

/**
 * @param {Frame} f
 * @param {number} peak ms of the peak
 * @returns {HTMLElement[]} the items of f's callers: of its single caller and that one's, or of
 *          each of its callers, the heaviest first
 */
function callers(f, peak) {
  return f.children.length === 1
    ? path(f.children[0], peak)
    : [...f.children].sort((a, b) => b.total - a.total).flatMap(c => path(c, peak));
}

/**
 * @param {Frame} f
 * @param {number} peak
 * @returns {HTMLElement[]} its item, then, while each frame has a single caller, theirs
 */
function path(f, peak) {
  /** @type {HTMLElement[]} */
  const items = [];
  for (;; f = f.children[0]) {
    if (f.children.length !== 1) {
      items.push(fork(f, peak));
      return items;
    }
    items.push(h('li', {class: 'leaf'}, label(f, peak)));
  }
}

/**
 * @param {Frame} f with no caller, or more than one
 * @param {number} peak
 * @returns {HTMLElement}
 */
function fork(f, peak) {
  if (f.children.length === 0)
    return h('li', {class: 'leaf'}, label(f, peak));
  const details = h('details', null, h('summary', null, label(f, peak),
                                       h('span', {class: 'muted'}, ` (${f.children.length} callers)`)));
  details.addEventListener('toggle', () => {
    if (details.childElementCount === 1)
      details.append(h('ul', null, callers(f, peak)));
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
