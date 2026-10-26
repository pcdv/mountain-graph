// @ts-check
/**
 * What owns the memory: the tree of a profile's stacks summed, and the
 * branches of it that hold most of the weight. A container and its contents
 * are one chain, not two consumers, so a chain is reported at the deepest
 * node that still holds most of what is above it.
 *
 * No DOM: tested with Node.
 */
import {weightOf, SYNTHETIC} from '../profile/profile.js';

/** @typedef {import('../profile/heap.js').HeapProfile} Profile */
/** @typedef {import('../profile/profile.js').Frame} BaseFrame */

/**
 * A frame of a tree of objects, which knows the node it came from: the panel
 * re-roots on a frame, and only the node says which object that is.
 *
 * @typedef {BaseFrame & {node?: number}} Frame
 */

/**
 * @typedef {object} Owned
 * @property {number} node of the frame
 * @property {string} name of the frame
 * @property {number} total bytes it holds, its contents included
 * @property {number} own bytes of the samples that end there
 * @property {string[]} path from the root to it
 */

/**
 * @typedef {object} Sums
 * @property {Float64Array} total the weight each node holds, its contents included
 * @property {Float64Array} own the weight of the samples that end at each node
 * @property {Float64Array | null} objects the objects that end at each node, null when the
 *           profile does not count them
 * @property {Float64Array | null} held the objects each node holds, itself and its contents
 * @property {Uint8Array} folded 1 for a synthetic node (a fold of a reduced profile, a truncated
 *           stack): no object, and what is under it is not walked
 * @property {number[][]} children
 * @property {number[]} roots
 */

/**
 * The sums of each profile, made once: the peaks, the mountains and every
 * click in the panel ask for them, and a profile does not change once made.
 *
 * @type {WeakMap<Profile, Sums>}
 */
const summed = new WeakMap();

/**
 * The weight each node holds, its contents included, and the weight of the
 * samples that end there. Kept with the profile: read them, never change them.
 *
 * @param {Profile} p
 * @returns {Sums}
 */
export function sums(p) {
  let s = summed.get(p);
  if (!s)
    summed.set(p, s = sum(p));
  return s;
}

/**
 * @param {Profile} p
 * @returns {Sums}
 */
function sum(p) {
  const n = p.parent.length;
  const total = new Float64Array(n), own = new Float64Array(n);
  const counted = p.objects ?? null;
  const objects = counted ? new Float64Array(n) : null, held = counted ? new Float64Array(n) : null;
  for (let i = 0; i < p.stack.length; i++) {
    const node = p.stack[i];
    if (node < 0)
      continue;
    const w = weightOf(p, i);
    own[node] += w;
    total[node] += w;
    if (counted && objects && held) {
      objects[node] += counted[i];
      held[node] += counted[i];
    }
  }
  /** @type {number[][]} */
  const children = Array.from({length: n}, () => []);
  /** @type {number[]} */
  const roots = [];
  const folded = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    folded[i] = (p.frame[i] & 7) === SYNTHETIC ? 1 : 0;
    if (p.parent[i] < 0)
      roots.push(i);
    else
      children[p.parent[i]].push(i);
  }
  // depth first, then the reverse: every child before its parent
  /** @type {number[]} */
  const order = [];
  /** @type {number[]} */
  const stack = [...roots];
  while (stack.length > 0) {
    const node = /** @type {number} */ (stack.pop());
    order.push(node);
    for (const c of children[node])
      stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    const parent = p.parent[node];
    if (parent >= 0) {
      total[parent] += total[node];
      if (held)
        held[parent] += held[node];
    }
  }
  return {total, own, objects, held, folded, children, roots};
}

/**
 * The node that owns the memory under one: follow the heaviest child while it
 * holds most of what is above it, and stop when the weight spreads over
 * several children. A fold is not followed: it holds no object.
 *
 * @param {number} node
 * @param {Pick<Sums, 'total' | 'children' | 'folded'>} s
 * @param {number} [share] 0 to 1, the part of its parent a child must hold to be followed
 * @returns {number}
 */
export function anchorOf(node, s, share = 0.5) {
  let cur = node;
  for (;;) {
    let heaviest = -1;
    for (const c of s.children[cur]) {
      if (!s.folded[c] && (heaviest < 0 || s.total[c] > s.total[heaviest]))
        heaviest = c;
    }
    if (heaviest < 0 || s.total[heaviest] < share * s.total[cur])
      return cur;
    cur = heaviest;
  }
}

/**
 * The chain from a node down its heaviest branch, as long as each child holds
 * most of its parent. A fold is not followed: it holds no object.
 *
 * @param {number} node
 * @param {Pick<Sums, 'total' | 'children' | 'folded'>} s
 * @param {number} [share]
 * @returns {number[]} the node first, the owner last
 */
