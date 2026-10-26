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
import {layout, pick, pathOf, follow, matched} from '../model/flame.js';
import {ROW, paintFlame, tipOf, placeTip} from './flame-draw.js';

/** @typedef {import('../model/flame.js').Box} Box */
/** @typedef {import('../profile/profile.js').Frame} Frame */

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

  /** @type {import('./flame-draw.js').Look} */
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

  canvas.addEventListener('mousemove', e => {
    const b = boxAt(e);
    if (b !== look.hovered) {
      look.hovered = b;
      draw();
    }
    if (b) {
      replace(tip, ...tipOf(flame, b, look.zoomed, unit));
      tip.hidden = false;
      placeTip(tip, e);
    }
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
    if (b) {
      zoomOn(b);
      // what it says of the box changed: told again as the mouse moves
      tip.hidden = true;
    }
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
