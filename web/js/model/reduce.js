// @ts-check
/**
 * A heap's profile with what the page hardly draws left out: a file small
 * enough to keep in a gallery or send with a report, good enough to browse.
 *
 * Each view reads a path from one end. The owned view starts at the root: its
 * peaks are chains of holders, its mountains what they hold. The shallow view
 * starts at the object: its peaks are the classes at the end of the paths (or
 * their last frames, with a context, or their packages), its mountains the
 * holders of these. So a path keeps its start as far as an owned peak could
 * depend on it, its end as far as a shallow one could, and what lies between
 * becomes one synthetic frame, FOLD. A ridge is drawn when it weighs at least
 * `least` of its view's heaviest peak: about 0.18 · √share of the radius wide,
 * under a pixel below 3e-4.
 *
 * The peaks stay, up to `peaks` of them in each view, and the ridges as wide
 * as `least`. What goes: the thinner ridges, the objects the panel lists when
 * one is unfolded, the class names of the objects no peak needs. Folds show as
 * ridges of their own where they gather enough. `compare` tells what changed.
 *
 * No DOM: tested with Node.
 */
import {SYNTHETIC} from '../profile/profile.js';
import {ownershipPeaks, mountainsOf, sums, THIN} from './ownership.js';
import {peaks as shallowPeaks, mountains, owner} from './peaks.js';
import {contextStacks} from './context.js';
import {FOLD, stacksOf, stacksToProfile} from '../profile/heap.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */
/** @typedef {import('./ownership.js').Sums} Sums */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The most frames a peak of the shallow view is made of: the page offers 1 to 5. */
const CONTEXTS = 5;

/**
 * How much may be lost.
 *
 * @typedef {object} Loss
 * @property {number} least 0 to 1: the lightest ridge kept, as a share of the heaviest peak of
 *           its view
 * @property {number} peaks the most peaks a view keeps: the page shows 10 unless asked for more
 * @property {number} context 1 to 5: the fewest frames kept at the end of a path. A peak made of
 *           more frames than are kept, with a fold in it, counts as no class at the top
 * @property {boolean} totals keep in a fold the classes and packages that may be peaks, so that
 *           the table's totals stay right: they count every path a class is on
 * @property {boolean} together fold together the children of a node that are too light to draw,
 *           into one "(…)" under it, and keep no frame past those drawn. Much smaller where a
 *           node holds thousands of small objects, but folds may gather enough to show as ridges
 * @property {boolean} strays fold the objects no peak needs into their holder's fold: those
 *           whose class, package and last frames cannot be a peak, out of what the owned view
 *           draws. Their class names go; their bytes count as with no class at the top
 */

/**
 * The levels of loss, by what the views keep with up to 10 peaks. Each draws
 * its peaks where the whole profile does, the same number of them.
 * 0: the ridges down to a pixel wide, and the table's totals.
 * 1: the same; a total may miss the paths where its class is in a fold.
 * 2: the ridges down to 3 pixels wide.
 * With everything kept (least 3e-4, 100 peaks, context 5, totals, nothing
 * together, no strays), every view draws as the whole for up to 100 peaks, but
 * a heap's profile hardly gets smaller: almost every object holds others, and
 * a fold breaks up the paths they share.
 *
 * @type {Loss[]}
 */
export const LEVELS = [
  {least: 3e-4, peaks: 10, context: 1, totals: true, together: true, strays: true},
  {least: 3e-4, peaks: 10, context: 1, totals: false, together: true, strays: true},
  {least: 3e-3, peaks: 10, context: 1, totals: false, together: true, strays: true},
];

/**
 * @param {HeapProfile} p a heap's profile: no time, no operation
 * @param {Loss} loss
 * @returns {HeapProfile} the same objects, their weights and counts summed, on fewer paths
 */
