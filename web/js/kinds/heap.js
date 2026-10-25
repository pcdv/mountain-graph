// @ts-check
/**
 * The view of a heap: the objects that hold the most memory as peaks, the
 * references that lead to them as their slopes; the panel of a peak says what
 * it holds and who holds it, and walks the object graph either way. The
 * parse's report is in the file's menu.
 */
import {h, replace} from '../lib/dom.js';
import {bytes} from '../lib/format.js';
import {forgetFile} from '../last-file.js';
import {encode, stacksToProfile, stacksOf} from '../profile/heap.js';
import {peaks, mountains} from '../model/peaks.js';
import {terrain} from '../model/terrain.js';
import {peaksView} from '../views/peaks.js';
import {mapView} from '../views/map.js';
import {terrainView, closeTerrainView} from '../views/terrain3d.js';
import {crossfade} from '../components/crossfade.js';
import {packageHues} from '../model/hues.js';
import {hueLegend} from '../components/hue-legend.js';
import {heapControls, heapSettings} from '../components/heap-controls.js';
import {advanced, tuning} from '../components/advanced.js';
import {anonymizeControls} from '../components/anonymizing.js';
import {parseReport} from '../components/parse-report.js';
import {contextStacks} from '../model/context.js';
import {ownershipPeaks, mountainsOf, holdersOf, holdsOf, THIN} from '../model/ownership.js';
import {fileMenu} from '../components/file-menu.js';
import {folded} from '../components/form.js';
import {floating, keepView, remembered} from './page.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */
/** @typedef {import('../hprof/dump.js').HeapStats} HeapStats */

/**
 * Shows a heap.
 *
 * @param {import('./page.js').Page} page
 * @param {string} name of the file
 * @param {import('../hprof/dump.js').Heap} heap
 * @param {boolean} [restored] its parse was kept from the last time the page was open, not made now
 */
