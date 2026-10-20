// @ts-check
/**
 * Samples left out of a profile before anything is summed: those of threads
 * waiting. A thread blocked in a poll or an accept is sampled as often as one
 * working, and in a server most of them are: their time would hide the
 * work. Told by the frame at the top of the stack, before any is hidden,
 * so that a wait reached through application code is left out too.
 *
 * No DOM: tested with Node.
 */

import {weightOf} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */

/**
 * The waits left out by default: polls, accepts and socket reads (the
 * network idle), monitors, parks and sleeps (threads idle), and the
 * recorder's own threads.
 */
export const WAITS = String.raw`\.(WEPoll|EPoll)\.wait|\.KQueue\.poll|\.Net\.(accept|poll)|SocketDispatcher\.read`
                     + String.raw`|socketRead|\.Object\.wait|\.Unsafe\.park|\.Thread\.sleep|^jdk\.jfr\.`;

/**
 * @param {Profile} p
 * @param {string} pattern a regular expression for the top frames of the samples left out; none
 *        left out when empty or invalid
 * @returns {{profile: Profile, left: number}} the profile without them (p itself when none is
 *          left out), and the ms they weighed
 */
export function leaveOut(p, pattern) {
  let re;
  try {
    re = pattern ? new RegExp(pattern) : null;
  }
  catch (e) {
    re = null;
  }
  if (!re)
    return {profile: p, left: 0};
  const matches = new Uint8Array(p.strings.length);
  p.strings.forEach((s, i) => matches[i] = re.test(s) ? 1 : 0);

  /** @type {number[]} */
  const kept = [];
  let left = 0;
  for (let i = 0; i < p.stack.length; i++) {
    const top = p.stack[i];
    if (top >= 0 && matches[p.frame[top] >>> 3])
      left += weightOf(p, i);
    else
      kept.push(i);
  }
  if (kept.length === p.stack.length)
    return {profile: p, left: 0};
  return {
    profile: {
      ...p,
      time: Float64Array.from(kept, i => p.time[i]),
      stack: Int32Array.from(kept, i => p.stack[i]),
      thread: Int32Array.from(kept, i => p.thread[i]),
      operation: Int32Array.from(kept, i => p.operation[i]),
      kind: Uint8Array.from(kept, i => p.kind[i]),
      weight: p.weight && Float64Array.from(kept, i => /** @type {Float64Array} */ (p.weight)[i]),
    },
    left,
  };
}
