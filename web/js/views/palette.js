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
