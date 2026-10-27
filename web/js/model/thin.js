// @ts-check
/**
 * A profile of samples with its thin stacks gathered into one frame: a file
 * smaller, for a gallery or a report, that still shows where the time goes.
 *
 * A sample's stack is thin when it is thin both ways: in the flame graph, its
 * innermost node holds less than `least` of all the samples; in the peaks, the
 * method at its top runs less than that, wherever it is called from, and so do
 * its class and its package. Its
 * stack is cut at its deepest caller that is not thin, a synthetic frame,
 * THIN, on top: the flame graph's frames wide enough keep their width, and
 * the sample keeps its time, thread and operation, so the timeline and the
 * totals stay what they were, and so do the methods that take time. What goes
 * is the paths to the methods hardly run, and their names.
 *
 * No DOM: tested with Node.
 */
import {SYNTHETIC, weightOf} from '../profile/profile.js';
import {owner} from './peaks.js';

/** @type {import('./peaks.js').Grain[]} what a peak may gather: a stack is thin for none of them */
const GRAINS = ['method', 'class', 'package'];

/** @typedef {import('../profile/profile.js').Profile} Profile */

/** The frame the thin stacks are gathered into. */
export const THIN = '(thin stacks)';

/**
 * How much may be lost.
 *
 * @typedef {object} Thinning
 * @property {number} least 0 to 1: a stack is thin below this share of all the samples, both ways
 */

/** @type {Thinning[]} */
export const LEVELS = [{least: 1e-3}, {least: 3e-3}, {least: 1e-2}];

/** What each level is called and says, for whoever chooses one. */
export const LEVEL_TEXT = [0.1, 0.3, 1].map((share, i) => ({
  name: ['Little', 'Some', 'Much'][i],
  about: `the paths to the methods under ${share}% of the time, where the flame graph is as thin, end in ${THIN}; `
    + `a method's total misses those it is on${i === 2 ? ', and the lightest peaks may lose time' : ''}`,
}));

/** The level proposed. */
export const DEFAULT_LEVEL = 1;

/**
 * @param {Profile} p
 * @param {Thinning} thinning
 * @returns {Profile} the same samples, the thin ones on THIN; the nodes no sample is on any more stay,
 *          for whoever writes it to leave out
 */
export function thin(p, {least}) {
  const n = p.parent.length;
  const total = new Float64Array(n);
  /** @type {Map<string, number>[]} the time at the top of each method, class and package, by name */
  const self = GRAINS.map(() => new Map());
  let all = 0;
  for (let i = 0; i < p.stack.length; i++) {
    const w = weightOf(p, i);
    all += w;
    const node = p.stack[i];
    if (node < 0)
      continue;
    total[node] += w;
    const name = p.strings[p.frame[node] >>> 3];
    GRAINS.forEach((grain, g) => {
      const key = owner(name, grain);
      self[g].set(key, (self[g].get(key) ?? 0) + w);
    });
  }
  // a node is made after its parent, by any reader
  for (let i = n - 1; i >= 0; i--) {
    if (p.parent[i] >= 0)
      total[p.parent[i]] += total[i];
  }

  const floor = least * all;
  const strings = [...p.strings];
  let name = strings.indexOf(THIN);
  if (name < 0)
    name = strings.push(THIN) - 1;
  const parent = [...p.parent], frame = [...p.frame];
  /** @type {Map<number, number>} the THIN node under each caller kept, -1 for none */
  const under = new Map();
  /** @param {number} node @returns {boolean} the method at its top, its class or its package runs enough */
  const runs = node => {
    const name = p.strings[p.frame[node] >>> 3];
    return GRAINS.some((grain, g) => /** @type {number} */ (self[g].get(owner(name, grain))) >= floor);
  };
  const stack = Int32Array.from(p.stack, node => {
    if (node < 0 || total[node] >= floor || runs(node))
      return node;
    let caller = p.parent[node];
    while (caller >= 0 && total[caller] < floor)
      caller = p.parent[caller];
    let lump = under.get(caller);
    if (lump === undefined) {
      under.set(caller, lump = parent.push(caller) - 1);
      frame.push(name << 3 | SYNTHETIC);
    }
    return lump;
  });
  return {...p, strings, parent: Int32Array.from(parent), frame: Int32Array.from(frame), stack};
}
