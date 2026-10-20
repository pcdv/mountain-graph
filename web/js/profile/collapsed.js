// @ts-check
/**
 * Collapsed stacks, as Brendan Gregg's stackcollapse-* scripts and async-profiler write them: a line
 * per distinct stack, its frames from the root to the top joined by ';', then the count of samples
 * that had it (`main;run;work 12`). Read into the same Profile as a profile of jfr-web, with what
 * such a file lacks left empty: a single thread, no operation, no time. Each line is a sample
 * weighing its count, and the unit of the profile is 'samples'.
 *
 * perf's annotations at the end of a frame (`_[k]` kernel, `_[j]` Java, `_[i]` inlined) tell its
 * type and are removed from its name.
 *
 * No DOM: tested with Node.
 */
import {COMPILED, INLINED, NATIVE} from './profile.js';

/** @typedef {import('./profile.js').Profile} Profile */

const ANNOTATION = /_\[([kjiw])\]$/;
const TYPES = {k: NATIVE, j: COMPILED, i: INLINED, w: COMPILED};

/**
 * @param {string} text
 * @returns {boolean} whether it looks like collapsed stacks: its first line that is not a comment
 *          ends with a count
 */
export function isCollapsed(text) {
  for (const line of lines(text))
    return /\s\d+(\.\d+)?\s*$/.test(line);
  return false;
}

/**
 * @param {string} text
 * @returns {Profile} one sample per line, in the order of the file
 * @throws {Error} naming the line that has no count, or no stack
 */
export function readCollapsed(text) {
  /** @type {string[]} */
  const strings = [''];
  /** @type {Map<string, number>} */
  const stringIndex = new Map();
  /** @type {number[]} */
  const parent = [], frame = [];
  /** @type {Map<string, number>} */
  const nodes = new Map();
  /** @type {number[]} */
  const stack = [], weight = [];

  /** @param {string} s */
  const intern = s => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      stringIndex.set(s, i);
    }
    return i;
  };

  let n = 0;
  for (const line of lines(text)) {
    n++;
    const cut = line.search(/\s\S+\s*$/);
    const count = cut < 0 ? NaN : Number(line.slice(cut));
    const path = cut < 0 ? '' : line.slice(0, cut).trim();
    if (!Number.isFinite(count) || count < 0 || !path)
      throw new Error(`Line ${n} is not a collapsed stack, "frame;frame;... count": ${line.slice(0, 60)}`);
    let node = -1;
    for (const name of path.split(';')) {
      const note = ANNOTATION.exec(name);
      const f = intern(note ? name.slice(0, note.index) : name) << 3
              | (note ? TYPES[/** @type {'k' | 'j' | 'i' | 'w'} */ (note[1])] : COMPILED);
      const key = `${node}:${f}`;
      let child = nodes.get(key);
      if (child === undefined) {
        child = parent.push(node) - 1;
        frame.push(f);
        nodes.set(key, child);
      }
      node = child;
    }
    stack.push(node);
    weight.push(count);
  }

  const size = stack.length;
  return {
    strings,
    parent: Int32Array.from(parent),
    frame: Int32Array.from(frame),
    time: new Float64Array(size),
    stack: Int32Array.from(stack),
    thread: new Int32Array(size),
    operation: new Int32Array(size).fill(-1),
    kind: new Uint8Array(size),
    weights: [1, 1],
    // not one of jfr-web's units: see units.js
    unit: /** @type {any} */ ('samples'),
    weight: Float64Array.from(weight),
    start: '',
    end: 0,
    threads: [{name: 'all', id: 0}],
    operations: {
      count: 0,
      name: new Int32Array(0), start: new Float64Array(0), duration: new Float64Array(0),
      thread: new Int32Array(0), detail: new Int32Array(0), status: new Int32Array(0),
      failed: new Uint8Array(0), error: new Int32Array(0), async: new Uint8Array(0),
      bytesIn: new Float64Array(0), bytesOut: new Float64Array(0),
    },
  };
}

/**
 * @param {string} text
 * @returns {Generator<string>} its lines that are neither empty nor comments
 */
function* lines(text) {
  for (const line of text.split(/\r?\n/))
    if (line.trim() && !line.startsWith('#'))
      yield line;
}
