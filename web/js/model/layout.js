// @ts-check
/**
 * Where the mountains stand on the map: each a circle whose area is its
 * peak's time, those sharing callers near one another, all gathered in the
 * shape of the space they are shown in.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The gap between two mountains, as a share of the largest one's radius. */
const GAP = 0.12;

/** How much a mountain is drawn to the centre, against to the mountains it shares callers with. */
const CENTRE = 0.3;

/** The places tried around a mountain to set another against it. */
const ANGLES = 36;

/**
 * Where the mountains stand: each a circle whose area is its peak's time,
 * placed against one already placed, where it is nearest to those it shares
 * callers with, and to the centre of an ellipse of the shape asked. A
 * caller most mountains have (a thread's run, a pool's worker) says nothing
 * of them and is not counted.
 *
 * @param {Frame[]} trees
 * @param {number} top the time of the highest peak
 * @param {number} [aspect] the width over the height of the ellipse they are gathered in
 * @returns {{x: number, y: number, r: number}[]} in the order of the trees; the largest radius is 1
 */
export function layout(trees, top, aspect = 1) {
  const n = trees.length;
  const radius = trees.map(t => top > 0 ? Math.sqrt(t.total / top) : 1);
  const callers = trees.map(callerTimes);
  if (n >= 4) {
    /** @type {Map<string, number>} the mountains each caller is in */
    const count = new Map();
    for (const c of callers)
      for (const name of c.keys())
        count.set(name, (count.get(name) ?? 0) + 1);
    for (const c of callers)
      for (const name of [...c.keys()])
        if (/** @type {number} */ (count.get(name)) > n / 2)
          c.delete(name);
  }
  const similar = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      similar[i * n + j] = similar[j * n + i] = similarity(callers[i], callers[j], trees[i].total, trees[j].total);

  /** @type {{x: number, y: number, r: number}[]} */
  const placed = [];
  trees.forEach((_, j) => {
    const r = radius[j];
    if (j === 0) {
      placed.push({x: 0, y: 0, r});
      return;
    }
    /** @param {number} x @param {number} y */
    const free = (x, y) => placed.every(c => Math.hypot(c.x - x, c.y - y) >= c.r + r + GAP - 1e-9);
    // distances measured across the ellipse: as far from its centre, as near one another
    /** @param {number} x @param {number} y */
    const cost = (x, y) => {
      let sum = CENTRE * Math.hypot(x / aspect, y);
      for (let i = 0; i < j; i++)
        sum += similar[i * n + j] * Math.hypot((placed[i].x - x) / aspect, placed[i].y - y);
      return sum;
    };
    // against each one placed, further out if none has room
    for (let gap = GAP; ; gap += GAP) {
      let bx = 0, by = 0, bc = Infinity;
      for (const a of placed)
        for (let k = 0; k < ANGLES; k++) {
          const t = 2 * Math.PI * k / ANGLES, d = a.r + r + gap;
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
