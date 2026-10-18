// @ts-check
/**
 * Contour lines of a grid of heights, by marching squares: each square of
 * four neighbouring cell centres is crossed by the line of a level where its
 * corners lie on either side of it, at the point found by interpolating
 * between them. Where two opposite corners are above (a saddle), the
 * square's mean tells whether they are joined.
 *
 * No DOM: tested with Node.
 */

/**
 * The segments of a level's line, four numbers each (x1, y1, x2, y2) in
 * cells: the centre of cell (i, j) is at (i + 0.5, j + 0.5).
 *
 * @param {ArrayLike<number>} heights row after row
 * @param {number} width
 * @param {number} height
 * @param {number} level
 * @returns {number[]}
 */
export function contour(heights, width, height, level) {
  /** @type {number[]} */
  const out = [];
  for (let y = 0; y + 1 < height; y++)
    for (let x = 0; x + 1 < width; x++) {
      const a = heights[y * width + x], b = heights[y * width + x + 1];
      const c = heights[(y + 1) * width + x + 1], d = heights[(y + 1) * width + x];
      // corners clockwise from the top left: a b / d c
      const index = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (index === 0 || index === 15)
        continue;
      const cx = x + 0.5, cy = y + 0.5;
      /** @param {number} from @param {number} to */
      const t = (from, to) => from === to ? 0.5 : (level - from) / (to - from);
      // the crossing on each side: top, right, bottom, left
      const top = () => [cx + t(a, b), cy];
      const right = () => [cx + 1, cy + t(b, c)];
      const bottom = () => [cx + t(d, c), cy + 1];
      const left = () => [cx, cy + t(a, d)];
      /** @param {number[]} p @param {number[]} q */
      const line = (p, q) => out.push(p[0], p[1], q[0], q[1]);
      switch (index) {
        case 1: case 14: line(left(), bottom()); break;
        case 2: case 13: line(bottom(), right()); break;
        case 3: case 12: line(left(), right()); break;
        case 4: case 11: line(top(), right()); break;
        case 6: case 9: line(top(), bottom()); break;
        case 7: case 8: line(left(), top()); break;
        case 5: case 10: {
          // a saddle: the mean of the corners tells which pairs are joined
          const above = (a + b + c + d) / 4 >= level;
          if ((index === 5) === above) {
            line(left(), top());
            line(bottom(), right());
          }
          else {
            line(top(), right());
            line(left(), bottom());
          }
        }
      }
    }
  return out;
}

/**
 * The levels to draw lines at, from the top down: each half the one above,
 * so that a small peak beside a high one still gets its lines.
 *
 * @param {number} top the highest height
 * @param {number} count the most lines
 * @param {number} [lowest] no line below it
 * @returns {number[]}
 */
export function levels(top, count, lowest = 0) {
  /** @type {number[]} */
  const out = [];
  for (let l = top * 0.9; out.length < count && l > lowest; l /= 2)
    out.push(l);
  return out;
}
