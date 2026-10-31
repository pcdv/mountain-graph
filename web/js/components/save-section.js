// @ts-check
/**
 * "Save" in a file menu: the profile as a Flamepack, whole or reduced to what matters (a file small enough
 * for a gallery or a report), with or without how the view is set, gzipped or not, under a name that can be
 * changed, and with the tour of the file when it has one (tour.js). A heap keeps what the page draws (model/reduce.js), samples the stacks of the methods that take
 * time (model/thin.js). The level of loss is chosen, and the size it gives said before the file is saved.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {bytes} from '../lib/format.js';
import {encode} from '../profile/heap.js';
import {encodeSamples} from '../profile/encode.js';
import {reduce, reducedDocument, LEVELS, LEVEL_TEXT} from '../model/reduce.js';
import * as thinning from '../model/thin.js';
import {shown, leavesOut} from '../model/shown.js';
import {gzip} from '../gzip.js';
import {saveFile, savedName} from '../save-file.js';
import {withView} from './with-view.js';
import {withTour} from './tour.js';
import {MEMBER} from '../view-state.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */
/** @typedef {import('../profile/profile.js').Profile} Profile */

/**
 * A profile reduced.
 *
 * @typedef {object} Made
 * @property {number} nodes in the reduced profile
 * @property {Uint8Array<ArrayBuffer>} file the document, gzipped as saved without settings
 * @property {any} doc the document, to which the settings of the view are added when they are kept
 */

/** The settings of the view that saving only what is shown has already applied to the profile. */
const ALREADY_APPLIED = ['mountaingraph.peaks.waits', 'mountaingraph.peaks.hide', 'mountaingraph.peaks.java'];

/** What the choice of loss is when nothing is lost. */
const NONE = 'none';

/** Whether the file is gzipped, kept: it is unless unchecked. */
const GZIP = 'mountaingraph.export.gzip';

/**
 * How a kind of profile is reduced.
 *
 * @typedef {object} Reduction
 * @property {{name: string, about: string}[]} levels what each level is called and says: none for a profile
 *           that cannot be reduced
 * @property {(level: number, shownOnly?: boolean) => object} reduced the document reduced at a level, of what the
 *           view shows only when asked to
 * @property {() => object} whole the document of the whole profile
 * @property {() => import('../model/shown.js').View | null} [view] what the settings of the view keep, when the
 *           reduction can save only that: none before the view is drawn
 */

/**
 * @param {HeapProfile} p a heap's profile
 * @param {object} [beside] what the original keeps beside the profile, which the reduced file keeps too
 * @returns {Reduction}
 */
export function heapReduction(p, beside = {}) {
  return {
    levels: LEVEL_TEXT,
    reduced: level => reducedDocument(reduce(p, LEVELS[level]), LEVELS[level], beside),
    whole: () => ({...encode(p), ...beside}),
  };
}

/**
 * @param {Profile} p a profile of samples
 * @param {object} [meta] what the document says of itself
 * @param {() => import('../model/shown.js').View | null} [view] what the settings of the view keep: the
 *        reduction can then be of that only
 * @returns {Reduction}
 */
export function samplesReduction(p, meta = {}, view) {
  return {
    levels: thinning.LEVEL_TEXT,
    reduced: (level, shownOnly = false) => {
      const kept = shownOnly ? view?.() : null;
      return {...encodeSamples(thinning.thin(kept ? shown(p, kept) : p, thinning.LEVELS[level]), meta),
              reduced: thinning.LEVELS[level]};
    },
    whole: () => encodeSamples(p, meta),
    view,
  };
}

/**
 * @param {string} name of the file the page opened
 * @param {Profile} p
 * @param {Reduction} how
 * @param {() => Record<string, string>} settings how the view is set now, which the file can keep
 * @returns {HTMLElement} one choice of how much to lose, what else to keep, and one button
 */
