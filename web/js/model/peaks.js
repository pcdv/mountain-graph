// @ts-check
/**
 * The peaks of a profile: the methods its samples ran in most, each the top
 * of a mountain. A sample has one top frame, so it belongs to one peak at
 * most: the peaks and the plain (the samples whose top is no peak) add up to
 * all the samples kept, and the peaks' share of them is the coverage.
 *
 * No DOM: tested with Node.
 */
import {hotMethods} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */

/**
 * @typedef {object} Peak
 * @property {string} name of the method
 * @property {number} self ms of the samples it ran in, at the top of the stack: its mountain
 * @property {number} total ms of the samples it was anywhere in
 * @property {number} share its self time over that of all the samples kept, 0 to 1
 */

/**
 * @typedef {object} Peaks
 * @property {Peak[]} peaks the most self time first
 * @property {number} plain ms of the samples whose top frame is no peak, those with no method
 *           at the top included
 * @property {number} bare ms of the plain's samples with no method at the top: no stack, or all
 *           its frames hidden (a thread running only JDK code, with the JDK hidden)
 * @property {number} coverage the share of the time the peaks hold, 0 to 1
 * @property {number} total ms of all the samples kept
 */

/**
 * @typedef {object} PeakOptions
 * @property {number} [count] the most peaks to take, 10 by default
 * @property {number} [coverage] a share of the time, 0 to 1: no more peaks are taken once the
 *           ones taken hold it; 1 by default, taking count peaks
 */

/**
 * The methods with the most self time, as peaks: as many as count, fewer when
 * those taken already reach the coverage asked or no other method ran.
 *
 * @param {Profile} p
 * @param {Filter} filter the samples kept, and the frames hidden: their time goes to the first
 *        frame under them that is not
 * @param {PeakOptions} [options]
 * @returns {Peaks}
 */
export function peaks(p, filter, {count = 10, coverage = 1} = {}) {
  const {methods, total} = hotMethods(p, filter);
  /** @type {Peak[]} */
  const taken = [];
  let self = 0, bare = total;
  for (const m of methods)
    bare -= m.self;
  for (const m of methods) {
    if (taken.length >= count || m.self <= 0 || (total > 0 && self / total >= coverage))
      break;
    taken.push({name: m.name, self: m.self, total: m.total, share: total > 0 ? m.self / total : 0});
    self += m.self;
  }
  return {peaks: taken, plain: total - self, bare, coverage: total > 0 ? self / total : 0, total};
}
