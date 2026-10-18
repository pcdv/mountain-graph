// @ts-check
/**
 * The terrain: the mountains of the peaks raised as relief on one grid, a
 * height and a node per cell. Each mountain is a massif, a sunburst seen as
 * relief: the peak a disk at the centre, each depth of its callers tree a
 * ring further out, each caller a sector of its callee's whose angle is its
 * share of it and whose height is its ms. A caller never weighs more than
 * the frame it called, so the slopes only go down; a single path keeps its
 * height (a mesa), a fork steps down. Where a sector has no caller further
 * out (execution entered there), the plain begins.
 *
 * The mountains are placed largest first, each against the one it shares
 * the most callers with: a request handler or a thread pool at the foot of
 * several mountains gathers them in a range.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * A frame of a mountain, as the terrain shows it.
 *
 * @typedef {object} TerrainNode
 * @property {string} name
 * @property {number} total ms: its height
 * @property {number} depth 0 for the peak, 1 for its callers…
 * @property {number} parent the index of the frame it called, -1 for the peak
 * @property {number} mountain the index of its mountain
 * @property {number} a0 where its sector starts, in radians
 * @property {number} a1 where it ends
 */

/**
 * @typedef {object} Placed
 * @property {string} name of the peak
 * @property {number} x of its centre, in cells
 * @property {number} y
 * @property {number} r its radius, in cells: its foot
 * @property {number} node the index of its peak in nodes
 */

/**
 * @typedef {object} Terrain
 * @property {number} width in cells
 * @property {number} height
 * @property {Float64Array} heights ms of each cell, row after row; 0 on the plain
 * @property {Int32Array} cells the node of each cell, -1 on the plain
 * @property {TerrainNode[]} nodes
 * @property {Placed[]} mountains in the order given
 * @property {number} top the height of the highest peak, ms
 */

/** The gap between two mountains, as a share of the largest one's radius. */
const GAP = 0.12;

/**
 * @param {Frame[]} trees the mountains, each a peak and its callers as mountains() gives them, the
 *        heaviest first
 * @param {number} [size] the cells along the longer side of the grid
 * @returns {Terrain}
 */
export function massif(trees, size = 400) {
  /** @type {TerrainNode[]} */
  const nodes = [];
  /** @type {number[]} the index of each peak */
  const peaks = [];
  /** @type {number[][][]} per mountain, per depth, the indexes of its nodes by angle */
  const rings = trees.map((t, m) => {
    /** @type {number[][]} */
    const byDepth = [];
    /** @param {Frame} f @param {number} depth @param {number} parent @param {number} a0 @param {number} a1 */
    const add = (f, depth, parent, a0, a1) => {
      const index = nodes.length;
      const node = {name: f.name, total: f.total, depth, parent, mountain: m, a0, a1};
      nodes.push(node);
      (byDepth[depth] ??= []).push(index);
      let a = a0;
      for (const c of f.children) {
        const span = f.total > 0 ? (a1 - a0) * c.total / f.total : 0;
        add(c, depth + 1, index, a, a + span);
        a += span;
      }
    };
    peaks.push(nodes.length);
    add(t, 0, -1, 0, 2 * Math.PI);
    return byDepth;
  });

  const top = trees.reduce((max, t) => Math.max(max, t.total), 0);
  const circles = layout(trees, top);

  // the grid around them, with a margin
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r);
    y0 = Math.min(y0, c.y - c.r);
    x1 = Math.max(x1, c.x + c.r);
    y1 = Math.max(y1, c.y + c.r);
  }
  if (circles.length === 0)
    x0 = y0 = -1, x1 = y1 = 1;
  const margin = 0.1 * Math.max(x1 - x0, y1 - y0);
  x0 -= margin, y0 -= margin, x1 += margin, y1 += margin;
  const scale = size / Math.max(x1 - x0, y1 - y0);
  const width = Math.max(1, Math.round((x1 - x0) * scale)), height = Math.max(1, Math.round((y1 - y0) * scale));

  const heights = new Float64Array(width * height);
  const cells = new Int32Array(width * height).fill(-1);
  /** @type {Placed[]} */
  const mountains = [];
  circles.forEach((c, m) => {
    const cx = (c.x - x0) * scale, cy = (c.y - y0) * scale, r = c.r * scale;
    const byDepth = rings[m];
    const band = r / byDepth.length;
    mountains.push({name: trees[m].name, x: cx, y: cy, r, node: peaks[m]});
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(height, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(width, Math.ceil(cx + r)); x++) {
        // the centre of the cell
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const depth = Math.floor(Math.hypot(dx, dy) / band);
        if (depth >= byDepth.length)
          continue;
        let a = Math.atan2(dy, dx);
        if (a < 0)
          a += 2 * Math.PI;
        const i = sectorAt(nodes, byDepth[depth], a);
        if (i >= 0) {
          heights[y * width + x] = nodes[i].total;
          cells[y * width + x] = i;
        }
      }
  });
  return {width, height, heights, cells, nodes, mountains, top};
}

