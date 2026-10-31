// @ts-check
/**
 * What the page gives the view of each kind of file (samples.js, heap.js):
 * where to draw, the panes floating over the view, and what is kept of the
 * view for the page opened again.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';

/**
 * @typedef {object} Page
 * @property {HTMLElement} main where the view goes, filling the window under the bar
 * @property {HTMLElement} bar in the header: what the file is, and its menu
 * @property {HTMLElement} tools in the header: how the file is shown (a map or 3D)
 * @property {HTMLElement} settings the settings pane's content, in sections
 * @property {HTMLElement} strip under the bar, for a timeline: hidden unless the view shows it
 * @property {() => void} relayout set by the view shown: lays it out again in the window's shape
 * @property {() => void} remember set by the view shown: keeps what it shows
 * @property {() => void} reopen shows the file again, its names anonymized as the settings now say
 * @property {() => Moment} moment set by the view shown: what it shows that is not a setting, for a tour's view
 * @property {(moment: Moment) => void} redisplay set by the view shown: shows the file again as the settings of the
 *           view now say, and at a moment (a tour's next view), without reading it again
 */

/**
 * What a view shows beyond its settings, which a tour's view keeps.
 *
 * @typedef {object} Moment
 * @property {import('../model/timeline.js').Interval | null} [interval] of the recording in focus, none for all
 * @property {string | null} [operation] the one operation the landscape is on, none for all of them
 * @property {string[] | null} [hover] the names from a peak down to the frame hovered, its path told in the box
 *           over the view
 * @property {boolean} [peaks] whether the pane of the peaks is open
 */

/** The key of the pane of the peaks (`floating`). */
export const PEAKS = 'table';

/**
 * @param {HTMLElement} main
 * @returns {HTMLElement} where the view is drawn: the one of the view shown, kept, so that a 3D view drawn again
 *          fades in over it rather than over an empty page
 */
export function stageView(main) {
  return /** @type {HTMLElement | null} */ (main.querySelector(':scope > .stage-view')) ?? h('div', {class: 'stage-view'});
}

/** Where what is shown is kept, for the page opened again. */
const VIEW = 'mountaingraph.view';

/**
 * @typedef {object} Kept
 * @property {string[]} open the rows of the peaks' table unfolded
 * @property {string} chosen the peak whose panel shows
 * @property {import('../components/terrain-frame.js').Tab | undefined} tab what the panel shows
 * @property {import('../views/terrain3d.js').Viewpoint} viewpoint the 3D view's camera
 */

/** @returns {Kept} as kept last, or nothing shown */
export function remembered() {
  try {
    const v = JSON.parse(readSetting(VIEW) ?? '{}');
    return {open: Array.isArray(v.open) ? v.open.filter((/** @type {any} */ o) => typeof o === 'string') : [],
            chosen: typeof v.chosen === 'string' ? v.chosen : '',
            tab: ['callers', 'callees', 'holds', 'holders'].includes(v.tab) ? v.tab : undefined,
            viewpoint: v.viewpoint && typeof v.viewpoint === 'object' ? v.viewpoint : {}};
  }
  catch {
    return {open: [], chosen: '', tab: undefined, viewpoint: {}};
  }
}

/** @param {Kept} view what is shown, for the page opened again */
export function keepView(view) {
  writeSetting(VIEW, JSON.stringify(view));
}

/**
 * A pane floating over the view, folded or not as last left.
 *
 * @param {string} title
 * @param {string} key under which its state is remembered
 * @param {HTMLElement} body
 * @returns {HTMLElement}
 */
export function floating(title, key, body) {
  const setting = `mountaingraph.float.${key}`;
  const pane = h('details', {class: `floating ${key}`}, h('summary', null, title), body);
  pane.open = readSetting(setting) === 'open';
  pane.addEventListener('toggle', () => writeSetting(setting, pane.open ? 'open' : 'closed'));
  return pane;
}

/**
 * @param {string} key
 * @returns {boolean | undefined} whether the floating pane of that key is open, nothing when none is shown
 */
export function paneOpen(key) {
  const pane = document.querySelector(`details.floating.${key}`);
  return pane instanceof HTMLDetailsElement ? pane.open : undefined;
}

/**
 * Opens or folds a floating pane, the one shown and the one of a view drawn next.
 *
 * @param {string} key
 * @param {boolean} open
 */
export function openPane(key, open) {
  writeSetting(`mountaingraph.float.${key}`, open ? 'open' : 'closed');
  const pane = document.querySelector(`details.floating.${key}`);
  if (pane instanceof HTMLDetailsElement)
    pane.open = open;
}