export function reduce(p, {least, peaks, context, totals, together, strays}) {
  const s = sums(p);
  /** @type {number[]} the nodes where samples end */
  const ends = [];
  for (let i = 0; i < p.parent.length; i++) {
    if (s.own[i] > 0 || (s.objects?.[i] ?? 0) > 0)
      ends.push(i);
  }
  const start = fromRoot(p, s, ends, least, peaks);
  const end = fromEnd(p, s, ends, least, peaks, context, together);
  const whole = new Set([...start.deepest, ...end.deepest]);

  // the new tree: nodes made as the paths come, one per parent and frame
  const strings = [...p.strings];
  let fold = strings.indexOf(FOLD);
  if (fold < 0)
    fold = strings.push(FOLD) - 1;
  /** @type {number[]} */
  const parent = [];
  /** @type {number[]} */
  const frame = [];
  /** @type {Map<string, number>} */
  const nodes = new Map();
  /** @param {number} under @param {number} f */
  const nodeOf = (under, f) => {
    const key = `${under}:${f}`;
    let node = nodes.get(key);
    if (node === undefined) {
      node = parent.push(under) - 1;
      frame.push(f);
      nodes.set(key, node);
    }
    return node;
  };
  /** @type {Map<number, {weight: number, objects: number}>} */
  const samples = new Map();
  for (const i of ends) {
    /** @type {number[]} */
    const path = [];
    for (let j = i; j >= 0; j = p.parent[j])
      path.push(j);
    path.reverse();
    let head = 0;
    while (head < path.length && start.kept[path[head]])
      head++;
    // unless the siblings are folded together, the first node dropped stays, the fold under it:
    // the fold of its children then weighs no more than it, too light to draw. Folded together,
    // the one a chain goes on into stays still, or the chain would stop above it, at another owner
    if (!together || (head < path.length && start.followed[path[head]]))
      head++;
    const stray = strays && head < path.length && !whole.has(i) && !end.needed(i);
    const tail = whole.has(i) ? path.length : stray ? 0 : end.tail(i);
    const between = path.slice(head, Math.max(head, path.length - tail));
    const counted = totals ? end.counted(path.slice(0, head).concat(path.slice(path.length - tail)), between) : [];
    let node = -1;
    // folded, the path may not get longer, or a mountain deeper. As long, it is worth it only when
    // the fold gathers it with its siblings
    const folded = head + counted.length + 1 + tail;
    if (stray || together ? folded > path.length : folded >= path.length) {
      for (const j of path)
        node = nodeOf(node, p.frame[j]);
    }
    else {
      for (const j of path.slice(0, head).concat(counted))
        node = nodeOf(node, p.frame[j]);
      node = nodeOf(node, fold << 3 | SYNTHETIC);
      for (const j of path.slice(path.length - tail))
        node = nodeOf(node, p.frame[j]);
    }
    const sample = samples.get(node) ?? {weight: 0, objects: 0};
    sample.weight += s.own[i];
    sample.objects += s.objects?.[i] ?? 0;
    samples.set(node, sample);
  }

  const size = samples.size;
  return {
    ...p,
    strings,
    parent: Int32Array.from(parent),
    frame: Int32Array.from(frame),
    time: new Float64Array(size),
    stack: Int32Array.from(samples.keys()),
    thread: new Int32Array(size),
    operation: new Int32Array(size).fill(-1),
    kind: new Uint8Array(size),
    weight: Float64Array.from(samples.values(), x => x.weight),
    objects: p.objects ? Float64Array.from(samples.values(), x => x.objects) : null,
  };
}

/**
 * The start of the paths the owned view needs.
 *
 * Its peaks are the heaviest chains of holders, found by walking the tree from
 * the root. Where a node is kept with all its children, the walk goes through
 * it as through the whole; the walk does not enter a fold. Below what is kept
 * it may find other chains, but none heavier than the node above the fold and
 * the objects of its holders, which a chain counts: kept when that could reach
 * the lightest peak. The child a chain goes on into is never folded with its
 * siblings, or the chain would end above it.
 * Its mountains draw what an anchor holds, kept down to the ridges too thin to
 * see, and deep as the deepest path under it, kept whole.
 *
 * @param {HeapProfile} p
 * @param {Sums} s
 * @param {number[]} ends the nodes where samples end
 * @param {number} least
 * @param {number} peaks
 * @returns {{kept: Uint8Array, followed: Uint8Array, deepest: number[]}} 1 for a node kept, its
 *          holders being; 1 for a node a chain goes on into from its parent; the ends of the
 *          paths to keep whole
 */
