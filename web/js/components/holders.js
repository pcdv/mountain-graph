// @ts-check
/**
 * What a heap's panel says of who holds a peak: the chain of holders out to
 * the root, the other direction of a heap, where an object is held by the
 * objects above it.
 */
import {h} from '../lib/dom.js';
import {callersTree} from './callers.js';
import {amount} from '../model/units.js';
import {outermostOf} from '../model/ownership.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * Who holds the peak, and who holds that, out to the root, each a name to click.
 *
 * @param {Frame | undefined} chain
 * @param {Frame} tree the mountain of the peak
 * @param {import('../model/units.js').Unit} unit
 * @param {(f: Frame) => void} pick shows the object clicked, in place of this one
 * @returns {Node[]}
 */
export function heldBy(chain, tree, unit, pick) {
  if (!chain)
    return [h('div', {class: 'muted'}, 'Who holds it is not known for this peak.')];
  const top = outermostOf(chain);
  return [
    h('div', {class: 'muted'}, `${amount(tree.total, unit)} at the top; who holds it, the nearest first, `
      + `each as a share of the ${amount(top, unit)} the outermost holds:`),
    callersTree(chain, 'holders', unit, {flat: true, shareTotal: top, onPick: pick}),
  ];
}

/**
 * The chain holding the peak, in a line, when the view knows it: a heap's peak hangs from other
 * objects, and the panel would otherwise show only what it holds.
 *
 * @param {Frame} tree the mountain of the peak
 * @returns {HTMLElement[]}
 */
export function holdersOf(tree) {
  const holders = /** @type {{holders?: string[]}} */ (tree).holders ?? [];
  if (holders.length === 0)
    return [];
  // the nearest holders, out to the root: the chain can be dozens of frames long
  const shown = holders.slice(0, 8);
  const more = holders.length > shown.length ? ` ← … (${holders.length - shown.length} more)` : '';
  return [h('div', {class: 'muted', title: holders.join(' ← ')}, `Held by ${shown.join(' ← ')}${more}`)];
}
