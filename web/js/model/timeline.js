// @ts-check
/**
 * What a timeline shows of a profile: the weight of its samples over time, and the interval a
 * selection on it stands for. A profile of collapsed stacks has no time, so no timeline.
 *
 * No DOM: tested with Node.
 */
import {timeOf} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */

/**
 * @param {Profile} p
 * @returns {number} ms the recording lasted, 0 when its samples have no time
 */
export function span(p) {
  if (!p.start)
    return 0;
  const last = p.time.length > 0 ? p.time[p.time.length - 1] : 0;
  return Math.max(p.end / 1e6, last);
}

/**
 * @param {Profile} p
 * @param {Filter} filter the samples counted, with no interval: the whole recording is shown
 * @param {number} count the number of buckets
 * @returns {{span: number, ms: Float64Array}} the recording's duration in ms, and the weight of the
 *          samples in each of the buckets that divide it; no buckets when it has no time
 */
export function histogram(p, filter, count) {
  const ms = span(p);
  if (ms <= 0 || count < 1)
    return {span: 0, ms: new Float64Array(0)};
  return {span: ms, ms: timeOf(p, filter, [], 0, ms / count, count)};
}

/**
 * @typedef {object} Interval
 * @property {number} [from] seconds since the start of the recording, none from the start
 * @property {number} [to] seconds since the start of the recording, none up to the end
 */

/**
 * @param {number} a where a selection began, as a share of the timeline's width: 0 to 1
 * @param {number} b where it ended, before or after a
 * @param {number} ms the duration of the recording
 * @returns {Interval | null} the interval it stands for, none when it is empty or reaches both
 *          ends: that is the whole recording
 */
export function interval(a, b, ms) {
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(1, Math.max(a, b));
  if (!(hi > lo) || (lo === 0 && hi === 1))
    return null;
  /** @type {Interval} */
  const i = {};
  if (lo > 0)
    i.from = lo * ms / 1000;
  if (hi < 1)
    i.to = hi * ms / 1000;
  return i;
}