function fromRoot(p, s, ends, least, peaks) {
  const n = p.parent.length;
  // wrappers skipped or shown: each its own peaks
  const lists = [THIN, 0].map(thin => ownershipPeaks(p, {count: peaks, thin}).peaks);
  const owned = lists.flat();
  const top = Math.max(0, ...owned.map(peak => peak.total));
  // with fewer chains than peaks asked for, any could join them: nothing is folded
  const lightest = Math.min(...lists.map(list => list.length < peaks ? 0 : list[list.length - 1].total));
  const anchors = new Set(owned.map(peak => peak.node));

  const order = parentsFirst(s);
  // the most a chain reaching a node counts of its own above it: a chain goes on only into the
  // heaviest child, when it holds at least half of its parent; any other starts a chain afresh
  const heaviest = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const up = p.parent[i];
    if (up >= 0 && (heaviest[up] < 0 || s.total[i] > s.total[heaviest[up]]))
      heaviest[up] = i;
  }
  const above = new Float64Array(n);
  const followed = new Uint8Array(n), drawn = new Uint8Array(n), depth = new Int32Array(n);
  for (const i of order) {
    const up = p.parent[i];
    followed[i] = up >= 0 && heaviest[up] === i && s.total[i] >= 0.5 * s.total[up] ? 1 : 0;
    above[i] = followed[i] ? above[up] + s.own[up] : 0;
    drawn[i] = anchors.has(i) || (up >= 0 && drawn[up]) ? 1 : 0;
    depth[i] = up < 0 ? 0 : depth[up] + 1;
  }
  const kept = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    kept[i] = s.total[i] + above[i] >= lightest || (drawn[i] && s.total[i] >= least * top) ? 1 : 0;

  /** @type {Map<number, number>} */
  const deepest = new Map();
  for (const i of ends) {
    for (let j = i; j >= 0; j = p.parent[j]) {
      const d = deepest.get(j);
      if (anchors.has(j) && (d === undefined || depth[i] > depth[d]))
        deepest.set(j, i);
    }
  }
  return {kept, followed, deepest: [...deepest.values()]};
}

/**
 * @param {Sums} s
 * @returns {number[]} the nodes, each after its parent: depth first, with no recursion, a path
 *          of a heap being as long as a linked list
 */
function parentsFirst(s) {
  /** @type {number[]} */
  const order = [];
  const stack = [...s.roots];
  while (stack.length > 0) {
    const node = /** @type {number} */ (stack.pop());
    order.push(node);
    for (const c of s.children[node])
      stack.push(c);
  }
  return order;
}

/**
 * The end of the paths the shallow view needs.
 *
 * Its peaks are the ends of the paths: the last frame alone (by class, or by
 * package), or the last 2 to 5 gathered into one. Kept: the frames of the
 * longest end that may be a peak, the holders a mountain could draw, at least
 * `context` frames; unless folds may show, the next one too, under which the
 * fold weighs no more than it, too light to draw. The deepest path of each
 * mountain that may be shown is kept whole, as it sets how far apart the rings
 * are. A class's total counts the paths it is on, wherever: a class or package
 * that may be a peak can keep one frame in the fold of a path it is on.
 *
 * @param {HeapProfile} p
 * @param {Sums} s
 * @param {number[]} ends the nodes where samples end
 * @param {number} least
 * @param {number} peaks
 * @param {number} context the fewest frames kept at the end of a path
 * @param {boolean} together folds may show: no frame is kept past those drawn
 * @returns {{tail: (i: number) => number, deepest: number[], needed: (i: number) => boolean,
 *            counted: (kept: number[], between: number[]) => number[]}}
 *          the frames to keep at the end of a path; the ends of the paths to keep whole; whether
 *          an end may be a peak or in one; the frames of a fold to keep, given those kept around it
 */
