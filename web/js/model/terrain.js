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
 * - ranges: ridges, a caller several mountains share drawn once, between
 *   them, where their ridges meet: a saddle, as high as the most time one
 *   of them spends through it. Its callers follow it. A caller most
 *   mountains share (a thread's run) is not merged: it would pull them all
 *   to one place, and says nothing of them.
 *
 * No DOM: tested with Node.
 */
import {layout, relations} from './layout.js';

/** @typedef {import('../profile/profile.js').Frame} Frame */

/** @typedef {'massif' | 'ridges' | 'ranges'} Shape */

/**
 * A frame of a mountain, as the terrain shows it.
 *
 * @typedef {object} TerrainNode
 * @property {string} name
 * @property {number} total ms
 * @property {number} depth 0 for the peak, 1 for its callers…
 * @property {number} parent the index of the frame it called, -1 for the peak
 * @property {number} mountain the index of its mountain
 * @property {number} a0 where its sector starts, in radians, before its mountain's turn
 * @property {number} a1 where it ends
 */

/**
 * @typedef {object} Placed
 * @property {string} name of the peak
 * @property {number} x of its centre, in cells
 * @property {number} y
 * @property {number} r its radius, in cells: its foot
 * @property {number} node the index of its peak in nodes
 * @property {number} turn radians its sectors are turned by: the middle of the whole turn, where a
 *           single path goes, points away from the middle of the mountains
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
 * @property {Saddle[]} saddles where mountains meet, ranges only
 * @property {Trail[]} trails between mountains related, however far apart
 */

/**
 * A path on the plain between two mountains much of whose time went
 * through a caller they share: they are related, however far apart.
 *
 * @typedef {object} Trail
 * @property {number} a the index of a mountain
 * @property {number} b of the other
 * @property {string} caller the one they share
 * @property {number} share of the smaller one's time that went through it, 0 to 1
 * @property {number[]} line from the foot of the one to that of the other, x1, y1, x2, y2 in cells
 */

/**
 * A caller several mountains share, drawn once where their ridges meet.
 *
 * @typedef {object} Saddle
 * @property {string} name of the caller
 * @property {number} x in cells
 * @property {number} y
 * @property {number} reach how wide its ridges are around it, in cells
 * @property {number[]} nodes the caller in each mountain, the heaviest first
 * @property {boolean} join whether paths join there; false further down the ridge they then share
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
 * How far apart two mountains may stand, as a share of the sum of their
 * radii, for a caller they share to be merged: further, its ridges would
 * cross the map.
 */
const NEAR = 1.5;

/** The least share of the smaller one's time through a caller two mountains share, for a trail. */
const TRAIL = 0.25;

/** The most trails from a mountain, the strongest first. */
const TRAILS = 3;

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
    saddles: [],
    trails: [],
  };
  const cx = circles.reduce((s, c) => s + c.x, 0) / (circles.length || 1);
  const cy = circles.reduce((s, c) => s + c.y, 0) / (circles.length || 1);
  circles.forEach((c, m) => {
    // the middle of the turn is at π: out of the middle, or left as it is for a mountain there
    const out = Math.hypot(c.x - cx, c.y - cy) > 1e-6 * c.r ? Math.atan2(c.y - cy, c.x - cx) - Math.PI : 0;
    const placed = {name: trees[m].name, x: (c.x - x0) * scale, y: (c.y - y0) * scale, r: c.r * scale, node: peaks[m],
                    turn: out};
    t.mountains.push(placed);
  });
  if (shape === 'ranges')
    ranges(t, rings);
  else
    t.mountains.forEach((m, k) => (shape === 'ridges' ? ridges : massif)(t, m, rings[k]));
  trails(t, trees);
  return t;
}

/**
 * The trails between related mountains, the strongest first, but those a
 * saddle already joins.
 *
 * @param {Terrain} t
 * @param {Frame[]} trees
 */
