// @ts-check
/**
 * The profile of a heap dump: every path from a root to the objects at its
 * end, as jheap's parse gives it, with their bytes and their objects. Read
 * from the document jheap writes, written back as the page exports it, and
 * turned to collapsed stacks and back.
 *
 * The document is Flamepack's, written as version 5, which is read here and in
 * jfr-web as well as version 4. Strings are sorted and front-coded, the stack
 * nodes depth first, in columns. A heap profile has no time, thread or
 * operation, which version 5 leaves out: its samples are sorted by stack, so
 * that the stacks written as differences cost next to nothing, and its
 * weights are bytes. The column `samples.objects`, the objects of each
 * sample, is a heap's own. `decodeHeap` reads it.
 *
 * No DOM: tested with Node.
 */
import {COMPILED, SYNTHETIC, decode, weightOf} from './profile.js';

/** The version of the document `encode` writes. */
const VERSION = 5;

/**
 * The frame that stands for objects folded away by a reduction (model/reduce.js): synthetic,
 * and kept so when stacks are written as text and read back.
 */
export const FOLD = '(…)';

/** @typedef {import('./profile.js').Profile} Profile */

/**
 * A profile of a heap dump: jfr-web's, with the objects of each sample beside
 * the bytes its weight says. Kept out of profile.js, which is the same file in
 * jfr-web and mountain-graph.
 *
 * @typedef {Profile & {objects?: Float64Array | null}} HeapProfile
 */

/**
 * Reads a document as a heap profile: what jfr-web's decode reads, and the
 * objects of each sample when the document has them. A profile saved before
 * they were counted has none: `objects` is null, and the counts are not shown.
 *
 * @param {any} doc
 * @returns {HeapProfile}
 */
export function decodeHeap(doc) {
  const objects = doc.samples?.objects;
  return Object.assign(decode(doc), {objects: Array.isArray(objects) ? Float64Array.from(objects) : null});
}

/**
 * @param {HeapProfile} p a heap's: no time, thread or operation is written
 * @returns {object} the document, ready for JSON.stringify
 */
export function encode(p) {
  // names sorted, for their front coding: each renumbered by its rank
  /** @type {Set<string>} */
  const names = new Set();
  for (let i = 0; i < p.frame.length; i++)
    names.add(p.strings[p.frame[i] >>> 3]);
  const sorted = [...names].sort();
  /** @type {Map<string, number>} */
  const rank = new Map(sorted.map((s, i) => [s, i]));

  /** @type {string[]} */
  const strings = [];
  let previous = '';
  for (const name of sorted) {
    // 95 at most: the character stays printable ASCII
    const max = Math.min(previous.length, name.length, 95);
    let shared = 0;
    while (shared < max && previous[shared] === name[shared])
      shared++;
    strings.push(String.fromCharCode(shared + 32) + name.substring(shared));
    previous = name;
  }

  // nodes depth first, each renumbered by its position
  const n = p.parent.length;
  /** @type {number[][]} */
  const children = Array.from({length: n}, () => []);
  /** @type {number[]} */
  const roots = [];
  for (let i = 0; i < n; i++) {
    if (p.parent[i] < 0)
      roots.push(i);
    else
      children[p.parent[i]].push(i);
  }
  const position = new Int32Array(n);
  const depth = new Int32Array(n);
  /** @type {number[]} */
  const order = [];
  /** @type {number[]} */
  const stack = [];
  // pushed in reverse, to come out in order
  for (let i = roots.length - 1; i >= 0; i--)
    stack.push(roots[i]);
  while (stack.length > 0) {
    const node = /** @type {number} */ (stack.pop());
    const parent = p.parent[node];
    depth[node] = parent < 0 ? 0 : depth[parent] + 1;
    position[node] = order.length;
    order.push(node);
    const cs = children[node];
    for (let i = cs.length - 1; i >= 0; i--)
      stack.push(cs[i]);
  }

  /** @type {number[]} */
  const stackDepth = [], stackName = [], stackType = [];
  for (const node of order) {
    const frame = p.frame[node];
    stackDepth.push(depth[node]);
    stackName.push(/** @type {number} */ (rank.get(p.strings[frame >>> 3])));
    stackType.push(frame & 7);
  }

  // by stack, the samples with none first: the node plus 1 as the difference with the last
  const sample = Array.from(p.stack, (node, i) => i)
    .sort((a, b) => (p.stack[a] < 0 ? 0 : position[p.stack[a]] + 1) - (p.stack[b] < 0 ? 0 : position[p.stack[b]] + 1));
  let last = 0;
  const differences = sample.map(i => {
    const next = p.stack[i] < 0 ? 0 : position[p.stack[i]] + 1;
    const d = next - last;
    last = next;
    return d;
  });
  const weight = p.weight;
  const kind = sample.map(i => p.kind[i]);
  const weights = p.weights.length === 1 && p.weights[0] === 1 ? {} : {weights: p.weights};
  return {
    version: VERSION,
    unit: p.unit,
    // what a version 5 document says only when it differs from what a reader assumes
    ...weight ? {} : weights,
    strings,
    stacks: {depth: stackDepth, name: stackName, ...stackType.some(t => t !== 0) ? {type: stackType} : {}},
    samples: {
      stack: differences,
      ...kind.some(k => k !== 0) ? {kind} : {},
      ...weight ? {weight: sample.map(i => weight[i])} : {},
      ...p.objects ? {objects: sample.map(i => /** @type {Float64Array} */ (p.objects)[i])} : {},
    },
  };
}

/**
 * Convert aggregated stacks to a Profile.
 *
 * @param {Map<string, number>} stacks path → size
 * @param {Map<string, number>} [objects] path → the objects that end there: the profile's
 *        `objects`, which a profile made without them does not have
 * @returns {HeapProfile}
 */
export function stacksToProfile(stacks, objects) {
  /** @type {string[]} */
  const strings = [''];
  /** @type {Map<string, number>} */
  const stringIndex = new Map();
  /** @type {number[]} */
  const parent = [], frame = [];
  /** @type {Map<string, number>} */
  const nodes = new Map();
  /** @type {number[]} */
  const stack = [], weight = [], count = [];

  /** @param {string} s */
  const intern = s => {
    let i = stringIndex.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      stringIndex.set(s, i);
    }
    return i;
  };

  // Sorted, so the same dump gives the same profile whatever order the walk
  // found its paths in: an export can then be compared with another.
  for (const [path, size] of [...stacks].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    if (size <= 0) continue;

    let node = -1;
    for (const name of path.split(';')) {
      const f = intern(name) << 3 | (name === FOLD ? SYNTHETIC : COMPILED);
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
    weight.push(size);
    count.push(objects?.get(path) ?? 0);
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
    unit: /** @type {any} */ ('bytes'),
    weight: Float64Array.from(weight),
    objects: objects ? Float64Array.from(count) : null,
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
 * The collapsed stacks of a profile: the paths it was built from, each with the
 * bytes it holds. The inverse of stacksToProfile, so a profile kept in the
 * browser gives the same stacks back.
 *
 * @param {Profile} p
 * @returns {Map<string, number>} path → bytes, root first, object last
 */
export function stacksOf(p) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (let i = 0; i < p.stack.length; i++) {
    /** @type {string[]} */
    const frames = [];
    for (let node = p.stack[i]; node >= 0; node = p.parent[node])
      frames.unshift(p.strings[p.frame[node] >>> 3]);
    const key = frames.join(';');
    out.set(key, (out.get(key) ?? 0) + weightOf(p, i));
  }
  return out;
}