export function saveSection(name, p, how, settings) {
  const kept = withView(settings);
  const tour = withTour();
  /** @returns {object} what to add to the document: the page's member, with the settings and the tour asked for */
  const members = () => {
    const member = {.../** @type {any} */ (kept.members())[MEMBER], ...tour.members()};
    return Object.keys(member).length ? {[MEMBER]: member} : {};
  };
  // a reduction that can save only what is shown has a choice of it, off at first: the settings of the view are
  // read each time, as they may have changed since the menu was last open
  const only = how.view ? h('input', {type: 'checkbox'}) : null;
  /** @returns {number | null} the level of loss chosen, none for the whole profile */
  const level = () => select.value === NONE ? null : Number(select.value);
  /** @returns {import('../model/shown.js').View | null} what the settings keep, when it is asked for */
  const view = () => level() !== null && only?.checked ? how.view?.() ?? null : null;

  /** @type {Map<string, Promise<Made>>} */
  const made = new Map();
  /**
   * @param {number} at the level
   * @param {boolean} shownOnly
   */
  const make = (at, shownOnly) => {
    const key = `${at}:${shownOnly ? JSON.stringify(view()) : ''}`;
    let done = made.get(key);
    if (!done)
      made.set(key, done = reduced(how, at, shownOnly));
    return done;
  };
  /** @type {Promise<number> | undefined} */
  let whole;

  const select = h('select', {'aria-label': 'What to save',
                              title: 'A file much smaller, for a gallery or a report, loses the detail that matters least'},
    h('option', {value: NONE, selected: true}, 'All data'),
    how.levels.map((l, i) => h('option', {value: i}, l.name)));
  select.value = NONE;
  const result = h('p', {class: 'muted'}, '');
  const save = h('button', {type: 'button', class: 'button primary'}, 'Save');
  const gzipped = h('input', {type: 'checkbox'});
  gzipped.checked = readSetting(GZIP) !== 'false';
  const file = h('input', {type: 'text', class: 'save-name', spellcheck: 'false', 'aria-label': 'File name',
                           title: 'The name of the file saved: its ending follows the loss and the gzip chosen'});
  file.value = savedName(name, '');
  // the ending follows the loss and the gzip; the rest of the name is as typed
  const rename = () => {
    const stem = file.value.trim().replace(/(-reduced)?\.fpk(\.gz)?$/i, '') || savedName(name, '');
    file.value = `${stem}${level() === null ? '' : '-reduced'}.fpk${gzipped.checked ? '.gz' : ''}`;
  };
  rename();
  gzipped.addEventListener('change', () => {
    writeSetting(GZIP, String(gzipped.checked));
    rename();
  });
  /** @type {Made | null} */
  let chosen = null;

  const show = async () => {
    const at = level();
    chosen = null;
    rename();
    if (only)
      only.disabled = at === null;
    if (at === null) {
      result.textContent = 'The whole profile, as a Flamepack.';
      save.disabled = false;
      return;
    }
    save.disabled = true;
    result.textContent = 'Reducing…';
    const shownOnly = view() !== null;
    try {
      const r = await make(at, shownOnly);
      whole ??= gzip(JSON.stringify(how.whole())).then(g => g.length);
      const full = await whole;
      if (level() !== at || (view() !== null) !== shownOnly)
        return;
      chosen = r;
      const about = how.levels[at].about;
      const left = shownOnly ? leavesOut(/** @type {import('../model/shown.js').View} */ (view())) : [];
      result.textContent = (!shownOnly ? '' : left.length ? `Without ${left.join(', ')}. ` : 'The settings leave nothing out. ')
        + `${p.parent.length.toLocaleString()} nodes become ${r.nodes.toLocaleString()}: `
        + `${bytes(r.file.length)} gzipped, against ${bytes(full)} for the whole profile. `
        + about[0].toUpperCase() + about.slice(1) + '.';
      save.disabled = false;
    }
    catch (e) {
      result.textContent = `Could not reduce it: ${/** @type {Error} */ (e).message}`;
    }
  };
  select.addEventListener('input', show);
  only?.addEventListener('change', show);
  save.addEventListener('click', async () => {
    const at = level();
    if (at !== null && !chosen)
      return;
    const added = members();
    if (at !== null && Object.keys(added).length > 0 && view() !== null) {
      // what the view leaves out is already out of the profile: its settings would only say what was
      const set = /** @type {Record<string, string>} */ (/** @type {any} */ (added)[MEMBER]);
      for (const key of ALREADY_APPLIED)
        delete set[key];
    }
    rename();
    const named = file.value;
    // a reduced profile is gzipped already, when nothing is added to it
    const ready = at !== null && chosen && Object.keys(added).length === 0 && gzipped.checked ? chosen.file : null;
    const json = ready ? '' : JSON.stringify({...at === null ? how.whole() : chosen?.doc, ...added});
    const body = ready ?? (gzipped.checked ? await gzip(json) : json);
    saveFile(named, new Blob([body], {type: gzipped.checked ? 'application/gzip' : 'application/json'}));
  });

  const section = h('section', {class: 'save-section'},
    h('h3', null, 'Save'),
    h('div', {class: 'save-row'}, select, save),
    file,
    h('div', {class: 'save-checks'},
      ...only ? [h('label', {class: 'check',
                             title: 'Leaves out what the settings of the view leave out: the waits, the hidden frames, '
                               + 'the native samples when only Java is shown, and what is outside the interval or '
                               + 'the operation in focus'},
                   only, 'Only what is shown')] : [],
      kept.element,
      tour.element,
      h('label', {class: 'check', title: 'Compresses the file: much smaller, and opened as it is'},
        gzipped, 'Gzipped')),
    result);
  // the menu is opened again: the settings may have changed since, and what is shown is worked out again
  section.addEventListener('menuopen', () => {
    tour.fit();
    if (level() === null || !chosen || view() !== null)
      show();
  });
  show();
  return section;
}

/**
 * @param {Reduction} how
 * @param {number} level
 * @param {boolean} shownOnly
 * @returns {Promise<Made>} the reduced profile, gzipped as saved
 */
async function reduced(how, level, shownOnly) {
  // let the page say it is working before the reduction starts: it holds the thread
  await new Promise(resolve => setTimeout(resolve, 0));
  const doc = /** @type {any} */ (how.reduced(level, shownOnly));
  return {nodes: doc.stacks.depth.length, file: await gzip(JSON.stringify(doc)), doc};
}
