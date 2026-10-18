// @ts-check
/**
 * The terrain: the mountains of the peaks raised as relief on one grid, a
 * height and a node per cell. A mountain's callers tree is laid out as a
 * sunburst: the peak at the centre, each depth a ring further out, each
 * caller a sector of its callee's, whose angle is its share of it. Two
 * shapes are raised from it:
 *
 * - massif: each sector raised to its ms. A caller never weighs more than
 *   the frame it called, so the slopes only go down; a single path keeps
 *   its height (a mesa), a fork steps down. Where a sector has no caller
 *   further out (execution entered there), the plain begins.
 * - ridges: each caller a ridge from its callee out to the middle of its
 *   sector, as wide and as high as its ms, falling with depth too. One way
 *   in makes a single spur, many make a star of ridges.
 *
 * No DOM: tested with Node.
 */
import {layout} from './layout.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/** @typedef {'massif' | 'ridges'} Shape */

/**
 * A frame of a mountain, as the terrain shows it.
 *
 * @typedef {object} TerrainNode
 * @property {string} name
 * @property {number} total ms
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

/**
 * @typedef {object} TerrainOptions
 * @property {Shape} [shape] massif by default
 * @property {number} [size] the cells along the longer side of the grid
 * @property {number} [aspect] the width over the height of the space the terrain is shown in: the
 *           mountains are gathered in an ellipse of that shape
 */

/** The widest ridge, the peak's, as a share of its mountain's radius. */
const RIDGE = 0.18;

/**
 * @param {Frame[]} trees the mountains, each a peak and its callers as mountains() gives them, the
 *        heaviest first
 * @param {TerrainOptions} [options]
 * @returns {Terrain}
 */
export function terrain(trees, {shape = 'massif', size = 600, aspect = 1} = {}) {
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
      nodes.push({name: f.name, total: f.total, depth, parent, mountain: m, a0, a1});
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
  const circles = layout(trees, top, aspect);

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
  const margin = 0.03 * Math.max(x1 - x0, y1 - y0);
  x0 -= margin, y0 -= margin, x1 += margin, y1 += margin;
  const scale = size / Math.max(x1 - x0, y1 - y0);
  const width = Math.max(1, Math.round((x1 - x0) * scale)), height = Math.max(1, Math.round((y1 - y0) * scale));

  /** @type {Terrain} */
  const t = {
    width, height,
    heights: new Float64Array(width * height),
    cells: new Int32Array(width * height).fill(-1),
    nodes,
    mountains: [],
    top,
  };
  circles.forEach((c, m) => {
    const placed = {name: trees[m].name, x: (c.x - x0) * scale, y: (c.y - y0) * scale, r: c.r * scale, node: peaks[m]};
    t.mountains.push(placed);
    (shape === 'ridges' ? ridges : massif)(t, placed, rings[m]);
  });
  return t;
}

/**
 * Raises a mountain as a massif: each sector to its ms.
 *
 * @param {Terrain} t
 * @param {Placed} m
 * @param {number[][]} byDepth the indexes of its nodes, per depth, by angle
 */
function massif(t, m, byDepth) {
  const band = m.r / byDepth.length;
  eachCell(t, m.x, m.y, m.r, m.r, (i, dx, dy) => {
    const depth = Math.floor(Math.hypot(dx, dy) / band);
    if (depth >= byDepth.length)
      return;
    const n = sectorAt(t.nodes, byDepth[depth], angle(dx, dy));
    if (n >= 0) {
      t.heights[i] = t.nodes[n].total;
      t.cells[i] = n;
    }
  });
}

/**
 * Raises a mountain as ridges: the peak a dome at the centre, each caller a
 * ridge from its callee out to the middle of its sector one ring further,
 * its height and its width going from its callee's to its own. A cell
 * belongs to the highest ridge over it.
 *
 * @param {Terrain} t
 * @param {Placed} m
 * @param {number[][]} byDepth
 */
function ridges(t, m, byDepth) {
  const depths = byDepth.length;
  const band = m.r / depths;
  const peak = t.nodes[m.node];
  const widest = RIDGE * m.r;
  /** @param {number} n @returns {number[]} where it stands from the centre, its height, its half width */
  const at = n => {
    const node = t.nodes[n];
    const a = (node.a0 + node.a1) / 2, d = node.depth * band;
    const share = peak.total > 0 ? node.total / peak.total : 0;
    return [d * Math.cos(a), d * Math.sin(a), node.total * (1 - node.depth / depths), widest * Math.sqrt(share)];
  };
  /** @param {number} i @param {number} h @param {number} n */
  const raise = (i, h, n) => {
    if (h > t.heights[i]) {
      t.heights[i] = h;
      t.cells[i] = n;
    }
  };

  // the peak: a dome as wide as its ridges
  eachCell(t, m.x, m.y, widest, widest, (i, dx, dy) => {
    const d = Math.hypot(dx, dy) / widest;
    if (d < 1)
      raise(i, peak.total * (1 - d * d), m.node);
  });
  for (let depth = 1; depth < depths; depth++)
    for (const n of byDepth[depth]) {
      const node = t.nodes[n];
      if (node.total <= 0)
        continue;
      const [ax, ay, ah, aw] = at(node.parent), [bx, by, bh, bw] = at(n);
      const cx = (ax + bx) / 2, cy = (ay + by) / 2;
      const reach = Math.hypot(bx - ax, by - ay) / 2 + Math.max(aw, bw);
      const lx = bx - ax, ly = by - ay, length2 = lx * lx + ly * ly;
      eachCell(t, m.x + cx, m.y + cy, reach, reach, (i, dx, dy) => {
        // the nearest point of the segment, from the callee (0) to the caller (1)
        const px = dx + cx - ax, py = dy + cy - ay;
        const f = length2 > 0 ? Math.max(0, Math.min(1, (px * lx + py * ly) / length2)) : 0;
        const w = aw + (bw - aw) * f;
        const d = Math.hypot(px - f * lx, py - f * ly) / w;
        if (d < 1)
          raise(i, (ah + (bh - ah) * f) * (1 - d * d), n);
      });
    }
}

/**
 * @param {Terrain} t
 * @param {number} cx the centre of a box, in cells
 * @param {number} cy
 * @param {number} rx its half width
 * @param {number} ry its half height
 * @param {(i: number, dx: number, dy: number) => void} visit each cell of the grid in it, with the
 *        offset of its centre from the box's
 */
function eachCell(t, cx, cy, rx, ry, visit) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(t.height, Math.ceil(cy + ry)); y++)
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(t.width, Math.ceil(cx + rx)); x++)
      visit(y * t.width + x, x + 0.5 - cx, y + 0.5 - cy);
}

/**
 * @param {number} dx
 * @param {number} dy
 * @returns {number} its angle, 0 to 2π
 */
function angle(dx, dy) {
  const a = Math.atan2(dy, dx);
  return a < 0 ? a + 2 * Math.PI : a;
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
