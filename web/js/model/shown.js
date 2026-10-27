// @ts-check
/**
 * The samples a view shows, as a profile of their own: what its settings leave out is not in it, to save
 * only what is shown. The settings are those of the page, applied as it applies them (profile.js, samples.js):
 * the waits are left out by their top frame, before any frame is hidden; the native samples go when only
 * Java's are shown; an interval and an operation keep their samples; the frames hidden are taken out of the
 * stacks, their time going to their callers.
 *
 * No DOM: tested with Node.
 */
import {leaveOut} from './samples.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */

/**
 * What the settings of a view keep of a profile.
 *
 * @typedef {object} View
 * @property {string} waits a regular expression for the top frames of the samples left out, empty for none
 * @property {string} hide a regular expression for the frames taken out of the stacks, empty for none
 * @property {boolean} java whether only the samples of Java code are kept
 * @property {number} [from] seconds since the start of the recording: the samples before are left out
 * @property {number} [to] seconds since the start of the recording: the samples from then on are left out
 * @property {string | null} [operation] the one operation shown, by name: the samples of the others, and
 *           outside operations, are left out
 */

/**
 * @param {string} pattern a regular expression; none when empty or invalid, as the page takes it
 * @returns {RegExp | null}
 */
function matcher(pattern) {
  try {
    return pattern ? new RegExp(pattern) : null;
  }
  catch (e) {
    return null;
  }
}

/**
 * @param {View} view
 * @returns {string[]} what it leaves out, in words, for what it does leave out
 */
export function leavesOut(view) {
  const left = [];
  if (matcher(view.waits))
    left.push('the waits');
  if (matcher(view.hide))
    left.push('the hidden frames');
  if (view.java)
    left.push('the native samples');
  if (view.from !== undefined || view.to !== undefined)
    left.push('what is outside the interval');
  if (view.operation)
    left.push('what is outside the operation');
  return left;
}

/**
 * @param {Profile} p
 * @param {View} view
 * @returns {Profile} the samples the view keeps, in order, over the stacks it shows: p itself when it keeps
 *          everything as it is. Threads no sample is on any more are dropped, unless the profile has operations,
 *          which refer to them.
 */
export function shown(p, view) {
  const q = leaveOut(p, view.waits).profile;
  const hide = matcher(view.hide);
  const hidden = hide ? Uint8Array.from(q.strings, s => hide.test(s) ? 1 : 0) : null;
  // whether a frame of the stacks is hidden: the page hides the JDK's by default, which a profile may not show
  let any = false;
  if (hidden)
    for (let n = 0; n < q.frame.length && !any; n++)
      any = hidden[q.frame[n] >>> 3] === 1;

  const lo = view.from === undefined ? -Infinity : view.from * 1000;
  const hi = view.to === undefined ? Infinity : view.to * 1000;
  /** @type {number[]} */
  const kept = [];
  for (let i = 0; i < q.stack.length; i++) {
    if (q.time[i] < lo || q.time[i] >= hi || (view.java && q.kind[i] !== 0))
      continue;
    if (view.operation) {
      const op = q.operation[i];
      if (op < 0 || q.strings[q.operations.name[op]] !== view.operation)
        continue;
    }
    kept.push(i);
  }
  if (q === p && kept.length === p.stack.length && !any)
    return p;

  // the stacks without the frames hidden: a node is made after its parent, by any reader; two that come to
  // the same frame under the same caller are one
  let {parent, frame} = q;
  /** @type {Int32Array | null} */
  let node = null;
  if (hidden && any) {
    node = new Int32Array(q.parent.length);
    /** @type {number[]} */
    const parents = [], frames = [];
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (let n = 0; n < q.parent.length; n++) {
      const up = q.parent[n] < 0 ? -1 : node[q.parent[n]];
      if (hidden[q.frame[n] >>> 3]) {
        node[n] = up;
        continue;
      }
      const key = `${up}:${q.frame[n]}`;
      let id = seen.get(key);
      if (id === undefined) {
        id = parents.push(up) - 1;
        frames.push(q.frame[n]);
        seen.set(key, id);
      }
      node[n] = id;
    }
    parent = Int32Array.from(parents);
    frame = Int32Array.from(frames);
  }
  const stackOf = (/** @type {number} */ i) => q.stack[i] < 0 || !node ? q.stack[i] : node[q.stack[i]];

  let {threads} = q;
  let threadOf = (/** @type {number} */ i) => q.thread[i];
  if (q.operations.count === 0) {
    const index = new Map();
    threads = [];
    for (const i of kept) {
      if (!index.has(q.thread[i])) {
        index.set(q.thread[i], threads.length);
        threads.push(q.threads[q.thread[i]]);
      }
    }
    threadOf = i => index.get(q.thread[i]);
  }
  return {
    ...q,
    parent,
    frame,
    time: Float64Array.from(kept, i => q.time[i]),
    stack: Int32Array.from(kept, stackOf),
    thread: Int32Array.from(kept, threadOf),
    operation: Int32Array.from(kept, i => q.operation[i]),
    kind: Uint8Array.from(kept, i => q.kind[i]),
    weight: q.weight && Float64Array.from(kept, i => /** @type {Float64Array} */ (q.weight)[i]),
    threads,
  };
}
