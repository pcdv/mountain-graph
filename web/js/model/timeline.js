// @ts-check
/**
 * What a timeline shows of a profile: the weight of its samples over time, and the interval a
 * selection on it stands for. A profile of collapsed stacks has no time, so no timeline.
 *
 * No DOM: tested with Node.
 */
import {timeOf, weightOf, NO_OPERATION} from '../profile/profile.js';

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

/** The operations given a series of their own: the others are added up. */
export const MAX_SERIES = 8;

/**
 * @typedef {object} OperationSeries
 * @property {string} name of the operation
 * @property {number} total the weight of its samples in the whole recording
 * @property {Float64Array} ms the weight of its samples in each bucket
 */

/**
 * @typedef {object} Operations
 * @property {OperationSeries[]} series the operations with the most weight, the heaviest first
 * @property {Float64Array | null} other the weight of the samples of the others in each bucket, none
 *           if every operation has a series
 * @property {Float64Array | null} none the weight of the samples outside any operation, none if there
 *           are none
 */

/**
 * What the weight of the samples in each bucket is made of, by operation: the heaviest operations
 * by name, the others together, and the samples outside any.
 *
 * @param {Profile} p
 * @param {Filter} filter the samples counted, with no interval
 * @param {number} count the number of buckets, those of histogram()
 * @returns {Operations | null} none when the recording has no time, or no sample in an operation
 */
export function operations(p, filter, count) {
  const ms = span(p);
  if (ms <= 0 || count < 1 || p.operations.count === 0)
    return null;
  /** @type {Map<number, number>} the weight of the samples of each operation name */
  const totals = new Map();
  for (let i = 0; i < p.operation.length; i++) {
    const op = p.operation[i];
    if (op >= 0 && !(filter.java && p.kind[i] !== 0))
      totals.set(p.operations.name[op], (totals.get(p.operations.name[op]) ?? 0) + weightOf(p, i));
  }
  if (totals.size === 0)
    return null;
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, MAX_SERIES);
  const by = {...filter, merged: false, all: true};
  const bucket = ms / count;
  const series = top.map(([name, total]) =>
    ({name: p.strings[name], total, ms: timeOf(p, by, [p.strings[name]], 0, bucket, count)}));
  const none = timeOf(p, by, [NO_OPERATION], 0, bucket, count);
  /** @type {Float64Array | null} */
  let other = null;
  if (totals.size > top.length) {
    other = timeOf(p, by, [], 0, bucket, count);
    for (let b = 0; b < count; b++)
      other[b] = Math.max(0, other[b] - none[b] - series.reduce((sum, s) => sum + s.ms[b], 0));
  }
  return {series, other, none: none.some(v => v > 0) ? none : null};
}

/**
 * @typedef {object} Interval
 * @property {number} [from] seconds since the start of the recording, none from the start
 * @property {number} [to] seconds since the start of the recording, none up to the end
 */

/**
 * @param {any} i what was kept of an interval: not to be trusted
 * @param {number} ms the duration of the recording it is applied to
 * @returns {Interval | null} it if it is a part of the recording, none otherwise
 */
export function checked(i, ms) {
  if (!i || typeof i !== 'object')
    return null;
  const {from, to} = i;
  const ok = (/** @type {any} */ v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= ms / 1000);
  if (!ok(from) || !ok(to) || (from === undefined && to === undefined) || (from ?? 0) >= (to ?? ms / 1000))
    return null;
  /** @type {Interval} */
  const kept = {};
  if (from !== undefined)
    kept.from = from;
  if (to !== undefined)
    kept.to = to;
  return kept;
}

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
