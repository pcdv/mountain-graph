// @ts-check
/**
 * The 3D land as an archipelago: the plain under the sea, its bed going down
 * away from the coasts, the land sloping to beaches, then grass, forest, rock
 * and snow up the mountains, bumped and rocky where steep. The heights and
 * colours of each cell, the water, and a sky at sunset: terrain3d.js raises
 * and lights them.
 *
 * Needs three.js only for the water and the sky, given by the caller.
 */

/** The sea's surface, over the plain, and its deepest bed under it: shares of the longer side. */
export const LEVEL = 0.002, DEEP = 0.05;

/** How far from land the bed goes down most of the way, as a share of the longer side. */
const SHELF = 0.035;

/** Over how far from the land's edges the bed goes down to the deepest, as a share of the longer side. */
const EDGE = 0.06;

/** Over how many cells from the sea the land rises to its full height: its beaches. */
const RAMP = 4;

/** The land's colours up the mountains, sRGB: [share of the highest peak's height, rgb]. */
const LAND = /** @type {[number, number[]][]} */ ([
  [0, [222, 205, 150]],
  [0.05, [132, 168, 86]],
  [0.3, [74, 118, 58]],
  [0.55, [116, 102, 80]],
  [0.75, [138, 133, 126]],
  [0.86, [244, 245, 248]],
]);

/**
 * What can be tuned of the islands.
 *
 * @typedef {object} SeaTuning
 * @property {number} bump how high the bumps of the land, as a share of the longer side
 * @property {number} rock the slope rock starts at, rising so many cells per cell; all rock at twice
 */

/** @type {SeaTuning} */
export const SEA_TUNING = {bump: 0.008, rock: 3};

/** The colour of rock, where the land is steep, sRGB. */
const ROCK = [112, 104, 94];

/** The sky at sunset, sRGB: [height over the horizon, 0 to 1, rgb]; under it the sea far away. */
const SKY = /** @type {[number, number[]][]} */ ([
  [-1, [24, 46, 72]],
  [-0.02, [70, 82, 104]],
  [0, [255, 176, 110]],
  [0.06, [246, 130, 92]],
  [0.18, [186, 92, 116]],
  [0.4, [84, 64, 120]],
  [1, [30, 32, 70]],
]);

/** The haze toward the horizon, and the warm low sun, as three.js colours. */
export const HAZE = 0xe8a07c, SUN = 0xffc89a;

/** The bed's colours, from the shore to the deepest, sRGB. */
const BED = /** @type {[number, number[]][]} */ ([
  [0, [214, 198, 146]],
  [0.06, [70, 130, 140]],
  [0.3, [40, 84, 112]],
  [1, [26, 54, 84]],
]);

/**
 * @typedef {object} Shores
 * @property {Float32Array} depth of the bed under each cell of sea, 0 to 1; 0 on land
 * @property {Float32Array} inland of each cell of land, how far from the sea, cells; 0 in the sea
 */

/**
 * @param {ArrayLike<number>} heights row after row: over 0 on land, the rest under the sea
 * @param {number} width
 * @param {number} height
 * @returns {Shores}
 */
export function shores(heights, width, height) {
  const side = Math.max(width, height);
  const toLand = distance(i => heights[i] > 0, width, height);
  const inland = distance(i => heights[i] <= 0, width, height);
  const depth = toLand.map((d, i) => {
    if (d === 0)
      return 0;
    const x = i % width, y = Math.floor(i / width);
    // down to the deepest toward the edges, where the bed beyond the land is
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y) / (EDGE * side);
    return Math.max((1 - Math.exp(-d / (SHELF * side))) * (0.85 + 0.15 * noise(x, y, 9)), 1 - edge);
  });
  return {depth, inland};
}

/**
 * @param {number} inland cells from the sea
 * @returns {number} the share of its height the land has there, 0 to 1: lower toward the beach
 */
export function ramp(inland) {
  const r = Math.min(1, inland / RAMP);
  return r * r * (3 - 2 * r);
}

/**
 * @param {number} x of a cell
 * @param {number} y
 * @returns {number} the bump there, -0.5 to 0.5: a few scales of noise
 */
export function bump(x, y) {
  return 0.5 * noise(x, y, 3) + 0.32 * noise(x + 101, y + 57, 7) + 0.18 * noise(x + 13, y + 211, 19) - 0.5;
}

/**
 * @param {number} up the share of the highest peak's height, 0 to 1
 * @param {number} inland cells from the sea: sand along it
 * @param {number} steep how steep, 0 to 1: rock
 * @param {number} x of the cell, for its grain
 * @param {number} y
 * @returns {number[]} sRGB
 */
