// @ts-check
/**
 * The terrain in blocks, for fun: columns of cubes as high as the land,
 * grass on top and dirt under it, stone higher up, snow on the highest
 * peaks; or the hue of each frame's package, as coloured wool. On the
 * plain, the trails are paths of gravel, and a few trees grow away from the
 * mountains. Only the blocks that can be seen are drawn.
 *
 * Built by the 3D view (terrain3d.js) with three.js, which it loaded.
 */
import {tint, hued} from './palette.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('./palette.js').Palette} Palette */

/** The columns along the longer side of the terrain: at first, and their range. */
export const COLUMNS = 200, FEWEST = 60, MOST = 360;

/** The share of the columns of the plain, away from the mountains, where a tree grows. */
const TREES = 0.012;

/** The colours of the blocks, rgb. */
const GRASS = [96, 160, 56], DIRT = [134, 96, 67], STONE = [128, 128, 128], SNOW = [240, 244, 250];
const PATH = [176, 160, 128], WOOD = [102, 81, 51], LEAVES = [58, 118, 40];

/**
 * @typedef {object} Blocks
 * @property {any} mesh to add to the scene
 * @property {(lit: (n: number) => number) => void} light colours the blocks of the nodes lit: lit(n)
 *           tells how much, 0 to 1
 * @property {() => void} dispose
 */

/**
 * @param {any} T three.js
 * @param {Terrain} t
 * @param {object} options
 * @param {(height: number) => number} options.lift the y of a height, ms
 * @param {Float64Array | null} options.hues per node, the hue of its package; none for the land's
 *        own colours
 * @param {Palette} options.colors
 * @param {(rgb: number[]) => number[]} options.linear an sRGB colour, 0 to 255, in linear 0 to 1
 * @param {number} [options.columns] along the longer side: the more, the smaller the blocks, and
 *        the trees beside the mountains
 * @returns {Blocks}
 */
