// @ts-check
/**
 * A profile of samples written back as a Flamepack document of version 5: a
 * recording, a V8 profile or collapsed stacks, as the page read it, saved as
 * the .fpk it opens again (jfr-web reads it too). What heap.js writes for a
 * heap shares the strings and stacks written here.
 *
 * Only what the samples reach is written: the nodes they are on, the strings
 * those nodes, the threads and the operations name. What a column holds when
 * it is left out is left out.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('./profile.js').Profile} Profile */

/** The version of the document written. */
const VERSION = 5;

/**
 * The strings and the stack tree of a document: the names sorted and front-coded, the nodes the
 * samples are on depth first, in columns.
 *
 * @param {Profile} p
 * @param {Iterable<string>} [more] strings the document refers to besides the frames' names
 * @returns {{strings: string[], rank: Map<string, number>, stacks: object, position: Int32Array}}
 *          the strings and the index of each, the stacks, and the place of each node of p in them
 *          plus 1, 0 for a node no sample is on
 */
export function packStacks(p, more = []) {
  const n = p.parent.length;
  const used = new Uint8Array(n);
  for (const s of p.stack) {
    for (let j = s; j >= 0 && !used[j]; j = p.parent[j])
      used[j] = 1;
  }

  // names sorted, for their front coding: each renumbered by its rank
  /** @type {Set<string>} */
  const names = new Set(more);
  for (let i = 0; i < n; i++) {
    if (used[i])
      names.add(p.strings[p.frame[i] >>> 3]);
  }
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
  /** @type {number[][]} */
  const children = Array.from({length: n}, () => []);
  /** @type {number[]} */
  const roots = [];
  for (let i = 0; i < n; i++) {
    if (!used[i])
      continue;
    if (p.parent[i] < 0)
      roots.push(i);
    else
      children[p.parent[i]].push(i);
  }
  const position = new Int32Array(n);
  const depth = new Int32Array(n);
  /** @type {number[]} */
  const depths = [], nameOf = [], types = [];
  /** @type {number[]} */
  const stack = [];
  // pushed in reverse, to come out in order
  for (let i = roots.length - 1; i >= 0; i--)
    stack.push(roots[i]);
  while (stack.length > 0) {
    const node = /** @type {number} */ (stack.pop());
    const parent = p.parent[node];
    depth[node] = parent < 0 ? 0 : depth[parent] + 1;
    position[node] = depths.length + 1;
    depths.push(depth[node]);
    nameOf.push(/** @type {number} */ (rank.get(p.strings[p.frame[node] >>> 3])));
    types.push(p.frame[node] & 7);
    const cs = children[node];
    for (let i = cs.length - 1; i >= 0; i--)
      stack.push(cs[i]);
  }
  const stacks = {depth: depths, name: nameOf, ...types.some(t => t !== 0) ? {type: types} : {}};
  return {strings, rank, stacks, position};
}

/**
 * @param {number[]} values
 * @returns {number[]} each minus the one before it
 */
function differences(values) {
  let last = 0;
  return values.map(v => {
    const d = v - last;
    last = v;
    return d;
  });
}

/**
 * @param {Profile} p a profile of samples, as decode or a reader of recordings gives it
 * @param {object} [meta] what the document says of itself: its kind (cpu, wall, alloc), what wrote it
 * @returns {object} the document, ready for JSON.stringify
 */
export function encodeSamples(p, meta = {}) {
  const o = p.operations;
  /** @type {string[]} */
  const more = p.threads.map(t => t.name).filter(name => name !== '');
  for (let i = 0; i < o.count; i++) {
    for (const s of [o.name[i], o.detail[i], o.error[i]]) {
      if (s >= 0)
        more.push(p.strings[s]);
    }
  }
  const {strings, rank, stacks, position} = packStacks(p, more);
  /** @param {number} s an index in p's strings, -1 for none */
  const index = s => s < 0 ? -1 : /** @type {number} */ (rank.get(p.strings[s]));

  // in time order, as the spec wants them; with no time, by stack, so that the differences cost
  // next to nothing
  const count = p.stack.length;
  const timed = p.time.some(t => t !== 0);
  const order = Array.from({length: count}, (_, i) => i);
  /** @param {number} i */
  const node = i => p.stack[i] < 0 ? 0 : position[p.stack[i]];
  if (!timed)
    order.sort((a, b) => node(a) - node(b));
  /** @param {ArrayLike<number>} column @returns {number[]} */
  const ordered = column => order.map(i => column[i]);
  /** @param {number[]} column @param {number} value @returns {boolean} */
  const all = (column, value) => column.every(v => v === value);

  const thread = ordered(p.thread), operation = ordered(p.operation), kind = ordered(p.kind);
  const samples = {
    stack: differences(order.map(node)),
    ...timed ? {time: differences(ordered(p.time))} : {},
    ...all(thread, 0) ? {} : {thread},
    ...all(operation, -1) ? {} : {operation},
    ...p.weight ? {weight: ordered(p.weight)} : all(kind, 0) ? {} : {kind},
  };

  /** @type {any} */
  // collapsed stacks count samples, which version 5 calls a count
  const doc = {version: VERSION, unit: /** @type {string} */ (p.unit) === 'samples' ? 'count' : p.unit};
  if (!p.weight && !(p.weights.length === 1 && p.weights[0] === 1))
    doc.weights = p.weights;
  if (p.start)
    doc.start = p.start;
  if (p.end)
    doc.end = p.end;
  doc.strings = strings;
  doc.stacks = stacks;
  doc.samples = samples;
  doc.threads = p.threads.map(t => [t.name === '' ? -1 : /** @type {number} */ (rank.get(t.name)), t.id]);
  if (o.count > 0)
    doc.operations = operationsOf(p, index);
  if (Object.keys(meta).length > 0)
    doc.meta = meta;
  return doc;
}

/**
 * @param {Profile} p
 * @param {(s: number) => number} index of a string of p in the document's
 * @returns {object} the operations, as columns
 */
function operationsOf(p, index) {
  const o = p.operations;
  // the profile keeps the name of an operation's thread; the document, the thread: the first of that name
  /** @type {Map<string, number>} */
  const threadOf = new Map();
  p.threads.forEach((t, i) => {
    if (!threadOf.has(t.name))
      threadOf.set(t.name, i);
  });
  /** @param {ArrayLike<number>} column */
  const list = column => Array.from(column);
  /** @param {string} key @param {number[]} column @param {number} value */
  const optional = (key, column, value) => column.every(v => v === value) ? {} : {[key]: column};
  const thread = list(o.thread).map(s => s < 0 ? -1 : threadOf.get(p.strings[s]) ?? -1);
  return {
    name: list(o.name).map(index),
    start: differences(list(o.start)),
    duration: list(o.duration),
    ...optional('thread', thread, -1),
    ...optional('detail', list(o.detail).map(index), -1),
    ...optional('error', list(o.error).map(index), -1),
    ...optional('failed', list(o.failed), 0),
    ...optional('async', list(o.async), 0),
    ...optional('status', list(o.status), 0),
    ...optional('bytesIn', list(o.bytesIn), 0),
    ...optional('bytesOut', list(o.bytesOut), 0),
  };
}
