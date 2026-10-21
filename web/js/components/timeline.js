// @ts-check
/**
 * A strip showing the weight of the samples over the recording, on which an interval is dragged to
 * focus the landscape on it. Dragging an edge of the interval adjusts it, dragging inside slides it
 * along the recording, a click outside clears it. The interval is given while the pointer moves,
 * at most every LIVE ms, and when it is released: the landscape is built again each time. When the
 * samples are in operations the bars are stacked by operation, a legend names them, and one clicked
 * is the only operation the landscape shows.
 */
import {h} from '../lib/dom.js';
import * as fmt from '../lib/format.js';
import {amount} from '../model/units.js';
import {histogram, interval, span, operations, within} from '../model/timeline.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */
/** @typedef {import('../model/timeline.js').Interval} Interval */

/** How near an edge of the interval a pointer is to take it, in px. */
const GRAB = 6;
/** How long the landscape waits for a drag to go on before it follows it, ms. */
const LIVE = 150;
/** The widest a bucket of the plot is, in px. */
const BUCKET = 3;

/** @typedef {import('../model/timeline.js').Operations} Operations */

/**
 * @param {number} ms the duration of the recording
 * @returns {string}
 */
const clock = ms => ms >= 10_000 ? fmt.duration(ms) : `${(ms / 1000).toFixed(2)} s`;

/**
 * @typedef {object} TimelineOptions
 * @property {(i: Interval | null) => void} changed given the interval selected, null for the whole
 *           recording, while the pointer moves and when it is released
 * @property {boolean} holding whether the peaks of the whole recording are kept in focus
 * @property {(on: boolean) => void} hold given whether they are, when it is changed
 * @property {Interval | null} [initial] the interval selected at first
 * @property {(name: string | null) => void} [operation] given the operation clicked in the legend, null
 *           when it was the one shown alone already: back to all of them
 */

/**
 * @param {TimelineOptions} options
 * @returns {{element: HTMLElement, update: (p: Profile, filter: Filter) => void}} the strip, and what
 *          draws it again for the samples kept (filter: no interval, the whole recording shows)
 */