export function blocks(T, t, {lift, hues, colors, linear, columns = COLUMNS}) {
  const W = t.width, H = t.height;
  // cells are whole: as near the columns asked as they allow
  const size = Math.max(1, Math.round(Math.max(W, H) / columns));
  const cols = Math.ceil(W / size), rows = Math.ceil(H / size);

  // each column: its highest cell, as many blocks as it is high
  const high = new Int32Array(cols * rows).fill(-1);
  const count = new Int32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let best = -1;
      for (let y = r * size; y < Math.min(H, (r + 1) * size); y++)
        for (let x = c * size; x < Math.min(W, (c + 1) * size); x++) {
          const i = y * W + x;
          if (t.heights[i] > 0 && (best < 0 || t.heights[i] > t.heights[best]))
            best = i;
        }
      high[r * cols + c] = best;
      count[r * cols + c] = best < 0 ? 0 : Math.max(1, Math.round(lift(t.heights[best]) / size));
    }
  const most = Math.max(1, ...count);

  // the paths, where the trails cross the plain
  const path = new Uint8Array(cols * rows);
  for (const {line: [x1, y1, x2, y2]} of t.trails) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / size * 2);
    for (let s = 0; s <= steps; s++) {
      const c = Math.floor((x1 + (x2 - x1) * s / steps) / size), r = Math.floor((y1 + (y2 - y1) * s / steps) / size);
      if (c >= 0 && r >= 0 && c < cols && r < rows)
        path[r * cols + c] = 1;
    }
  }

  /** @type {number[]} x, y, z of each block's centre, in blocks */
  const at = [];
  /** @type {number[][]} */
  const tints = [];
  /** @type {number[]} the node each block shows, -1 for none */
  const node = [];
  /** @param {number} c @param {number} level @param {number} r @param {number[]} rgb @param {number} n */
  const add = (c, level, r, rgb, n) => {
    at.push(c, level, r);
    tints.push(rgb);
    node.push(n);
  };
  /** @param {number} c @param {number} r @returns {number} blocks high; outside, below the ground */
  const blocksAt = (c, r) => c < 0 || r < 0 || c >= cols || r >= rows ? -1 : count[r * cols + c];

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const k = count[r * cols + c], i = high[r * cols + c];
      const n = i < 0 ? -1 : t.cells[i];
      // under the lowest of its neighbours, nothing shows
      const from = Math.max(-1, Math.min(k, blocksAt(c - 1, r), blocksAt(c + 1, r), blocksAt(c, r - 1), blocksAt(c, r + 1)) - 1);
      for (let level = from; level < k; level++) {
        const below = k - 1 - level;
        /** @type {number[]} */
        let rgb;
        if (level < 0)
          rgb = k > 0 ? DIRT : path[r * cols + c] ? PATH : GRASS;
        else if (hues && n >= 0 && !Number.isNaN(hues[n]))
          rgb = hued(tint(colors, t.top * ((level + 1) / most) ** 2, t.top), hues[n]);
        else {
          const f = k / most;
          const top = f > 0.8 ? SNOW : f > 0.5 ? STONE : GRASS;
          rgb = below === 0 ? top : top === GRASS && below <= 3 ? DIRT : STONE;
        }
        add(c, level, r, rgb, level < 0 ? -1 : n);
      }
      // a tree, now and then, away from the mountains and the paths
      if (k === 0 && !path[r * cols + c] && random(c, r) < TREES && clear(c, r))
        tree(c, r);
    }

  /** @param {number} c @param {number} r @returns {boolean} no mountain within two columns */
  function clear(c, r) {
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++)
        if (blocksAt(c + dc, r + dr) > 0)
          return false;
    return true;
  }
  /** @param {number} c @param {number} r */
  function tree(c, r) {
    for (let level = 0; level < 3; level++)
      add(c, level, r, WOOD, -1);
    for (let level = 2; level < 4; level++)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc || level === 3)
            add(c + dc, level, r + dr, LEAVES, -1);
    add(c, 4, r, LEAVES, -1);
  }

  const geometry = new T.BoxGeometry(size, size, size);
  const material = new T.MeshLambertMaterial({map: texture(T)});
  const total = node.length;
  const mesh = new T.InstancedMesh(geometry, material, total);
  const matrix = new T.Matrix4();
  for (let b = 0; b < total; b++) {
    // a column's cells span c * size to (c + 1) * size; cell i's centre is at x = i - (W - 1) / 2
    matrix.makeTranslation(at[3 * b] * size + (size - 1) / 2 - (W - 1) / 2, (at[3 * b + 1] + 0.5) * size,
                           at[3 * b + 2] * size + (size - 1) / 2 - (H - 1) / 2);
    mesh.setMatrixAt(b, matrix);
  }
  const base = tints.map(linear);
  const lit = linear(colors.lit);
  const color = new T.Color();
  /** @param {(n: number) => number} amount */
  const light = amount => {
    for (let b = 0; b < total; b++) {
      const a = node[b] < 0 ? 0 : amount(node[b]), c = base[b];
      color.setRGB(c[0] * (1 - a) + lit[0] * a, c[1] * (1 - a) + lit[1] * a, c[2] * (1 - a) + lit[2] * a);
      mesh.setColorAt(b, color);
    }
    mesh.instanceColor.needsUpdate = true;
  };
  light(() => 0);

  return {
    mesh,
    light,
    dispose: () => {
      geometry.dispose();
      material.map.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

/**
 * @param {any} T three.js
 * @returns {any} a texture of 16 by 16 pixels, grey noise with darker edges, shown as pixels: the
 *          colour of each block multiplies it
 */
function texture(T) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const image = g.createImageData(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const v = Math.round(255 * (edge ? 0.72 : 0.86 + 0.14 * random(x, y + 99)));
      image.data.set([v, v, v, 255], 4 * (y * 16 + x));
    }
  g.putImageData(image, 0, 0);
  const tex = new T.CanvasTexture(canvas);
  tex.magFilter = T.NearestFilter;
  tex.minFilter = T.NearestFilter;
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {number} 0 to 1, always the same for the same place
 */
function random(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
