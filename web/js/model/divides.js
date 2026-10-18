// @ts-check
/**
 * The divides of a terrain: the lines where the land of a mountain meets
 * that of another, so that each slope is seen to belong to one peak. A
 * divide breaks around a saddle joining the two: there the mountains are
 * one range.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('./terrain.js').Terrain} Terrain */

/** How far around a saddle its divides break, as a share of the width of its ridges. */
const BREAK = 1.5;

/**
 * @param {Terrain} t
 * @returns {number[]} the segments, four numbers each (x1, y1, x2, y2) in cells, on the edges
 *          between cells: cell (i, j) spans i to i + 1, j to j + 1
 */
export function divides(t) {
  const {width, height, cells, nodes} = t;
  /** @type {Map<number, {x: number, y: number, reach: number}[]>} per pair of mountains, the saddles joining them */
  const joined = new Map();
  for (const s of t.saddles) {
    const ms = [...new Set(s.nodes.map(n => nodes[n].mountain))];
    for (const a of ms)
      for (const b of ms)
        if (a < b) {
          const key = a * t.mountains.length + b;
          let saddles = joined.get(key);
          if (!saddles)
            joined.set(key, saddles = []);
          saddles.push({x: s.x, y: s.y, reach: s.reach * BREAK});
        }
  }
  /**
   * @param {number} i a cell
   * @param {number} j its neighbour
   * @param {number} x the middle of the edge between them
   * @param {number} y
   */
  const divided = (i, j, x, y) => {
    const a = cells[i], b = cells[j];
    if (a < 0 || b < 0)
      return false;
    const ma = nodes[a].mountain, mb = nodes[b].mountain;
    if (ma === mb)
      return false;
    const saddles = joined.get(Math.min(ma, mb) * t.mountains.length + Math.max(ma, mb)) ?? [];
    return !saddles.some(s => Math.hypot(s.x - x, s.y - y) < s.reach);
  };

  /** @type {number[]} */
  const out = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width && divided(i, i + 1, x + 1, y + 0.5))
        out.push(x + 1, y, x + 1, y + 1);
      if (y + 1 < height && divided(i, i + width, x + 0.5, y + 1))
        out.push(x, y + 1, x + 1, y + 1);
    }
  return out;
}
