// @ts-check
/**
 * The view of a file of samples (a recording, a profile, collapsed stacks):
 * the methods where the time or the allocations go as peaks, the call paths
 * that led there as their slopes; a timeline when the samples have a time;
 * a choice of samplings when the file holds several.
 */
import {h, replace} from '../lib/dom.js';
import {weightOf} from '../profile/profile.js';
import {amount} from '../model/units.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {keepInterval} from '../last-file.js';
import {peaks, mountains, held as heldPeaks} from '../model/peaks.js';
import {callees} from '../model/callees.js';
import {terrain, anchorOf} from '../model/terrain.js';
import {peaksView} from '../views/peaks.js';
import {mapView} from '../views/map.js';
import {terrainView, closeTerrainView} from '../views/terrain3d.js';
import {crossfade} from '../components/crossfade.js';
import {leaveOut} from '../model/samples.js';
import {packageHues} from '../model/hues.js';
import {hueLegend} from '../components/hue-legend.js';
import {peakControls, peakSettings} from '../components/peak-controls.js';
import {advanced, tuning} from '../components/advanced.js';
import {anonymizeControls} from '../components/anonymizing.js';
import {timeline} from '../components/timeline.js';
import {span, checked} from '../model/timeline.js';
import {fileMenu} from '../components/file-menu.js';
import {folded, section} from '../components/form.js';
import {floating, keepView, remembered} from './page.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../load.js').Sampling} Sampling */

/** Whether the peaks of the whole recording are kept in focus, kept. */
const HOLD = 'mountaingraph.timeline.hold';

/** Which sampling of a file with several is shown, kept. */
const SAMPLING = 'mountaingraph.sampling';

/**
 * Shows the samples of a file, in the sampling chosen last.
 *
 * @param {import('./page.js').Page} page
 * @param {string} name of the file
 * @param {Sampling[]} samplings
 * @param {any} [saved] an interval of the recording to focus on, as kept: checked here
 */
export function showSamples(page, name, samplings, saved = null) {
  const wanted = samplings.findIndex(s => s.key === readSetting(SAMPLING));
  display(page, name, samplings, Math.max(0, wanted), saved);
}

/**
 * Shows one sampling of a file.
 *
 * @param {import('./page.js').Page} page
 * @param {string} name of the file
 * @param {Sampling[]} samplings
 * @param {number} which the one shown
 * @param {any} saved an interval of the recording to focus on, as kept: checked here
 */
function display(page, name, samplings, which, saved) {
  const {main, bar, strip} = page;
  page.relayout = () => {};
  main.classList.remove('stage');
  replace(strip);
  strip.hidden = true;
  try {
    const p = samplings[which].profile;
    const map = h('div', {class: 'stage-view'}), table = h('div', {class: 'table-body'});
    // as left when the page was last closed: the rows unfolded, the peak chosen, the 3D camera
    const kept0 = remembered();
    /** @type {Set<string>} */
    const unfolded = new Set(kept0.open);
    /** @type {import('../components/terrain-frame.js').Selection} */
    const selection = {chosen: kept0.chosen, tab: kept0.tab, unit: p.unit};
    /** @type {import('../views/terrain3d.js').Viewpoint} the 3D view's camera, kept as settings change */
    const viewpoint = kept0.viewpoint;
    page.remember = () => keepView({open: [...unfolded], chosen: selection.chosen, tab: selection.tab, viewpoint});
    /** @type {{waits: string, kept: Profile, left: number} | null} the samples kept, while waits is the same */
    let kept = null;
    /** @type {import('../model/timeline.js').Interval | null} the part of the recording in focus, none for all */
    let focus = checked(saved, span(p));
    let hold = readSetting(HOLD) === 'true';
    /** @type {{key: string, peaks: import('../model/peaks.js').Peak[], anchor: import('../model/terrain.js').Anchor} | null}
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
        page.relayout();
      },
      holding: hold,
      hold: on => {
        hold = on;
        writeSetting(HOLD, String(on));
        page.relayout();
      },
      initial: focus,
      operation: name => {
        operation = name;
        page.relayout();
      },
    }) : null;
    if (stripped) {
      replace(strip, stripped.element);
      strip.hidden = false;
    }
    // the view fills the window under the bar: there first, to take its shape from
    replace(bar, ...summary(name, p), samplingChoice(samplings, which, to => {
      writeSetting(SAMPLING, samplings[to].key);
      page.remember();
      display(page, name, samplings, to, focus);
    }));
    main.classList.add('stage');
    let tuned = tuning();
    // the 3D view's own controls, which it puts there as it is built
    const relief = h('div', {class: 'settings-rows'});
    const terrain3d = section('3D view', relief);
    const knobs = advanced(t => {
      tuned = t;
      page.relayout();
    });
    replace(main, map, h('div', {class: 'floats'}, floating('Peaks', 'table', table)));
    /** @param {import('../components/peak-controls.js').PeakSettings} settings */
    const show = settings => {
      last = settings;
      const {grain, count, coverage, waits, hide, java, shape, view, colour} = settings;
      knobs.fit({shape, view});
      terrain3d.hidden = view !== '3d';
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
      /** @type {import('../model/terrain.js').Anchor | undefined} */
      let anchor;
      /** @type {import('../model/peaks.js').Peaks} */
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
        crossfade(map, shown => terrainView(t, trees, selection, viewpoint, hues, tuned, shown, relief), ...legend ? [legend] : []);
      else {
        closeTerrainView();
        replace(map, mapView(t, trees, selection, viewpoint, hues), legend);
      }
      replace(table, peaksView(r, m, unfolded, kept.left, p.unit));
    };
    /** @type {import('../components/peak-controls.js').PeakSettings | null} */
    let last = null;
    const controls = peakControls(peakSettings(), show);
    replace(page.tools, controls.view);
    replace(page.settings, controls.settings, terrain3d, folded('Fine tuning', knobs.element),
            folded('Anonymizing', anonymizeControls(() => page.reopen())));
    // laid out again in the window's shape, the bar in place, and as it is resized
    page.relayout = () => last && show(last);
    page.relayout();
  }
  catch (e) {
    replace(main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/**
 * @param {Sampling[]} samplings
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
  return h('label', {class: 'sampling', title: 'What the samples count'}, select);
}

/**
 * @param {string} name of the file
 * @param {Profile} p
 * @returns {HTMLElement[]} its name and what it holds, for the header
 */
function summary(name, p) {
  let ms = 0;
  for (let i = 0; i < p.kind.length; i++)
    if (p.stack[i] >= 0)
      ms += weightOf(p, i);
  const brief = p.start
    ? `${p.kind.length.toLocaleString()} samples, ${(p.end / 1e9).toFixed(1)} s`
    : `${p.kind.length.toLocaleString()} stacks, ${amount(ms, p.unit)}`;
  return fileMenu(name, brief,
    h('p', null, p.start
      ? `${p.kind.length.toLocaleString()} samples (${amount(ms, p.unit)} with a stack), `
        + `${p.parent.length.toLocaleString()} stack nodes, ${p.threads.length} threads, `
        + `${p.operations.count.toLocaleString()} operations, recorded from ${p.start} `
        + `for ${(p.end / 1e9).toFixed(1)} s.`
      : `Collapsed stacks: ${p.kind.length.toLocaleString()} distinct, ${amount(ms, p.unit)}, `
        + `${p.parent.length.toLocaleString()} stack nodes.`));
}