/**
 * @param {TerrainNode[]} nodes
 * @param {number[]} ring the indexes of the nodes of a depth, by angle
 * @param {number} a an angle, 0 to 2π
 * @returns {number} the index of the one whose sector holds it, -1 in the gaps (where execution
 *          entered, further in)
 */
function sectorAt(nodes, ring, a) {
  let lo = 0, hi = ring.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const n = nodes[ring[mid]];
    if (a < n.a0)
      hi = mid - 1;
    else if (a >= n.a1)
      lo = mid + 1;
    else
      return ring[mid];
  }
  return -1;
}

/**
 * Where the mountains stand: each a circle whose area is its peak's time,
 * placed against the one already placed it shares the most callers with,
 * where it is nearest to those it shares callers with, then to the centre.
 *
 * @param {Frame[]} trees
 * @param {number} top the time of the highest peak
 * @returns {{x: number, y: number, r: number}[]} in the order of the trees; the largest radius is 1
 */
export function layout(trees, top) {
  const radius = trees.map(t => top > 0 ? Math.sqrt(t.total / top) : 1);
  const callers = trees.map(callerTimes);
  const n = trees.length;
  const similar = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      similar[i * n + j] = similar[j * n + i] = similarity(callers[i], callers[j], trees[i].total, trees[j].total);
  /** @type {(i: number, j: number) => number} */
  const shared = (i, j) => similar[i * n + j];

  /** @type {{x: number, y: number, r: number}[]} */
  const placed = [];
  trees.forEach((_, j) => {
    const r = radius[j];
    if (j === 0) {
      placed.push({x: 0, y: 0, r});
      return;
    }
    let anchor = 0, best = -1;
    for (let i = 0; i < j; i++) {
      const s = shared(i, j);
      if (s > best)
        best = s, anchor = i;
    }
    const a = placed[anchor];
    /** @param {number} x @param {number} y */
    const free = (x, y) => placed.every(c => Math.hypot(c.x - x, c.y - y) >= c.r + r + GAP - 1e-9);
    /** @param {number} x @param {number} y */
    const cost = (x, y) => {
      let sum = 0.05 * Math.hypot(x, y);
      for (let i = 0; i < j; i++)
        sum += shared(i, j) * Math.hypot(placed[i].x - x, placed[i].y - y);
      return sum;
    };
    for (let d = a.r + r + GAP; ; d += GAP) {
      let bx = 0, by = 0, bc = Infinity;
      for (let k = 0; k < 72; k++) {
        const t = k * Math.PI / 36;
        const x = a.x + d * Math.cos(t), y = a.y + d * Math.sin(t);
        const c = cost(x, y);
        if (c < bc && free(x, y))
          bx = x, by = y, bc = c;
      }
      if (bc < Infinity) {
        placed.push({x: bx, y: by, r});
        return;
      }
    }
  });
  return placed;
}

/**
 * @param {Frame} t a mountain
 * @returns {Map<string, number>} ms by caller, each path counted once at its caller nearest the
 *          peak
 */
function callerTimes(t) {
  /** @type {Map<string, number>} */
  const times = new Map();
  /** @type {Set<string>} */
  const on = new Set();
  /** @param {Frame} f */
  const walk = f => {
    const enter = !on.has(f.name);
    if (enter) {
      times.set(f.name, (times.get(f.name) ?? 0) + f.total);
      on.add(f.name);
    }
    f.children.forEach(walk);
    if (enter)
      on.delete(f.name);
  };
  t.children.forEach(walk);
  return times;
}

/**
 * @param {Map<string, number>} a the callers of a mountain
 * @param {Map<string, number>} b of another
 * @param {number} ta the time of the first
 * @param {number} tb of the other
 * @returns {number} 0 to 1: the share of the smaller one's time that went through a caller both
 *          have, the one most went through
 */
export function similarity(a, b, ta, tb) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let best = 0;
  for (const [name, ms] of small) {
    const other = large.get(name);
    if (other !== undefined)
      best = Math.max(best, Math.min(ms, other));
  }
  const smaller = Math.min(ta, tb);
  return smaller > 0 ? Math.min(1, best / smaller) : 0;
}
