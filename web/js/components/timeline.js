// @ts-check
/**
 * A strip showing the weight of the samples over the recording, on which an interval is dragged to
 * focus the landscape on it. Dragging an edge of the interval adjusts it, a click clears it. The
 * interval is given when the pointer is released, not while it moves: the landscape is built
 * again each time.
 */
import {h} from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import {histogram, interval} from '../model/timeline.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */
/** @typedef {import('../model/timeline.js').Interval} Interval */

/** How near an edge of the interval a pointer is to take it, in px. */
const GRAB = 6;
/** The widest a bucket of the plot is, in px. */
const BUCKET = 3;

/**
 * @param {number} ms the duration of the recording
 * @returns {string}
 */
const clock = ms => ms >= 10_000 ? fmt.duration(ms) : `${(ms / 1000).toFixed(2)} s`;

/**
 * @param {(i: Interval | null) => void} changed given the interval selected, null for the whole
 *        recording, when the pointer is released
 * @returns {{element: HTMLElement, update: (p: Profile, filter: Filter) => void}} the strip, and what
 *          draws it again for the samples kept (filter: no interval, the whole recording shows)
 */
export function timeline(changed) {
  const canvas = h('canvas', {class: 'timeline-plot'});
  const label = h('span', {class: 'timeline-label muted'});
  const clear = h('button', {type: 'button', class: 'button', hidden: true, title: 'Back to the whole recording'},
                  'Clear');
  const element = h('div', {class: 'timeline'}, canvas, h('div', {class: 'timeline-bar'}, label, clear));

  /** @type {Profile | null} */
  let profile = null;
  /** @type {Filter} */
  let kept = {};
  /** @type {{span: number, ms: Float64Array}} */
  let data = {span: 0, ms: new Float64Array(0)};
  /** @type {[number, number] | null} the selection, as shares of the width */
  let chosen = null;

  const draw = () => {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!profile || width <= 0 || height <= 0)
      return;
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.scale(ratio, ratio);
    const style = getComputedStyle(document.documentElement);
    const color = (/** @type {string} */ name) => style.getPropertyValue(name).trim();

    const count = Math.max(1, Math.floor(width / BUCKET));
    if (data.ms.length !== count)
      data = histogram(profile, kept, count);
    const top = Math.max(...data.ms, 1e-9);
    const w = width / data.ms.length;
    g.fillStyle = color('--accent') || '#3d6b4f';
    for (let i = 0; i < data.ms.length; i++) {
      const bar = Math.round(data.ms[i] / top * (height - 2));
      if (bar > 0)
        g.fillRect(i * w, height - bar, Math.max(1, w - 0.5), bar);
    }
    if (chosen) {
      const x0 = Math.min(...chosen) * width, x1 = Math.max(...chosen) * width;
      // what is out of focus faded
      g.globalAlpha = 0.65;
      g.fillStyle = color('--bg') || '#fbfaf7';
      g.fillRect(0, 0, x0, height);
      g.fillRect(x1, 0, width - x1, height);
      g.globalAlpha = 1;
      g.strokeStyle = color('--accent') || '#3d6b4f';
      g.lineWidth = 2;
      g.strokeRect(x0, 1, Math.max(1, x1 - x0), height - 2);
    }
    const i = chosen && interval(chosen[0], chosen[1], data.span);
    clear.hidden = !i;
    label.textContent = i
      ? `${clock((i.from ?? 0) * 1000)} to ${clock(i.to !== undefined ? i.to * 1000 : data.span)}, `
        + `${fmt.duration((i.to !== undefined ? i.to * 1000 : data.span) - (i.from ?? 0) * 1000)} of ${clock(data.span)}`
      : `Drag to focus on an interval of the recording's ${clock(data.span)}`;
  };

  /** @param {PointerEvent} e @returns {number} where it is, as a share of the width */
  const at = e => {
    const r = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  };

  /** @type {{fixed: number, moved: boolean, edge: boolean} | null} the drag going on, from the edge not moved */
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!profile || data.span <= 0)
      return;
    const x = at(e), grab = GRAB / Math.max(1, canvas.clientWidth);
    const [lo, hi] = chosen ? [Math.min(...chosen), Math.max(...chosen)] : [NaN, NaN];
    if (chosen && Math.abs(x - lo) <= grab)
      drag = {fixed: hi, moved: false, edge: true};
    else if (chosen && Math.abs(x - hi) <= grab)
      drag = {fixed: lo, moved: false, edge: true};
    else
      drag = {fixed: x, moved: false, edge: false};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    const x = at(e);
    if (!drag) {
      const grab = GRAB / Math.max(1, canvas.clientWidth);
      const near = chosen && chosen.some(c => Math.abs(c - x) <= grab);
      canvas.style.cursor = near ? 'ew-resize' : 'crosshair';
      return;
    }
    // a few px of jitter in a click is no selection
    if (!drag.moved && Math.abs(x - drag.fixed) * canvas.clientWidth < 3)
      return;
    drag.moved = true;
    chosen = [drag.fixed, x];
    draw();
  });
  const release = () => {
    if (!drag)
      return;
    const was = drag;
    drag = null;
    // an edge only touched keeps the selection
    if (was.edge && !was.moved)
      return;
    const i = was.moved && chosen ? interval(chosen[0], chosen[1], data.span) : null;
    if (!i)
      chosen = null;
    draw();
    changed(i);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  clear.addEventListener('click', () => {
    chosen = null;
    draw();
    changed(null);
  });
  new ResizeObserver(() => draw()).observe(canvas);

  return {
    element,
    update(p, filter) {
      if (p !== profile || filter.java !== kept.java)
        data = {span: 0, ms: new Float64Array(0)};
      profile = p;
      kept = filter;
      draw();
    },
  };
}
