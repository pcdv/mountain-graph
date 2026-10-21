// @ts-check
/**
 * The page: a profile picked or dropped, then its peaks, as a map of their
 * mountains filling the window under a bar of controls, and as a table
 * floating over it. Each view has its own module under views/.
 */
import {$, h, replace} from './lib/dom.js';
import {loadProfiles} from './load.js';
import {weightOf} from './profile/profile.js';
import {amount} from './model/units.js';
import {readSetting, writeSetting} from './lib/settings.js';
import {keepFile, lastFile, keepInterval, lastInterval} from './last-file.js';
import {peaks, mountains, held as heldPeaks} from './model/peaks.js';
import {callees} from './model/callees.js';
import {terrain, anchorOf} from './model/terrain.js';
import {peaksView} from './views/peaks.js';
import {mapView} from './views/map.js';
import {terrainView, closeTerrainView} from './views/terrain3d.js';
import {crossfade} from './components/crossfade.js';
import {leaveOut} from './model/samples.js';
import {packageHues} from './model/hues.js';
import {hueLegend} from './components/hue-legend.js';
import {peakControls, peakSettings} from './components/peak-controls.js';
import {advanced, tuning} from './components/advanced.js';
import {anonymizeControls, anonymizing} from './components/anonymizing.js';
import {screenshotKeys} from './components/screenshot.js';
import {timeline} from './components/timeline.js';
import {span, checked} from './model/timeline.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */

const main = $('main', HTMLElement);
const picker = $('picker', HTMLInputElement);
const bar = $('bar', HTMLElement);
const strip = $('timeline', HTMLElement);

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

/** Whether the peaks of the whole recording are kept in focus, kept. */
const HOLD = 'mountaingraph.timeline.hold';

/** Which sampling of a file with several is shown, kept. */
const SAMPLING = 'mountaingraph.sampling';

/** @type {File | null} the file open, to read again when the anonymizing settings change */
let current = null;

/**
 * @param {File} file
 * @param {boolean} [again] the file kept last, opened again: its interval in focus comes back with it
 */
