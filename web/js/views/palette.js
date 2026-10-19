// @ts-check
/**
 * The colours of the terrain, from the page's style (light or dark): the
 * plain, the land from low to high, the lines, the frame lit. Shared by the
 * map and the 3D view, so that a height has the same colour in both.
 */

/** How far down the tint (and the map's lines) go below the highest peak. */
export const DEPTH = 1 / 256;

/**
 * @typedef {object} Palette
 * @property {number[][]} land rgb from the plain up to the highest peak
 * @property {string} line
 * @property {number[]} lit rgb of the frame hovered, and of those of its name
 * @property {string} text
 * @property {string} halo
 */

/** @returns {Palette} from the page's style, light or dark */
export function palette() {
  const style = getComputedStyle(document.documentElement);
  const v = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  return {
    land: ['--plain', '--land-1', '--land-2', '--land-3', '--land-4', '--land-5'].map(name => rgb(v(name))),
    line: v('--contour'),
    lit: rgb(v('--lit')),
    text: v('--fg'),
    halo: v('--bg'),
  };
}

/** @param {string} hex "#rrggbb" */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

/**
 * The colour of a height: the plain at 0, then up the palette by halvings,
 * as the contour lines go.
 *
 * @param {Palette} colors
 * @param {number} height
 * @param {number} top
 * @returns {number[]} rgb, 0 to 255
 */
export function tint(colors, height, top) {
  const land = colors.land;
  if (height <= 0)
    return land[0];
  // 0 at the top, 1 at the lowest line
  const lowest = Math.log2(1 / DEPTH);
  const depth = Math.min(1, Math.log2(top / height) / lowest);
  const at = 1 + (1 - depth) * (land.length - 2);
  const i = Math.min(land.length - 2, Math.floor(at)), f = at - i;
  const a = land[i], b = land[Math.min(land.length - 1, i + 1)];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}

/** How saturated the land is when coloured by package. */
const SATURATION = 0.5;

/**
 * A colour of the land given a hue: its lightness kept, so that heights
 * still read as they do in the palette.
 *
 * @param {number[]} color rgb, 0 to 255, as tint() gives it
 * @param {number} hue 0 to 1; NaN keeps the colour
 * @returns {number[]} rgb, 0 to 255
 */
export function hued(color, hue) {
  if (Number.isNaN(hue))
    return color;
  const l = (Math.max(...color) + Math.min(...color)) / 2 / 255;
  const c = (1 - Math.abs(2 * l - 1)) * SATURATION;
  /** @param {number} n */
  const f = n => {
    const k = (n + hue * 12) % 12;
    return Math.round(255 * (l - c / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** The most contour lines. */
export const LINES = 9;

/** The most height of a view of the terrain, as a share of the window's. */
export const HEIGHT = 0.7;
