// @ts-check
/**
 * The zones of a terrain: the lines where the land of one frame of a mountain meets that of another
 * in the same mountain, so that what can be hovered is seen before it is: a sector of the dome, a
 * ridge. The lines between mountains are the divides (divides.js). A frame holding next to
 * nothing of its peak has no line, or the slopes would be all lines.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('./terrain.js').Terrain} Terrain */

/** The least share of its peak a frame holds to have a line around it. */
const LEAST = 0.005;

/**
 * @param {Terrain} t
 * @returns {(i: number, j: number) => boolean} whether a line runs between two neighbouring cells
 */
function edge(t) {
  const {cells, nodes} = t;
  const least = t.mountains.map(m => LEAST * nodes[m.node].total);
  return (i, j) => {
    const a = cells[i], b = cells[j];
    if (a < 0 || b < 0 || a === b || nodes[a].mountain !== nodes[b].mountain)
      return false;
    const floor = least[nodes[a].mountain];
    return nodes[a].total >= floor || nodes[b].total >= floor;
  };
}

/**
 * @param {Terrain} t
 * @returns {number[]} the segments, four numbers each (x1, y1, x2, y2) in cells, on the edges
 *          between cells: cell (i, j) spans i to i + 1, j to j + 1
 */
export function zones(t) {
  const {width, height} = t;
  const between = edge(t);
  /** @type {number[]} */
  const out = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x + 1 < width && between(i, i + 1))
        out.push(x + 1, y, x + 1, y + 1);
      if (y + 1 < height && between(i, i + width))
        out.push(x, y + 1, x + 1, y + 1);
    }
  return out;
}

/**
 * @param {Terrain} t
 * @returns {Uint8Array} per cell, 1 for the cells along a line, on its left or upper side
 */
export function zoneCells(t) {
  const {width, height} = t;
  const between = edge(t);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((x + 1 < width && between(i, i + 1)) || (y + 1 < height && between(i, i + width)))
        out[i] = 1;
    }
  return out;
}