async function open(file, again = false) {
  current = file;
  relayout = () => {};
  main.classList.remove('stage');
  replace(bar);
  replace(strip);
  strip.hidden = true;
  replace(main, h('p', {class: 'muted'}, `Reading ${file.name}…`));
  try {
    const samplings = await loadProfiles(file, anonymizing());
    const focus = again ? await lastInterval() : null;
    if (!again)
      keepFile(file);
    const wanted = samplings.findIndex(s => s.key === readSetting(SAMPLING));
    display(file.name, samplings, Math.max(0, wanted), focus);
  }
  catch (e) {
    replace(main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/**
 * Shows one sampling of a file.
 *
 * @param {string} name of the file
 * @param {import('./load.js').Sampling[]} samplings
 * @param {number} which the one shown
 * @param {any} [saved] an interval of the recording to focus on, as kept: checked here
 */
function display(name, samplings, which, saved = null) {
  relayout = () => {};
  main.classList.remove('stage');
  replace(strip);
  strip.hidden = true;
  try {
    const p = samplings[which].profile;
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
    /** @type {import('./model/timeline.js').Interval | null} the part of the recording in focus, none for all */
    let focus = checked(saved, span(p));
    let hold = readSetting(HOLD) === 'true';
    /** @type {{key: string, peaks: import('./model/peaks.js').Peak[], anchor: import('./model/terrain.js').Anchor} | null}
     *  the peaks of the whole recording and where they stand, while the settings are the same */
    let whole = null;
    // only a recording with a time has a timeline
    /** @type {string | null} the one operation the landscape is on, none for all of them */
    let operation = null;
    const stripped = span(p) > 0 ? timeline({
      changed: i => {
        if (JSON.stringify(i) === JSON.stringify(focus))
          return;
        focus = i;
        keepInterval(i);
        relayout();
      },
      holding: hold,
      hold: on => {
        hold = on;
        writeSetting(HOLD, String(on));
        relayout();
      },
      initial: focus,
      operation: name => {
        operation = name;
        relayout();
      },
    }) : null;
    if (stripped) {
      replace(strip, stripped.element);
      strip.hidden = false;
    }
    // the view fills the window under the bar: there first, to take its shape from
    replace(bar, summary(name, p), samplingChoice(samplings, which, to => {
      writeSetting(SAMPLING, samplings[to].key);
      remember();
      display(name, samplings, to, focus);
    }));
    main.classList.add('stage');
    let tuned = tuning();
    replace(main, map, h('div', {class: 'floats'}, floating('Peaks', 'table', table),
                         floating('Advanced', 'advanced', h('div', null, advanced(t => {
                           tuned = t;
                           relayout();
                         }), anonymizeControls(() => current && open(current, true))))));
    /** @param {import('./components/peak-controls.js').PeakSettings} settings */
    const show = settings => {
      last = settings;
      const {grain, count, coverage, waits, hide, java, shape, view, colour} = settings;
      if (kept?.waits !== waits) {
        const {profile, left} = leaveOut(p, waits);
        kept = {waits, kept: profile, left};
      }
      const q = kept.kept;
      stripped?.update(q, {all: true, java});
      // an operation alone leaves out the samples outside operations
      const only = operation ? {all: false, name: operation} : {all: true};
      const filter = {...only, hide, java, ...focus};
      // the mountains spread in the window's shape
      const aspect = Math.max(1, main.clientWidth / Math.max(1, main.clientHeight));
      /** @type {import('./model/terrain.js').Anchor | undefined} */
      let anchor;
      /** @type {import('./model/peaks.js').Peaks} */
      let r;
      if (hold && focus) {
        // the peaks of the whole recording, where they stand there: those the interval has shrink in place
        const everything = {...only, hide, java};
        const key = JSON.stringify([waits, hide, java, grain, count, coverage, aspect, operation]);
        if (whole?.key !== key) {
          const w = peaks(q, everything, {count, coverage, grain});
          const wm = mountains(q, everything, w.peaks, grain);
          whole = {key, peaks: w.peaks, anchor: anchorOf(w.peaks.flatMap(peak => wm.get(peak.name) ?? []), aspect)};
        }
        r = heldPeaks(q, filter, whole.peaks.map(peak => peak.name), grain);
        anchor = whole.anchor;
      }
      else
        r = peaks(q, filter, {count, coverage, grain});
      const m = mountains(q, filter, r.peaks, grain);
      selection.callees = name => callees(q, filter, name, grain);
      const trees = r.peaks.flatMap(peak => m.get(peak.name) ?? []);
      const t = terrain(trees, {shape, aspect, tuning: tuned, anchor});
      const coloured = colour === 'package' ? packageHues(t, grain) : null;
      const hues = coloured?.hues ?? null;
      const legend = coloured ? hueLegend(coloured.legend) : null;
      if (view === '3d')
        // over the view shown, which stays until the new one has drawn: no blank frame
        crossfade(map, shown => terrainView(t, trees, selection, viewpoint, hues, tuned, shown), ...legend ? [legend] : []);
      else {
        closeTerrainView();
        replace(map, mapView(t, trees, selection, hues), legend);
      }
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
 * @param {import('./load.js').Sampling[]} samplings
 * @param {number} which the one shown
 * @param {(to: number) => void} choose
 * @returns {HTMLElement | null} what tells which samples count, when the file holds several kinds
 */
function samplingChoice(samplings, which, choose) {
  if (samplings.length < 2)
    return null;
  const select = h('select', {title: 'What the samples count'},
                   samplings.map((s, i) => h('option', {value: String(i)}, s.label)));
  select.value = String(which);
  select.addEventListener('change', () => choose(Number(select.value)));
  return h('label', {class: 'sampling'}, 'Samples ', select);
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
    h('span', {class: 'muted'}, p.start
      ? `${p.kind.length.toLocaleString()} samples (${amount(ms, p.unit)} with a stack), `
        + `${p.parent.length.toLocaleString()} stack nodes, ${p.threads.length} threads, `
        + `${p.operations.count.toLocaleString()} operations, recorded from ${p.start} `
        + `for ${(p.end / 1e9).toFixed(1)} s.`
      : `Collapsed stacks: ${p.kind.length.toLocaleString()} distinct, ${amount(ms, p.unit)}, `
        + `${p.parent.length.toLocaleString()} stack nodes.`));
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

// S saves a picture of the view, C copies it
screenshotKeys(() => (current?.name ?? 'mountain-graph').replace(/(\.\w+)?(\.gz)?$/, ''));

// the profile opened last, shown again
lastFile().then(file => file && open(file, true));