function fromEnd(p, s, ends, least, peaks, context, together) {
  // the ends of the paths, as a tree from the object outward: an id for the object, another for
  // the object and its holder, and so on, with the bytes of each
  /** @type {Map<number, number>[]} */
  const next = [new Map()];
  /** @type {number[]} */
  const weight = [0], length = [0];
  /** @type {Map<number, number[]>} the ids along a path, its object first */
  const idsOf = new Map();
  for (const i of ends) {
    /** @type {number[]} */
    const ids = [];
    let id = 0;
    for (let j = i; j >= 0; j = p.parent[j]) {
      const name = p.frame[j] >>> 3;
      let child = next[id].get(name);
      if (child === undefined) {
        child = weight.push(0) - 1;
        length.push(length[id] + 1);
        next.push(new Map());
        next[id].set(name, child);
      }
      ids.push(id = child);
      weight[id] += s.own[i];
    }
    idsOf.set(i, ids);
  }

  /** @param {number[]} list @returns {number} the `peaks`-th heaviest, 0 when there are fewer */
  const nth = list => list.length < peaks ? 0 : list.sort((a, b) => b - a)[peaks - 1];
  /** @type {number[][]} the weights of the ends of each length */
  const byLength = Array.from({length: CONTEXTS}, () => []);
  for (let id = 1; id < weight.length; id++) {
    if (length[id] <= CONTEXTS)
      byLength[length[id] - 1].push(weight[id]);
  }
  const top = byLength.map(list => Math.max(0, ...list));
  const lightest = byLength.map(nth);

  /** @type {Map<number, string>} the package of each name */
  const packageNames = new Map();
  /** @param {number} j a node */
  const packageOf = j => {
    const name = p.frame[j] >>> 3;
    let pkg = packageNames.get(name);
    if (pkg === undefined)
      packageNames.set(name, pkg = owner(p.strings[name], 'package'));
    return pkg;
  };
  /** @type {Map<string, number>} */
  const packages = new Map();
  for (const i of ends)
    packages.set(packageOf(i), (packages.get(packageOf(i)) ?? 0) + s.own[i]);
  const topPackage = Math.max(0, ...packages.values());
  const lightestPackage = nth([...packages.values()]);

  /** @param {number[]} ids @param {number} j @returns {boolean} the end of j + 1 frames may be a peak */
  const peak = (ids, j) => j < CONTEXTS && j < ids.length && weight[ids[j]] > 0 && weight[ids[j]] >= lightest[j];

  /** @param {number} i */
  const tail = i => {
    const ids = /** @type {number[]} */ (idsOf.get(i));
    const pkg = /** @type {number} */ (packages.get(packageOf(i)));
    // the lightest ridge drawn k frames from the object: of the views whose peak is a shorter end
    // of this path, the one whose heaviest peak is the lightest
    let floor = pkg > 0 && pkg >= lightestPackage ? least * topPackage : Infinity;
    let shown = 1;
    for (let k = 1; k < ids.length; k++) {
      if (peak(ids, k - 1))
        floor = Math.min(floor, least * top[k - 1]);
      if (weight[ids[k]] >= floor)
        shown = k + 1;
    }
    let longest = 0;
    for (let j = 0; j < CONTEXTS; j++) {
      if (peak(ids, j))
        longest = j + 1;
    }
    const next = together ? 0 : 1;
    return Math.min(ids.length, Math.max(shown + next, longest + next, context));
  };

  /** @type {Map<string, number>} */
  const deepest = new Map();
  /** @param {string} key @param {number} i */
  const deeper = (key, i) => {
    const d = deepest.get(key);
    if (d === undefined || /** @type {number[]} */ (idsOf.get(i)).length > /** @type {number[]} */ (idsOf.get(d)).length)
      deepest.set(key, i);
  };
  /** @type {Set<number>} the names that may be a peak by class */
  const classes = new Set();
  for (const i of ends) {
    const ids = /** @type {number[]} */ (idsOf.get(i));
    for (let j = 0; j < CONTEXTS; j++) {
      if (peak(ids, j))
        deeper(`end ${ids[j]}`, i);
    }
    if (peak(ids, 0))
      classes.add(p.frame[i] >>> 3);
    const pkg = /** @type {number} */ (packages.get(packageOf(i)));
    if (pkg > 0 && pkg >= lightestPackage)
      deeper(`package ${packageOf(i)}`, i);
  }

  /** @param {number[]} kept @param {number[]} between */
  const counted = (kept, between) => {
    const names = new Set(kept.map(j => p.frame[j] >>> 3));
    const pkgs = new Set(kept.map(packageOf));
    return between.filter(j => {
      const name = p.frame[j] >>> 3, pkg = packageOf(j);
      const needed = (classes.has(name) && !names.has(name))
                     || (!pkgs.has(pkg) && (packages.get(pkg) ?? 0) > 0 && /** @type {number} */ (packages.get(pkg)) >= lightestPackage);
      if (needed) {
        names.add(name);
        pkgs.add(pkg);
      }
      return needed;
    });
  };
  /** @param {number} i */
  const needed = i => {
    const ids = /** @type {number[]} */ (idsOf.get(i));
    const pkg = /** @type {number} */ (packages.get(packageOf(i)));
    for (let j = 0; j < CONTEXTS; j++) {
      if (peak(ids, j))
        return true;
    }
    return pkg > 0 && pkg >= lightestPackage;
  };
  return {tail, deepest: [...deepest.values()], needed, counted};
}