export function chainOf(node, s, share = 0.5) {
  /** @type {number[]} */
  const chain = [node];
  let cur = node;
  for (;;) {
    let heaviest = -1;
    for (const c of s.children[cur]) {
      if (!s.folded[c] && (heaviest < 0 || s.total[c] > s.total[heaviest]))
        heaviest = c;
    }
    if (heaviest < 0 || s.total[heaviest] < share * s.total[cur])
      return chain;
    cur = heaviest;
    chain.push(cur);
  }
}

/**
 * How little an object may own of what it holds and still be called an owner.
 * A handler or a manager holds the server and owns a few hundred bytes: it is
 * where the walk entered the graph, not a consumer of memory.
 */
export const THIN = 0.01;

/**
 * The branches of the tree that hold the memory. Each chain is reported at the
 * object that owns it, and everything beside the chain is a chain of its own,
 * so the anchors add up to the weight of the whole tree.
 *
 * @param {Profile} p
 * @param {number} [least] the smallest anchor worth reporting, in weight
 * @param {{thin?: number}} [options] thin: below this share of its own weight an
 *        object that passes the weight on to several children is not an owner,
 *        and its children are taken instead; 0 keeps every object
 * @returns {Owned[]} the heaviest first
 */
export function ownership(p, least = 0, {thin = THIN} = {}) {
  const s = sums(p);
  /** @type {Map<number, {total: number, own: number, chain: number[]}>} */
  const anchors = new Map();
  /** @param {number} node */
  const walk = node => {
    // A fold stands for objects too small to tell apart, gathered: none of
    // them owns anything worth a peak, and the fold is no object. What it
    // weighs is its holder's, in the holder's total.
    if (s.folded[node])
      return;
    const chain = chainOf(node, s);
    const anchor = /** @type {number} */ (chain[chain.length - 1]);
    // What hangs beside the chain is held by something else: a chain of its
    // own. The anchor's own children are not, they are in its total already.
    for (let i = 0; i + 1 < chain.length; i++) {
      const next = chain[i + 1];
      for (const c of s.children[chain[i]]) {
        if (c !== next)
          walk(c);
      }
    }
    // A root is where the walk started, not an object holding anything: when
    // the weight spreads right there, its children are the owners
    if (p.parent[anchor] < 0) {
      for (const c of s.children[anchor])
        walk(c);
      return;
    }
    // The chain holds its own objects as well as what the anchor holds: a
    // cache and the maps inside it are one consumer, not the maps alone
    let total = s.total[anchor], own = 0;
    for (const node of chain)
      own += s.own[node];
    for (let i = 0; i + 1 < chain.length; i++)
      total += s.own[chain[i]];
    // A pass-through: it holds a lot and owns almost none of it, so what it
    // holds is not its own. Its children are the owners, as at a root.
    if (thin > 0 && own < thin * total && s.children[anchor].length > 1) {
      for (const c of s.children[anchor])
        walk(c);
      return;
    }
    if (total >= least)
      anchors.set(anchor, {total, own, chain});
  };
  for (const root of s.roots)
    walk(root);

  /** @param {number} node @returns {string[]} */
  const pathOf = node => {
    /** @type {string[]} */
    const frames = [];
    for (let i = node; i >= 0; i = p.parent[i])
      frames.push(p.strings[p.frame[i] >>> 3]);
    return frames.reverse();
  };

  return [...anchors]
    .map(([node, a]) => ({
      node,
      name: p.strings[p.frame[node] >>> 3],
      total: a.total,
      own: a.own,
      path: pathOf(node),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * @typedef {object} OwnedPeak
 * @property {number} node of the anchor
 * @property {string} name of the chain: the anchor and the object holding it
 * @property {number} self bytes of the chain's own objects
 * @property {number} total bytes it holds, its contents included
 * @property {number} share its total over that of the whole heap, 0 to 1
 * @property {string[]} holders what holds the chain, the nearest first, out to the root
 * @property {number} subtree bytes the anchor holds alone, without the chain's own objects
 */

/**
 * The ownership chains as peaks, in the shape the peaks table and the terrain
 * take: a chain's own objects are its self, what it holds its total. The
 * chains add up to the heap, so the coverage is the share it accounts for.
 *
 * @param {Profile} p
 * @param {{count?: number, coverage?: number, thin?: number}} [options] thin: see ownership
 * @returns {{peaks: OwnedPeak[], plain: number, bare: number, coverage: number, total: number}}
 */
export function ownershipPeaks(p, {count = 10, coverage = 1, thin = THIN} = {}) {
  const s = sums(p);
  const heap = s.roots.reduce((sum, r) => sum + s.total[r], 0);
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {OwnedPeak[]} */
  const peaks = [];
  let covered = 0;
  for (const o of ownership(p, 0, {thin})) {
    if (peaks.length >= count || (heap > 0 && covered / heap >= coverage))
      break;
    // the anchor and the object holding it: the same class may own several chains
    const holder = p.parent[o.node] >= 0 ? p.strings[p.frame[p.parent[o.node]] >>> 3] : '';
    const base = holder ? `${o.name} ← ${holder}` : o.name;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    peaks.push({
      node: o.node,
      name: n > 1 ? `${base} (${n})` : base,
      self: o.own,
      total: o.total,
      share: heap > 0 ? o.total / heap : 0,
      holders: o.path.slice(0, -1).reverse(),
      subtree: s.total[o.node],
    });
    covered += o.total;
  }
  return {peaks, plain: heap - covered, bare: 0, coverage: heap > 0 ? covered / heap : 0, total: heap};
}

/**
 * What each peak holds, as the tree the terrain draws: the anchor at the top,
 * the objects under it below. Its total is the chain's, its self the chain's
 * own objects.
 *
 * @param {Profile} p
 * @param {OwnedPeak[]} peaks
 * @returns {Map<string, Frame>} by the name of the peak
 */
export function mountainsOf(p, peaks) {
  const s = sums(p);
  /**
   * @param {number} node
   * @param {number} total what the chain holds at this point
   * @param {number} self
   * @returns {Frame}
   */
  const build = (node, total, self) => ({
    node,
    name: p.strings[p.frame[node] >>> 3],
    total,
    self,
    types: [0, 0],
    children: s.children[node].map(c => build(c, s.total[c], s.own[c])).sort((a, b) => a.name < b.name ? -1 : 1),
  });
  return new Map(peaks.map(peak => {
    // Named as the peak, not as the class of its anchor: two chains of the same
    // class are two peaks, and the panel looks a peak up by this name.
    const root = Object.assign(build(peak.node, peak.total, peak.self), {name: peak.name});
    // the chain above the peak, for the panel to say who holds it
    return [peak.name, Object.assign(root, {holders: peak.holders})];
  }));
}

/**
 * Who holds an object, as the tree the panel lists: the object at the top, the
 * object holding it under it, and so on out to the root. Each level's total is
 * what that object holds, so the chain widens outward.
 *
 * @param {Profile} p
 * @param {number} node
 * @param {number} [extra] bytes the chain of holders has of its own, above the node's subtree: what
 *        the holds tab counts and this one would otherwise miss, so the two agree at the top
 * @returns {Frame | undefined} undefined when the node is not in the profile
 */
export function holdersOf(p, node, extra = 0) {
  if (node < 0 || node >= p.parent.length)
    return undefined;
  const s = sums(p);
  /** @param {number} i @returns {Frame} */
  const build = i => ({
    node: i,
    name: p.strings[p.frame[i] >>> 3],
    total: s.total[i] + extra,
    self: s.own[i],
    types: [0, 0],
    children: p.parent[i] >= 0 ? [build(p.parent[i])] : [],
  });
  return build(node);
}

/**
 * The weight the outermost holder of a chain holds: what the shares in the
 * "held by" list are taken of. A chain of holders grows outward, so taking
 * them of the peak would put every holder above 100%.
 *
 * @param {Frame} chain the peak, then who holds it, out to the root
 * @returns {number}
 */
export function outermostOf(chain) {
  let total = chain.total;
  for (let f = chain; f.children[0]; f = f.children[0])
    total = Math.max(total, f.children[0].total);
  return total;
}

/**
 * What one object holds, as the panel lists it: the object at the top, the
 * objects under it. Its total is its subtree, its self the bytes of the samples
 * that end there.
 *
 * @param {Profile} p
 * @param {number} node
 * @param {number} [extra] bytes of the chain of holders above it, when it was
 *        reached as a peak: see holdersOf
 * @returns {Frame | undefined} undefined when the node is not in the profile
 */
export function holdsOf(p, node, extra = 0) {
  if (node < 0 || node >= p.parent.length)
    return undefined;
  const s = sums(p);
  /** @param {number} i @returns {Frame} */
  const build = i => ({
    node: i,
    name: p.strings[p.frame[i] >>> 3],
    total: s.total[i],
    self: s.own[i],
    types: [0, 0],
    children: s.children[i].map(c => build(c)).sort((a, b) => b.total - a.total),
  });
  const root = build(node);
  root.total += extra;
  return root;
}
