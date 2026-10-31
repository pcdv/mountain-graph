// @ts-check
/**
 * What the flame graph's views share, the page's (flame.js) and the panel in
 * the 3D world (flame3d.js): the painting of its boxes on a canvas, and what
 * the tooltip of one says. The neutral module for them, as palette.js is for
 * the terrain's colours.
 */
import {h} from '../lib/dom.js';
import {amount} from '../model/units.js';
import {range} from '../model/flame.js';

/** @typedef {import('../model/flame.js').Box} Box */
/** @typedef {import('../model/flame.js').Flame} Flame */

/** Height of a level, px. */
export const ROW = 18;
const FONT = '12px ui-monospace, "Cascadia Mono", Consolas, monospace';

/**
 * @typedef {object} Look
 * @property {Box | null} zoomed the box filling the width, null for the root
 * @property {Box | null} hovered
 * @property {RegExp | null} pattern the frames to colour as found
 * @property {boolean} dark whether the page is dark: the colours of the frames follow
 */

/**
 * @param {string} name
 * @returns {number} 0 to 1, the same for a name wherever it appears: a method keeps its colour
 */
function spread(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return (hash >>> 0) % 1000 / 1000;
}

/**
 * Draws the boxes in the width given, the root at the bottom (at `bottom`) and its callees above
 * it, as flame graphs are.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Flame} flame
 * @param {Look} look
 * @param {number} width px
 * @param {number} [bottom] px, where the root's row ends: the height of the whole graph by default
 */
export function paintFlame(ctx, flame, {zoomed, hovered, pattern, dark}, width, bottom = flame.levels.length * ROW) {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const charWidth = ctx.measureText('m').width;
  const {from, span} = range(flame, zoomed);
  const scale = width / span;
  const zoomLevel = zoomed ? zoomed.level : 0;
  /** @param {number} level @returns {number} the top of its row */
  const top = level => bottom - (level + 1) * ROW;
  for (const boxes of flame.levels)
    for (const b of boxes) {
      const x = (b.left - from) * scale, w = b.frame.total * scale;
      if (w < 0.5 || x + w <= 0 || x >= width)
        continue;
      const left = Math.max(x, 0), right = Math.min(x + w, width);
      const y = top(b.level);
      // the frames under the one zoomed on, which zoom back out
      ctx.globalAlpha = b.level < zoomLevel ? 0.5 : 1;
      const found = pattern?.test(b.frame.name);
      // warm hues, as flame graphs are: from red to yellow
      const k = spread(b.frame.name);
      ctx.fillStyle = found ? (dark ? '#9a3d9a' : '#d462d4')
        : dark ? `hsl(${Math.round(k * 45)}, 55%, ${30 + Math.round(k * 10)}%)`
        : `hsl(${Math.round(k * 50)}, 80%, ${58 + Math.round(k * 12)}%)`;
      ctx.fillRect(left, y, Math.max(right - left - 1, 0.5), ROW - 1);
      const chars = Math.floor((right - left - 6) / charWidth);
      if (chars >= 3) {
        ctx.fillStyle = dark || found ? '#f1efe9' : '#1f2328';
        const name = b.frame.name;
        ctx.fillText(name.length <= chars ? name : name.substring(0, chars - 1) + '…', left + 3, y + ROW / 2);
      }
    }
  ctx.globalAlpha = 1;
  if (hovered) {
    const x = Math.max((hovered.left - from) * scale, 0);
    const w = Math.min(hovered.frame.total * scale, width - x);
    ctx.strokeStyle = dark ? '#f1efe9' : '#1f2328';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top(hovered.level) + 0.5, Math.max(w - 2, 1), ROW - 2);
  }
}

/**
 * @param {Flame} flame
 * @param {Box} b the box hovered
 * @param {Box | null} zoomed
 * @param {import('../model/units.js').Unit} unit what the totals count
 * @returns {HTMLElement[]} what the tooltip says of it: its times, and what a click does
 */
export function tipOf(flame, b, zoomed, unit) {
  const all = flame.root.frame.total || 1;
  const share = (/** @type {number} */ v) => `${amount(v, unit)} · ${(100 * v / all).toFixed(v / all < 0.1 ? 2 : 1)}%`;
  const z = zoomed;
  return [
    h('div', {class: 'flame-tip-name'}, b.frame.name),
    h('div', null, `Total ${share(b.frame.total)}`),
    h('div', null, `Self ${share(b.frame.self)}`),
    ...z && b.level >= z.level && z !== b
      ? [h('div', null, `${(100 * b.frame.total / z.frame.total).toFixed(1)}% of the zoomed frame`)] : [],
    h('div', {class: 'muted'}, z && b.level < z.level ? 'Click to zoom out' : b === z || b === flame.root ? '' : 'Click to zoom in'),
  ];
}

/**
 * Puts a tooltip beside the pointer, on the side of its holder with more room.
 *
 * @param {HTMLElement} tip positioned in its offset parent
 * @param {{clientX: number, clientY: number}} e the mouse, or the middle of the view looking around
 */
export function placeTip(tip, e) {
  const r = tip.offsetParent?.getBoundingClientRect();
  if (!r)
    return;
  const x = e.clientX - r.left, y = e.clientY - r.top;
  tip.style.left = x < r.width / 2 ? `${x + 16}px` : '';
  tip.style.right = x < r.width / 2 ? '' : `${r.width - x + 16}px`;
  tip.style.top = `${y + 16 + tip.offsetHeight <= r.height ? y + 16 : Math.max(0, y - 8 - tip.offsetHeight)}px`;
}
