// @ts-check
/**
 * The page: a profile picked or dropped, then its peaks, as a map of their
 * mountains filling the window under a bar of controls, and as a table
 * floating over it. Each view has its own module under views/.
 */
import {$, h, replace} from './lib/dom.js';
import {loadProfile} from './load.js';
import {weightOf} from './profile/profile.js';
import {amount} from './lib/format.js';
import {readSetting, writeSetting} from './lib/settings.js';
import {keepFile, lastFile} from './last-file.js';
import {peaks, mountains} from './model/peaks.js';
import {callees} from './model/callees.js';
import {terrain} from './model/terrain.js';
import {peaksView} from './views/peaks.js';
import {mapView} from './views/map.js';
import {terrainView, closeTerrainView} from './views/terrain3d.js';
import {leaveOut} from './model/samples.js';
import {packageHues} from './model/hues.js';
import {hueLegend} from './components/hue-legend.js';
import {peakControls, peakSettings} from './components/peak-controls.js';
import {advanced, tuning} from './components/advanced.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */

const main = $('main', HTMLElement);
const picker = $('picker', HTMLInputElement);
const bar = $('bar', HTMLElement);

picker.addEventListener('change', () => {
  if (picker.files && picker.files[0])
    open(picker.files[0]);
});

document.addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('dropping');
});
document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null)
    document.body.classList.remove('dropping');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  const file = e.dataTransfer?.files[0];
  if (file)
    open(file);
});

/** Where what is shown is kept, for the page opened again. */
const VIEW = 'mountaingraph.view';

/** Keeps what is shown. */
let remember = () => {};
addEventListener('pagehide', () => remember());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && remember());

/**
 * @returns {{open: string[], chosen: string, tab: 'callers' | 'callees' | undefined,
 *            viewpoint: import('./views/terrain3d.js').Viewpoint}} as kept last, or nothing shown
 */
function remembered() {
  try {
    const v = JSON.parse(readSetting(VIEW) ?? '{}');
    return {open: Array.isArray(v.open) ? v.open.filter((/** @type {any} */ o) => typeof o === 'string') : [],
            chosen: typeof v.chosen === 'string' ? v.chosen : '',
            tab: v.tab === 'callees' ? 'callees' : v.tab === 'callers' ? 'callers' : undefined,
            viewpoint: v.viewpoint && typeof v.viewpoint === 'object' ? v.viewpoint : {}};
  }
  catch {
    return {open: [], chosen: '', tab: undefined, viewpoint: {}};
  }
}

/** Shows the profile open again, laid out in the window's shape. */
let relayout = () => {};
/** @type {number | undefined} */
let resizing;
addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => relayout(), 300);
});

/** @param {File} file */
async function open(file) {
  relayout = () => {};
  main.classList.remove('stage');
  replace(bar);
  replace(main, h('p', {class: 'muted'}, `Reading ${file.name}…`));
  try {
    const p = await loadProfile(file);
    keepFile(file);
    const map = h('div', {class: 'stage-view'}), table = h('div', {class: 'table-body'});
    // as left when the page was last closed: the rows unfolded, the peak chosen, the 3D camera
    const kept0 = remembered();
    /** @type {Set<string>} */
    const open = new Set(kept0.open);
    /** @type {import('./components/terrain-frame.js').Selection} */
    const selection = {chosen: kept0.chosen, tab: kept0.tab, unit: p.unit};
    /** @type {import('./views/terrain3d.js').Viewpoint} the 3D view's camera, kept as settings change */
    const viewpoint = kept0.viewpoint;
    remember = () => writeSetting(VIEW, JSON.stringify({open: [...open], chosen: selection.chosen,
                                                        tab: selection.tab, viewpoint}));
    /** @type {{waits: string, kept: Profile, left: number} | null} the samples kept, while waits is the same */
    let kept = null;
    // the view fills the window under the bar: there first, to take its shape from
    replace(bar, summary(file.name, p));
    main.classList.add('stage');
    let tuned = tuning();
    replace(main, map, h('div', {class: 'floats'}, floating('Peaks', 'table', table),
                         floating('Advanced', 'advanced', advanced(t => {
                           tuned = t;
                           relayout();
                         }))));
    /** @param {import('./components/peak-controls.js').PeakSettings} settings */
    const show = settings => {
      last = settings;
      const {grain, count, coverage, waits, hide, java, shape, view, colour} = settings;
      if (kept?.waits !== waits) {
        const {profile, left} = leaveOut(p, waits);
        kept = {waits, kept: profile, left};
      }
      const q = kept.kept;
      const filter = {all: true, hide, java};
      const r = peaks(q, filter, {count, coverage, grain});
      const m = mountains(q, filter, r.peaks, grain);
      selection.callees = name => callees(q, filter, name, grain);
      // the mountains spread in the window's shape
      const aspect = Math.max(1, main.clientWidth / Math.max(1, main.clientHeight));
      const trees = r.peaks.flatMap(peak => m.get(peak.name) ?? []);
      const t = terrain(trees, {shape, aspect, tuning: tuned});
      const coloured = colour === 'package' ? packageHues(t, grain) : null;
      const hues = coloured?.hues ?? null;
      closeTerrainView();
      replace(map, view === '3d' ? terrainView(t, trees, selection, viewpoint, hues, tuned) : mapView(t, trees, selection, hues),
              coloured ? hueLegend(coloured.legend) : null);
      replace(table, peaksView(r, m, open, kept.left, p.unit));
    };
    /** @type {import('./components/peak-controls.js').PeakSettings | null} */
    let last = null;
    bar.append(peakControls(peakSettings(), show));
    // laid out again in the window's shape, the bar in place, and as it is resized
    relayout = () => last && show(last);
    relayout();
  }
  catch (e) {
    replace(main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/**
 * @param {string} name of the file
 * @param {Profile} p
 */
function summary(name, p) {
  let ms = 0;
  for (let i = 0; i < p.kind.length; i++)
    if (p.stack[i] >= 0)
      ms += weightOf(p, i);
  return h('div', {class: 'summary'},
    h('b', null, name),
    h('span', {class: 'muted'},
      `${p.kind.length.toLocaleString()} samples (${amount(ms, p.unit)} with a stack), `
      + `${p.parent.length.toLocaleString()} stack nodes, ${p.threads.length} threads, `
      + `${p.operations.count.toLocaleString()} operations, recorded from ${p.start} `
      + `for ${(p.end / 1e9).toFixed(1)} s.`));
}

/**
 * A pane floating over the view, folded or not as last left.
 *
 * @param {string} title
 * @param {string} key under which its state is remembered
 * @param {HTMLElement} body
 * @returns {HTMLElement}
 */
function floating(title, key, body) {
  const setting = `mountaingraph.float.${key}`;
  const pane = h('details', {class: `floating ${key}`}, h('summary', null, title), body);
  pane.open = readSetting(setting) === 'open';
  pane.addEventListener('toggle', () => writeSetting(setting, pane.open ? 'open' : 'closed'));
  return pane;
}

// the profile opened last, shown again
lastFile().then(file => file && open(file));
