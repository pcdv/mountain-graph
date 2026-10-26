// @ts-check
/**
 * A flame graph on a canvas: a frame as wide as its time, its callees on top
 * of it, as jfr-web draws them (the layout is model/flame.js). A click zooms
 * on a frame, which fills the width: the frames under it stay, faded, and a
 * click on one of them zooms back out. Hovering a frame tells its times; a
 * search colours the frames whose name matches, and tells their share.
 */
import {h, replace} from '../lib/dom.js';
import {amount} from '../model/units.js';
import {layout, range, pick, pathOf, follow, matched} from '../model/flame.js';

/** @typedef {import('../model/flame.js').Box} Box */
/** @typedef {import('../model/flame.js').Flame} Flame */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** Height of a level, px. */
const ROW = 18;
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
 * Draws the boxes in the width given, the root at the bottom of the canvas and its callees above
 * it, as flame graphs are. Shared with whatever draws a flame graph elsewhere (a texture).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Flame} flame
 * @param {Look} look
 * @param {number} width px
 */
export function paintFlame(ctx, flame, {zoomed, hovered, pattern, dark}, width) {
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  const charWidth = ctx.measureText('m').width;
  const {from, span} = range(flame, zoomed);
  const scale = width / span;
  const zoomLevel = zoomed ? zoomed.level : 0;
  for (const boxes of flame.levels)
    for (const b of boxes) {
      const x = (b.left - from) * scale, w = b.frame.total * scale;
      if (w < 0.5 || x + w <= 0 || x >= width)
        continue;
      const left = Math.max(x, 0), right = Math.min(x + w, width);
      const y = (flame.levels.length - 1 - b.level) * ROW;
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
    ctx.strokeRect(x + 0.5, (flame.levels.length - 1 - hovered.level) * ROW + 0.5, Math.max(w - 2, 1), ROW - 2);
  }
}

/**
 * @param {Frame} root the tree of the samples kept, as tree() in profile.js makes it
 * @param {import('../model/units.js').Unit} unit what its totals count
 * @param {import('./terrain3d.js').Viewpoint} viewpoint where the graph is zoomed, kept up to date, so
 *        that it stays there when the view is built again
 * @returns {HTMLElement} fills the view; draws again as it is resized
 */
export function flameView(root, unit, viewpoint) {
  const flame = layout(root);
  const canvas = h('canvas', {class: 'flame-canvas'});
  const tip = h('div', {class: 'flame-tip', hidden: true});
  // as tall as the deepest stack, which scrolls when it is taller than the window
  const scroller = h('div', {class: 'flame-scroll'}, canvas);
  const search = h('input', {type: 'search', placeholder: 'Search, e.g. HashMap|parse', 'aria-label': 'Search frames'});
  const found = h('span', {class: 'muted'});
  const reset = h('button', {type: 'button', class: 'button', hidden: true, onclick: () => zoomOn(null)}, 'Reset zoom');
  const dark = matchMedia('(prefers-color-scheme: dark)');

  /** @type {Look} */
  const look = {zoomed: null, hovered: null, pattern: null, dark: dark.matches};

  const draw = () => {
    const width = scroller.clientWidth, height = flame.levels.length * ROW;
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx)
      return;
    look.dark = dark.matches;
    ctx.scale(ratio, ratio);
    paintFlame(ctx, flame, look, width);
  };

  /** @param {MouseEvent} e */
  const boxAt = e => {
    const r = canvas.getBoundingClientRect();
    return pick(flame, look.zoomed, (e.clientX - r.left) / r.width,
                flame.levels.length - 1 - Math.floor((e.clientY - r.top) / ROW));
  };

  /** @param {Box | null} box null for the root */
  const zoomOn = box => {
    look.zoomed = box && box !== flame.root ? box : null;
    viewpoint.flame = look.zoomed ? pathOf(look.zoomed) : undefined;
    reset.hidden = !look.zoomed;
    draw();
  };

  /**
   * @param {Box} b
   * @param {MouseEvent} e
   */
  const tell = (b, e) => {
    const all = flame.root.frame.total || 1;
    const share = (/** @type {number} */ v) => `${amount(v, unit)} · ${(100 * v / all).toFixed(v / all < 0.1 ? 2 : 1)}%`;
    const z = look.zoomed;
    replace(tip,
      h('div', {class: 'flame-tip-name'}, b.frame.name),
      h('div', null, `Total ${share(b.frame.total)}`),
      h('div', null, `Self ${share(b.frame.self)}`),
      z && b.level >= z.level && z !== b
        ? h('div', null, `${(100 * b.frame.total / z.frame.total).toFixed(1)}% of the zoomed frame`) : null,
      h('div', {class: 'muted'}, z && b.level < z.level ? 'Click to zoom out' : b === z || b === flame.root ? '' : 'Click to zoom in'));
    tip.hidden = false;
    const r = scroller.parentElement?.getBoundingClientRect();
    if (!r)
      return;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    tip.style.left = x < r.width / 2 ? `${x + 16}px` : '';
    tip.style.right = x < r.width / 2 ? '' : `${r.width - x + 16}px`;
    tip.style.top = `${y + 16 + tip.offsetHeight <= r.height ? y + 16 : Math.max(0, y - 8 - tip.offsetHeight)}px`;
  };

  canvas.addEventListener('mousemove', e => {
    const b = boxAt(e);
    if (b !== look.hovered) {
      look.hovered = b;
      draw();
    }
    if (b)
      tell(b, e);
    else
      tip.hidden = true;
  });
  canvas.addEventListener('mouseleave', () => {
    look.hovered = null;
    tip.hidden = true;
    draw();
  });
  canvas.addEventListener('click', e => {
    const b = boxAt(e);
    if (b)
      zoomOn(b);
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && look.zoomed && canvas.isConnected && document.activeElement === document.body)
      zoomOn(null);
  });
  search.addEventListener('input', () => {
    try {
      look.pattern = search.value ? new RegExp(search.value) : null;
      search.classList.remove('invalid');
    }
    catch {
      look.pattern = null;
      search.classList.add('invalid');
    }
    const total = flame.root.frame.total || 1;
    const weight = look.pattern ? matched(flame, look.pattern) : 0;
    found.textContent = look.pattern ? `Matched: ${(100 * weight / total).toFixed(1)}%, ${amount(weight, unit)}` : '';
    draw();
  });
  // on the root, at the bottom, once the graph has a size
  let toRoot = true;
  new ResizeObserver(() => {
    draw();
    if (toRoot && scroller.clientWidth > 0) {
      toRoot = false;
      scroller.scrollTop = scroller.scrollHeight;
    }
  }).observe(scroller);
  dark.addEventListener('change', draw);
  // zoomed on the same frame as before, if the new tree still has it
  const before = viewpoint.flame && follow(flame, viewpoint.flame);
  if (before)
    zoomOn(before);

  return h('div', {class: 'flame'},
    h('div', {class: 'flame-bar'}, search, found, reset),
    h('div', {class: 'flame-body'}, scroller, tip));
}