function trails(t, trees) {
  const n = trees.length;
  const {share, caller} = relations(trees);
  /** @type {Set<number>} the pairs a saddle joins */
  const joined = new Set();
  for (const s of t.saddles)
    for (const i of s.nodes)
      for (const j of s.nodes)
        joined.add(t.nodes[i].mountain * n + t.nodes[j].mountain);
  /** @type {number[]} */
  const pairs = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      if (share[a * n + b] >= TRAIL && !joined.has(a * n + b))
        pairs.push(a * n + b);
  pairs.sort((p, q) => share[q] - share[p]);
  const from = new Int32Array(n);
  for (const p of pairs) {
    const a = Math.floor(p / n), b = p % n;
    if (from[a] >= TRAILS || from[b] >= TRAILS)
      continue;
    from[a]++;
    from[b]++;
    const ma = t.mountains[a], mb = t.mountains[b];
    const d = Math.hypot(mb.x - ma.x, mb.y - ma.y) || 1, ux = (mb.x - ma.x) / d, uy = (mb.y - ma.y) / d;
    t.trails.push({a, b, caller: caller[p], share: share[p],
                   line: [ma.x + ux * ma.r, ma.y + uy * ma.r, mb.x - ux * mb.r, mb.y - uy * mb.r]});
  }
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
    const n = sectorAt(t.nodes, byDepth[depth], angle(dx, dy, -m.turn));
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
  dome(t, m);
  for (let depth = 1; depth < byDepth.length; depth++)
    for (const n of byDepth[depth])
      ridge(t, stance(t, m, byDepth.length, t.nodes[n].parent), stance(t, m, byDepth.length, n), n);
}

/**
 * Raises the mountains as ridges, the callers they share merged into
 * saddles: each placed where its ridges, weighed by their time, would end on
 * average; its callers moved as much, so that they follow it.
 *
 * @param {Terrain} t
 * @param {number[][][]} rings per mountain, per depth, its nodes by angle
 */
function ranges(t, rings) {
  /** @type {Stance[]} where each node would stand on its own mountain */
  const own = new Array(t.nodes.length);
  rings.forEach((byDepth, k) => byDepth.flat().forEach(n => own[n] = stance(t, t.mountains[k], byDepth.length, n)));

  // per caller, the heaviest node of its name in each mountain
  /** @type {Map<string, Map<number, number>>} */
  const shared = new Map();
  t.nodes.forEach((node, n) => {
    if (node.depth === 0)
      return;
    let per = shared.get(node.name);
    if (!per)
      shared.set(node.name, per = new Map());
    const was = per.get(node.mountain);
    if (was === undefined || t.nodes[was].total < node.total)
      per.set(node.mountain, n);
  });
  const most = t.mountains.length >= 4 ? t.mountains.length / 2 : Infinity;
  /** @param {number} a @param {number} b mountains @returns {boolean} whether they stand side by side */
  const near = (a, b) => {
    const ma = t.mountains[a], mb = t.mountains[b];
    return Math.hypot(ma.x - mb.x, ma.y - mb.y) <= NEAR * (ma.r + mb.r);
  };
  /** how far each node moves, x and y */
  const move = new Float64Array(2 * t.nodes.length);
  /** the saddle each node is merged into, -1 for none */
  const into = new Int32Array(t.nodes.length).fill(-1);
  for (const [name, per] of shared) {
    let left = [...per.values()].filter(n => t.nodes[n].total > 0)
                                .sort((a, b) => t.nodes[b].total - t.nodes[a].total);
    if (left.length > most)
      continue;
    // the heaviest with those of the mountains beside its own, then the rest likewise
    while (left.length >= 2) {
      const first = t.nodes[left[0]].mountain;
      const nodes = left.filter(n => near(first, t.nodes[n].mountain));
      left = left.filter(n => !nodes.includes(n));
      if (nodes.length < 2)
        continue;
      const weight = nodes.reduce((s, n) => s + t.nodes[n].total, 0);
      const x = nodes.reduce((s, n) => s + own[n].x * t.nodes[n].total, 0) / weight;
      const y = nodes.reduce((s, n) => s + own[n].y * t.nodes[n].total, 0) / weight;
      for (const n of nodes) {
        into[n] = t.saddles.length;
        move[2 * n] = x - own[n].x;
        move[2 * n + 1] = y - own[n].y;
      }
      t.saddles.push({name, x, y, reach: Math.max(...nodes.map(n => own[n].w)), nodes, join: true});
    }
  }
  // past where the paths join, a caller they still share is no saddle of its own: the same ridge
  for (const s of t.saddles) {
    const below = s.nodes.map(n => into[t.nodes[n].parent]);
    s.join = below[0] < 0 || below.some(b => b !== below[0]);
  }
  // the others moved as their nearest merged callee: a node comes after its callee
  t.nodes.forEach((node, n) => {
    if (into[n] < 0 && node.parent >= 0) {
      move[2 * n] = move[2 * node.parent];
      move[2 * n + 1] = move[2 * node.parent + 1];
    }
  });
  /** @param {number} n @returns {Stance} */
  const at = n => ({...own[n], x: own[n].x + move[2 * n], y: own[n].y + move[2 * n + 1]});

  t.mountains.forEach(m => dome(t, m));
  t.nodes.forEach((node, n) => {
    if (node.parent >= 0)
      ridge(t, at(node.parent), at(n), n);
  });
}