export function timeline({changed, holding, hold, initial = null, operation = () => {}}) {
  const canvas = h('canvas', {class: 'timeline-plot'});
  const label = h('span', {class: 'timeline-label muted'});
  const clear = h('button', {type: 'button', class: 'button', hidden: true, title: 'Back to the whole recording'},
                  'Clear');
  const held = h('input', {type: 'checkbox', checked: holding, onchange: () => hold(held.checked)});
  const keep = h('label', {title: 'The peaks of the whole recording, where they stand there, whatever is in focus: '
                                   + 'each mountain grows or shrinks in place as the interval moves'},
                 held, ' Keep the peaks of the whole recording');
  const legend = h('div', {class: 'timeline-legend', hidden: true});
  const element = h('div', {class: 'timeline'}, canvas, legend, h('div', {class: 'timeline-bar'}, label, clear, keep));

  /** @type {Profile | null} */
  let profile = null;
  /** @type {Filter} */
  let kept = {};
  /** @type {{span: number, ms: Float64Array, ops: Operations | null}} */
  let data = {span: 0, ms: new Float64Array(0), ops: null};
  /** @type {string | null} the operation the landscape is on */
  let alone = null;
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
    if (data.ms.length !== count) {
      data = {...histogram(profile, kept, count), ops: operations(profile, kept, count)};
    }
    const top = Math.max(...data.ms, 1e-9);
    const w = width / data.ms.length;
    // from the bottom: the operations, the others, what ran outside any; one colour if there are none
    const layers = data.ops
      ? [...data.ops.series.map((s, k) => ({ms: s.ms, color: color(`--series-${k + 1}`) || '#888', fade: alone !== null && s.name !== alone})),
         ...data.ops.other ? [{ms: data.ops.other, color: color('--series-other') || '#aaa', fade: alone !== null}] : [],
         ...data.ops.none ? [{ms: data.ops.none, color: color('--line') || '#ccc', fade: alone !== null}] : []]
      : [{ms: data.ms, color: color('--accent') || '#3d6b4f', fade: false}];
    for (let i = 0; i < data.ms.length; i++) {
      let y = height;
      for (const layer of layers) {
        const bar = layer.ms[i] / top * (height - 2);
        if (bar <= 0)
          continue;
        g.globalAlpha = layer.fade ? 0.3 : 1;
        g.fillStyle = layer.color;
        g.fillRect(i * w, y - bar, Math.max(1, w - 0.5), bar);
        y -= bar;
      }
    }
    g.globalAlpha = 1;
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
    key(data.ops);
  };

  /** What the legend shows, to leave it as it is when nothing changed. */
  let shown = '';

  /**
   * Names the operations of the bars, each a button: the landscape shows that one alone. With an
   * interval selected, those that ran in it only, in the colours they have in the whole recording.
   *
   * @param {Operations | null} ops
   */
  const key = ops => {
    legend.hidden = !ops;
    if (!ops) {
      legend.replaceChildren();
      shown = '';
      return;
    }
    const unit = profile?.unit ?? 'ms';
    /** @param {Float64Array} ms @param {number} total @returns {number} its weight in the interval */
    const inside = (ms, total) => chosen ? within(ms, Math.min(...chosen), Math.max(...chosen)) : total;
    const sum = (/** @type {Float64Array} */ ms) => ms.reduce((a, b) => a + b, 0);
    const rows = ops.series.map((s, k) => ({s, k, w: inside(s.ms, s.total)}))
                           .filter(r => r.w > 0 || r.s.name === alone);
    const other = ops.other ? inside(ops.other, sum(ops.other)) : 0;
    const none = ops.none ? inside(ops.none, sum(ops.none)) : 0;
    const signature = JSON.stringify([alone, chosen !== null, rows.map(r => [r.s.name, Math.round(r.w)]),
                                      Math.round(other), Math.round(none)]);
    if (signature === shown)
      return;
    shown = signature;
    const where = chosen ? ' in the interval' : '';
    legend.replaceChildren(
      ...rows.map(({s, k, w}) => h('button',
        {type: 'button', class: `timeline-key${s.name === alone ? ' on' : ''}`, onclick: () => {
          alone = s.name === alone ? null : s.name;
          operation(alone);
          draw();
        }, title: `${s.name}: ${amount(w, unit)}${where}${chosen ? `, ${amount(s.total, unit)} in all` : ''}. `
                  + 'Click to see the landscape of this operation alone'},
        h('i', {style: `background: var(--series-${k + 1})`}), s.name)),
      ...other > 0 ? [h('span', {class: 'timeline-key other', title: `${amount(other, unit)}${where}`},
                        h('i', {style: 'background: var(--series-other)'}), 'other operations')] : [],
      ...none > 0 ? [h('span', {class: 'timeline-key other', title: `${amount(none, unit)}${where}`},
                      h('i', {style: 'background: var(--line)'}), 'outside any operation')] : []);
  };

  /** @param {PointerEvent} e @returns {number} where it is, as a share of the width */
  const at = e => {
    const r = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  };

  /**
   * @typedef {object} Drag
   * @property {number} fixed the edge of a new or resized selection that does not move
   * @property {boolean} moved whether the pointer went further than a click's jitter
   * @property {boolean} keep whether the selection stays if it did not move: it was touched, not clicked off
   * @property {{offset: number, width: number} | undefined} [slide] where in the selection it was taken,
   *           and its width, when it moves whole
   */
  /** @type {Drag | null} the drag going on */
  let drag = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let live;
  /** Tells the interval now chosen. */
  const emit = () => {
    live = undefined;
    changed(chosen ? interval(chosen[0], chosen[1], data.span) : null);
  };
  /** @param {number} x @returns {'edge' | 'inside' | 'outside'} where a pointer is, as to the selection */
  const where = x => {
    if (!chosen)
      return 'outside';
    const grab = GRAB / Math.max(1, canvas.clientWidth);
    const lo = Math.min(...chosen), hi = Math.max(...chosen);
    return Math.abs(x - lo) <= grab || Math.abs(x - hi) <= grab ? 'edge' : x > lo && x < hi ? 'inside' : 'outside';
  };
  canvas.addEventListener('pointerdown', e => {
    if (!profile || data.span <= 0)
      return;
    const x = at(e);
    const lo = chosen ? Math.min(...chosen) : NaN, hi = chosen ? Math.max(...chosen) : NaN;
    const part = where(x);
    if (part === 'edge')
      drag = {fixed: Math.abs(x - lo) <= Math.abs(x - hi) ? hi : lo, moved: false, keep: true};
    else if (part === 'inside')
      drag = {fixed: x, moved: false, keep: true, slide: {offset: x - lo, width: hi - lo}};
    else
      drag = {fixed: x, moved: false, keep: false};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    const x = at(e);
    if (!drag) {
      const part = where(x);
      canvas.style.cursor = part === 'edge' ? 'ew-resize' : part === 'inside' ? 'grab' : 'crosshair';
      return;
    }
    // a few px of jitter in a click is no selection
    if (!drag.moved && Math.abs(x - drag.fixed) * canvas.clientWidth < 3)
      return;
    drag.moved = true;
    if (drag.slide) {
      const lo = Math.max(0, Math.min(1 - drag.slide.width, x - drag.slide.offset));
      chosen = [lo, lo + drag.slide.width];
      canvas.style.cursor = 'grabbing';
    }
    else
      chosen = [drag.fixed, x];
    draw();
    // the landscape follows, as often as it can be built
    live ??= setTimeout(emit, LIVE);
  });
  const release = () => {
    if (!drag)
      return;
    const was = drag;
    drag = null;
    clearTimeout(live);
    live = undefined;
    // a selection only touched is kept
    if (was.keep && !was.moved)
      return;
    if (!was.moved || !chosen || !interval(chosen[0], chosen[1], data.span))
      chosen = null;
    draw();
    emit();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  clear.addEventListener('click', () => {
    chosen = null;
    draw();
    emit();
  });
  new ResizeObserver(() => draw()).observe(canvas);

  return {
    element,
    update(p, filter) {
      if (initial) {
        const ms = span(p);
        if (ms > 0)
          chosen = [(initial.from ?? 0) * 1000 / ms, initial.to !== undefined ? initial.to * 1000 / ms : 1];
        initial = null;
      }
      if (p !== profile || filter.java !== kept.java)
        data = {span: 0, ms: new Float64Array(0), ops: null};
      profile = p;
      kept = filter;
      draw();
    },
  };
}