/**
 * What a view draws, compared between a profile and its reduction.
 *
 * @typedef {object} Difference
 * @property {string} view
 * @property {number} moved peaks not at the same place in the list, or gone
 * @property {number} self the most a peak's own weight changed, as a share of it
 * @property {number} total the most a peak's total changed, as a share of it
 * @property {number} depths mountains of another depth: their rings are spaced otherwise
 * @property {number} ridges the ridges drawn
 * @property {number} missing of those, the ones gone
 * @property {number} added ridges drawn that were not there
 * @property {number} worst the most a ridge's weight changed, as a share of the heaviest peak
 */

/**
 * The views the page offers with the settings that change what they draw,
 * each compared: what was reduced with `loss` draws as `before` for a peak
 * count up to its `peaks`, and its ridges of at least its `least`.
 *
 * @param {HeapProfile} before
 * @param {HeapProfile} after
 * @param {Loss} loss that `after` was reduced with: its views are compared with as many peaks
 * @returns {Difference[]}
 */
export function compare(before, after, {least, peaks: count}) {
  const a = views(before, count), b = views(after, count);
  return [...a.keys()].map(view => {
    const x = /** @type {View} */ (a.get(view)), y = /** @type {View} */ (b.get(view));
    const heaviest = Math.max(0, ...x.list.map(peak => x.trees.get(peak.name)?.total ?? 0));
    const d = {view, moved: 0, self: 0, total: 0, depths: 0, ridges: 0, missing: 0, added: 0, worst: 0};
    const none = {nodes: new Map(), deepest: -1};
    x.list.forEach((peak, i) => {
      const j = y.list.findIndex(other => other.name === peak.name);
      if (j !== i)
        d.moved++;
      const other = y.list[j];
      d.self = Math.max(d.self, Math.abs(peak.self - (other?.self ?? 0)) / Math.max(1, peak.self));
      d.total = Math.max(d.total, Math.abs(peak.total - (other?.total ?? 0)) / Math.max(1, peak.total));
      const m0 = x.trees.get(peak.name), m1 = other && y.trees.get(other.name);
      if (!m0)
        return;
      const v0 = ridges(m0, least * heaviest), v1 = m1 ? ridges(m1, 0) : none;
      if (v0.deepest !== v1.deepest)
        d.depths++;
      for (const [path, w] of v0.nodes) {
        d.ridges++;
        if (!v1.nodes.has(path))
          d.missing++;
        d.worst = Math.max(d.worst, Math.abs(w - (v1.nodes.get(path) ?? 0)) / heaviest);
      }
      const all = ridges(m0, 0).nodes;
      for (const path of (m1 ? ridges(m1, least * heaviest) : none).nodes.keys()) {
        if (!all.has(path))
          d.added++;
      }
    });
    return d;
  });
}

/** @typedef {{list: {name: string, self: number, total: number}[], trees: Map<string, Frame>}} View */

/**
 * @param {HeapProfile} p
 * @param {number} count
 * @returns {Map<string, View>}
 */
function views(p, count) {
  /** @type {Map<string, View>} */
  const out = new Map();
  for (const [view, thin] of /** @type {[string, number][]} */ ([['owned', THIN], ['owned, wrappers shown', 0]])) {
    const list = ownershipPeaks(p, {count, thin}).peaks;
    out.set(view, {list, trees: mountainsOf(p, list)});
  }
  const stacks = stacksOf(p);
  for (let context = 1; context <= CONTEXTS; context++) {
    const g = stacksToProfile(contextStacks(stacks, context));
    for (const grain of /** @type {import('./peaks.js').Grain[]} */ (context > 1 ? ['method'] : ['method', 'package'])) {
      const list = shallowPeaks(g, {all: true}, {count, grain}).peaks;
      out.set(`shallow, ${context === 1 ? `by ${grain === 'method' ? 'class' : grain}` : `${context} frames`}`,
              {list, trees: mountains(g, {all: true}, list, grain)});
    }
  }
  return out;
}

/**
 * @param {Frame} tree
 * @param {number} least
 * @returns {{nodes: Map<string, number>, deepest: number}} each node of at least `least` by its
 *          path from the peak, with its weight; and how deep the mountain goes
 */
function ridges(tree, least) {
  /** @type {Map<string, number>} */
  const nodes = new Map();
  let deepest = 0;
  /** @param {Frame} f @param {string} path @param {number} d */
  const walk = (f, path, d) => {
    deepest = Math.max(deepest, d);
    const key = `${path};${f.name}`;
    if (f.total >= least)
      nodes.set(key, (nodes.get(key) ?? 0) + f.total);
    f.children.forEach(c => walk(c, key, d + 1));
  };
  walk(tree, '', 0);
  return {nodes, deepest};
}