/**
 * Where a node of ridges stands.
 *
 * @typedef {object} Stance
 * @property {number} x in cells
 * @property {number} y
 * @property {number} h its height, ms
 * @property {number} w its half width, in cells
 */

/**
 * @param {Terrain} t
 * @param {Placed} m its mountain
 * @param {number} depths of its mountain
 * @param {number} n a node
 * @returns {Stance} out from the centre to the middle of its sector, on its depth's ring; lower as
 *          it is deeper, narrower as it is lighter
 */
function stance(t, m, depths, n) {
  const node = t.nodes[n], peak = t.nodes[m.node];
  const a = (node.a0 + node.a1) / 2 + m.turn, d = node.depth * m.r / depths;
  const share = peak.total > 0 ? node.total / peak.total : 0;
  return {x: m.x + d * Math.cos(a), y: m.y + d * Math.sin(a), h: node.total * (1 - node.depth / depths),
          w: RIDGE * m.r * Math.sqrt(share)};
}

/**
 * The peak of a mountain: a dome as wide as its widest ridge.
 *
 * @param {Terrain} t
 * @param {Placed} m
 */
function dome(t, m) {
  const peak = t.nodes[m.node], widest = RIDGE * m.r;
  eachCell(t, m.x, m.y, widest, widest, (i, dx, dy) => {
    const d = Math.hypot(dx, dy) / widest;
    if (d < 1)
      raise(t, i, peak.total * (1 - d * d), m.node);
  });
}

/**
 * A ridge from a callee out to its caller, its height and its width going
 * from the one's to the other's.
 *
 * @param {Terrain} t
 * @param {Stance} a the callee
 * @param {Stance} b the caller
 * @param {number} n the caller's node
 */
function ridge(t, a, b, n) {
  if (t.nodes[n].total <= 0)
    return;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const reach = Math.hypot(b.x - a.x, b.y - a.y) / 2 + Math.max(a.w, b.w);
  const lx = b.x - a.x, ly = b.y - a.y, length2 = lx * lx + ly * ly;
  eachCell(t, cx, cy, reach, reach, (i, dx, dy) => {
    // the nearest point of the segment, from the callee (0) to the caller (1)
    const px = dx + cx - a.x, py = dy + cy - a.y;
    const f = length2 > 0 ? Math.max(0, Math.min(1, (px * lx + py * ly) / length2)) : 0;
    const w = a.w + (b.w - a.w) * f;
    const d = Math.hypot(px - f * lx, py - f * ly) / w;
    if (d < 1)
      raise(t, i, (a.h + (b.h - a.h) * f) * (1 - d * d), n);
  });
}

/**
 * Raises a cell to a height, if higher: it belongs to the highest ridge over it.
 *
 * @param {Terrain} t
 * @param {number} i
 * @param {number} h
 * @param {number} n the node it belongs to then
 */
function raise(t, i, h, n) {
  if (h > t.heights[i]) {
    t.heights[i] = h;
    t.cells[i] = n;
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
 * @param {number} [turn] radians added to it
 * @returns {number} its angle, 0 to 2π
 */
function angle(dx, dy, turn = 0) {
  const a = (Math.atan2(dy, dx) + turn) % (2 * Math.PI);
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