export function landColour(up, inland, steep, x, y) {
  const c = inland <= 1.5 ? LAND[0][1] : along(LAND, up);
  // rock where steep, but under the snow
  const r = up < 0.8 ? steep : steep * Math.max(0, (0.9 - up) / 0.1);
  const grain = 0.86 + 0.28 * noise(x, y, 2);
  return c.map((v, i) => Math.min(255, Math.round((v + r * (ROCK[i] - v)) * grain)));
}

/**
 * A dome of sky at sunset around the land, its lower half the sea far away.
 *
 * @param {any} T three.js
 * @param {number} radius
 * @returns {{mesh: any, dispose: () => void}}
 */
export function sky(T, radius) {
  const geometry = new T.SphereGeometry(radius, 48, 32);
  const p = geometry.attributes.position;
  const colours = new Float32Array(p.count * 3);
  /** @param {number} c */
  const linear = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  for (let i = 0; i < p.count; i++) {
    // the sun low in the west: warmer that way
    const up = p.getY(i) / radius, west = Math.max(0, -p.getX(i) / radius);
    const c = along(SKY, up - 0.05 * west * (up > 0 ? 1 : 0));
    colours.set(c.map(linear), 3 * i);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  const material = new T.MeshBasicMaterial({vertexColors: true, side: T.BackSide, fog: false, depthWrite: false});
  const mesh = new T.Mesh(geometry, material);
  return {mesh, dispose: () => (geometry.dispose(), material.dispose())};
}

/**
 * @param {number} depth 0 to 1
 * @returns {number[]} sRGB
 */
export function bedColour(depth) {
  return along(BED, depth);
}

/**
 * The water, wider than the land, and a deep bed under it out of the land's
 * reach.
 *
 * @param {any} T three.js
 * @param {number} side of the land, its longer one
 * @param {number} [level] of the water, as a share of the longer side
 * @returns {{mesh: any, level: (level: number) => void, dispose: () => void}} level() sets the water's
 *          again, as a share of the longer side
 */
export function sea(T, side, level = LEVEL) {
  const wide = side * 8;
  const water = new T.Mesh(new T.PlaneGeometry(wide, wide),
                           new T.MeshPhongMaterial({color: 0x2f7fb0, transparent: true, opacity: 0.62,
                                                    shininess: 90, specular: 0x9fc8e8, depthWrite: false}));
  water.rotation.x = -Math.PI / 2;
  water.position.y = level * side;
  water.renderOrder = 1;
  const bed = new T.Mesh(new T.PlaneGeometry(wide, wide), new T.MeshLambertMaterial({color: 0x1a3654}));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -DEEP * side;
  const mesh = new T.Group();
  mesh.add(bed, water);
  return {
    mesh,
    level: share => water.position.y = share * side,
    dispose: () => [water, bed].forEach(m => {
      m.geometry.dispose();
      m.material.dispose();
    }),
  };
}

/**
 * @param {[number, number[]][]} stops by their first value, rising
 * @param {number} at
 * @returns {number[]} the colour there, between the stops around it
 */
function along(stops, at) {
  for (let k = 1; k < stops.length; k++)
    if (at <= stops[k][0]) {
      const [a, from] = stops[k - 1], [b, to] = stops[k];
      const f = Math.max(0, (at - a) / (b - a));
      return from.map((c, i) => Math.round(c + f * (to[i] - c)));
    }
  return stops[stops.length - 1][1];
}

/**
 * @param {(i: number) => boolean} inside
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array} from each cell to the nearest inside, cells (chamfer, about Euclidean)
 */
export function distance(inside, width, height) {
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++)
    d[i] = inside(i) ? 0 : 1e9;
  const D = Math.SQRT2;
  /** @param {number} x @param {number} y @param {number} dx @param {number} dy @param {number} w */
  const from = (x, y, dx, dy, w) => {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height)
      d[y * width + x] = Math.min(d[y * width + x], d[ny * width + nx] + w);
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      from(x, y, -1, 0, 1), from(x, y, 0, -1, 1), from(x, y, -1, -1, D), from(x, y, 1, -1, D);
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      from(x, y, 1, 0, 1), from(x, y, 0, 1, 1), from(x, y, 1, 1, D), from(x, y, -1, 1, D);
    }
  return d;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} S its scale, cells
 * @returns {number} smooth value noise, 0 to 1, over S cells
 */
function noise(x, y, S) {
  const fx = x / S, fy = y / S, x0 = Math.floor(fx), y0 = Math.floor(fy);
  const u = fx - x0, v = fy - y0;
  /** @param {number} i @param {number} j */
  const at = (i, j) => {
    let n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
  };
  const s = u * u * (3 - 2 * u), t = v * v * (3 - 2 * v);
  return (at(x0, y0) * (1 - s) + at(x0 + 1, y0) * s) * (1 - t) + (at(x0, y0 + 1) * (1 - s) + at(x0 + 1, y0 + 1) * s) * t;
}