export function showHeap(page, name, {profile: p, stats}, restored = false) {
  const {main, bar, strip} = page;
  page.relayout = () => {};
  main.classList.remove('stage');
  replace(strip);
  strip.hidden = true;
  try {
    // path → bytes, root first, object last: what the context setting gathers
    const stacks = stacksOf(p);
    const map = h('div', {class: 'stage-view'}), table = h('div', {class: 'table-body'});
    const kept0 = remembered();
    /** @type {Set<string>} */
    const unfolded = new Set(kept0.open);
    /** @type {import('../components/terrain-frame.js').Selection} */
    const selection = {chosen: kept0.chosen, tab: kept0.tab, unit: /** @type {const} */ ('bytes')};
    /** @type {import('../views/terrain3d.js').Viewpoint} */
    const viewpoint = kept0.viewpoint;
    page.remember = () => keepView({open: [...unfolded], chosen: selection.chosen, tab: selection.tab, viewpoint});

    replace(bar, ...summary(name, p, stats, restored));
    main.classList.add('stage');
    let tuned = tuning();
    const knobs = advanced(t => {
      tuned = t;
      page.relayout();
    });
    replace(main, map, h('div', {class: 'floats'}, floating('Peaks', 'table', table)));

    // the profiles of the context setting, made once each, not on each setting
    // or resize: the walk of the paths is the slow part of a redraw
    /** @type {Map<number, import('../profile/profile.js').Profile>} */
    const byContext = new Map();

    /** @param {import('../components/heap-controls.js').HeapSettings} settings */
    const show = settings => {
      last = settings;
      const {basis, wrappers, grain, count, coverage, shape, view, colour, context} = settings;
      knobs.fit({shape, view});

      // no filter for a heap: no operations, no threads, no time
      const filter = {all: true};
      const aspect = Math.max(1, main.clientWidth / Math.max(1, main.clientHeight));

      // what the chains of holders retain, or the objects at the top of a stack
      let r, m;
      /** @type {import('../model/peaks.js').Grain} */
      let by = 'method';
      selection.nodes = undefined;
      selection.holdsAt = undefined;
      selection.heldByAt = undefined;
      if (basis === 'owned') {
        r = ownershipPeaks(p, {count, coverage, thin: wrappers === 'skip' ? THIN : 0});
        m = mountainsOf(p, r.peaks);
        // the panel walks the object graph: what an object holds, and who holds it
        selection.nodes = r.peaks.map(peak => peak.node);
        selection.holdsAt = node => holdsOf(p, node);
        selection.heldByAt = node => holdersOf(p, node);
      }
      else {
        // a context label is one frame: the class and its holders, gathered
        by = context > 1 ? 'method' : grain;
        let gathered = byContext.get(context);
        if (!gathered)
          byContext.set(context, gathered = stacksToProfile(contextStacks(stacks, context)));
        r = peaks(gathered, filter, {count, coverage, grain: by});
        m = mountains(gathered, filter, r.peaks, by);
      }
      selection.holds = basis === 'owned';
      const trees = r.peaks.flatMap(peak => m.get(peak.name) ?? []);
      const t = terrain(trees, {shape, aspect, tuning: tuned});
      const coloured = colour === 'package' && basis === 'shallow' && context === 1 ? packageHues(t, by) : null;
      const hues = coloured?.hues ?? null;
      const legend = coloured ? hueLegend(coloured.legend) : null;

      if (view === '3d')
        crossfade(map, shown => terrainView(t, trees, selection, viewpoint, hues, tuned, shown), ...legend ? [legend] : []);
      else {
        closeTerrainView();
        replace(map, mapView(t, trees, selection, hues), legend);
      }
      replace(table, peaksView(r, m, unfolded, 0, 'bytes'));
    };

    /** @type {import('../components/heap-controls.js').HeapSettings | null} */
    let last = null;
    const controls = heapControls(heapSettings(), show);
    replace(page.tools, controls.view);
    replace(page.settings, controls.settings, folded('Fine tuning', knobs.element),
            folded('Anonymizing', anonymizeControls(() => page.reopen())));
    page.relayout = () => last && show(last);
    page.relayout();
  }
  catch (e) {
    replace(main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/**
 * Downloads the full paths as a profile JSON: the context setting is not
 * applied, so nothing is lost before the file is read elsewhere.
 *
 * @param {string} name of the heap dump
 * @param {HeapProfile} p
 */
function download(name, p) {
  const doc = encode(p);
  const blob = new Blob([JSON.stringify(doc)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = h('a', {href: url, download: `${name.replace(/(\.jheap)?\.(hprof|json)(\.gz)?$/i, '')}.profile.json`});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {string} name of the file
 * @param {HeapProfile} p
 * @param {HeapStats} stats
 * @param {boolean} restored
 * @returns {HTMLElement[]} its name and what it holds, for the header; its menu, with its export and the
 *          parse's report
 */
function summary(name, p, stats, restored) {
  const unreachable = stats.totalSize > 0 ? Math.round(100 * stats.unreachableSize / stats.totalSize) : 0;
  // a profile saved without its parse's report has none to show
  const report = stats.report;
  return fileMenu(name, `${stats.objectCount.toLocaleString()} objects, ${bytes(stats.totalSize)}`,
    h('p', null,
      `${stats.objectCount.toLocaleString()} objects, ${stats.classCount.toLocaleString()} classes, `
      + `${bytes(stats.totalSize)} total`
      + (stats.unreachableSize > 0 ? ` (${bytes(stats.unreachableSize)} unreachable, ${unreachable}%)` : '')
      + '.'),
    restored ? h('p', {class: 'muted'}, 'Its parse is kept in the browser: open the dump again to parse it again.') : null,
    h('div', {class: 'actions'},
      h('button', {type: 'button', class: 'button',
        title: 'Download every path as a profile JSON, the format jfr-web reads',
        onclick: () => download(name, p)}, 'Export JSON'),
      restored ? h('button', {type: 'button', class: 'button',
        title: 'Drops the parse kept in the browser: the page starts empty next time',
        onclick: () => forgetFile().then(() => location.reload())}, 'Forget the parse') : null),
    report ? h('h3', null, 'Parse report') : null,
    report ? parseReport(report) : null);
}
