// @ts-check
/**
 * "Save with loss…" in a file menu: the profile reduced to what matters, a file small enough for a
 * gallery or a report. A heap keeps what the page draws (model/reduce.js), samples the stacks of the
 * methods that take time (model/thin.js). The level of loss is chosen, and the size it gives said
 * before the file is saved.
 */
import {h} from '../lib/dom.js';
import {bytes} from '../lib/format.js';
import {encode} from '../profile/heap.js';
import {encodeSamples} from '../profile/encode.js';
import {reduce, reducedDocument, LEVELS, LEVEL_TEXT, DEFAULT_LEVEL} from '../model/reduce.js';
import * as thinning from '../model/thin.js';
import {gzip} from '../gzip.js';
import {saveFile, savedName} from '../save-file.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */
/** @typedef {import('../profile/profile.js').Profile} Profile */

/**
 * How a kind of profile is reduced.
 *
 * @typedef {object} Reduction
 * @property {{name: string, about: string}[]} levels what each level is called and says
 * @property {number} proposed the level chosen first
 * @property {(level: number) => object} reduced the document reduced at a level
 * @property {() => object} whole the document of the whole profile
 */

/**
 * @param {HeapProfile} p a heap's profile
 * @param {object} [beside] what the original keeps beside the profile, which the reduced file keeps too
 * @returns {Reduction}
 */
export function heapReduction(p, beside = {}) {
  return {
    levels: LEVEL_TEXT,
    proposed: DEFAULT_LEVEL,
    reduced: level => reducedDocument(reduce(p, LEVELS[level]), LEVELS[level], beside),
    whole: () => ({...encode(p), ...beside}),
  };
}

/**
 * @param {Profile} p a profile of samples
 * @param {object} [meta] what the document says of itself
 * @returns {Reduction}
 */
export function samplesReduction(p, meta = {}) {
  return {
    levels: thinning.LEVEL_TEXT,
    proposed: thinning.DEFAULT_LEVEL,
    reduced: level => ({...encodeSamples(thinning.thin(p, thinning.LEVELS[level]), meta),
                        reduced: thinning.LEVELS[level]}),
    whole: () => encodeSamples(p, meta),
  };
}

/**
 * @param {string} name of the file the page opened
 * @param {Profile} p
 * @param {object} [beside] for a heap, what the original keeps beside the profile, which the reduced
 *        file keeps too
 * @param {Reduction} [how] a heap's by default
 * @returns {HTMLElement}
 */
export function saveReduced(name, p, beside = {}, how = heapReduction(p, beside)) {
  /** @type {Map<number, Promise<{nodes: number, file: Uint8Array<ArrayBuffer>}>>} */
  const made = new Map();
  /** @param {number} level */
  const make = level => {
    let done = made.get(level);
    if (!done)
      made.set(level, done = reduced(how, level));
    return done;
  };
  /** @type {Promise<number> | undefined} */
  let whole;

  const select = h('select', null, how.levels.map((level, i) =>
    h('option', {value: i, selected: i === how.proposed}, level.name)));
  const result = h('p', {class: 'muted'}, '');
  const save = h('button', {type: 'button', class: 'button primary', disabled: true}, 'Save');
  /** @type {{nodes: number, file: Uint8Array<ArrayBuffer>} | null} */
  let chosen = null;

  const show = async () => {
    const level = Number(select.value);
    chosen = null;
    save.disabled = true;
    result.textContent = 'Reducing…';
    try {
      const r = await make(level);
      whole ??= gzip(JSON.stringify(how.whole())).then(g => g.length);
      const full = await whole;
      if (Number(select.value) !== level)
        return;
      chosen = r;
      const about = how.levels[level].about;
      result.textContent = `${p.parent.length.toLocaleString()} nodes become ${r.nodes.toLocaleString()}: `
        + `${bytes(r.file.length)} gzipped, against ${bytes(full)} for the whole profile. `
        + about[0].toUpperCase() + about.slice(1) + '.';
      save.disabled = false;
    }
    catch (e) {
      result.textContent = `Could not reduce it: ${/** @type {Error} */ (e).message}`;
    }
  };
  select.addEventListener('input', show);
  save.addEventListener('click', () => {
    if (chosen)
      saveFile(savedName(name, '-reduced.fpk.gz'), new Blob([chosen.file], {type: 'application/gzip'}));
  });

  const details = h('details', {class: 'save-reduced'},
    h('summary', {title: 'A Flamepack of what matters, much smaller, for a gallery or a report'},
      'Save with loss…'),
    h('label', {class: 'field'}, h('span', {class: 'field-label'}, 'Loss'), select),
    result,
    h('div', {class: 'actions'}, save));
  details.addEventListener('toggle', () => {
    if (/** @type {HTMLDetailsElement} */ (details).open && !chosen)
      show();
  });
  return details;
}

/**
 * @param {Reduction} how
 * @param {number} level
 * @returns {Promise<{nodes: number, file: Uint8Array<ArrayBuffer>}>} the reduced profile, gzipped as saved
 */
async function reduced(how, level) {
  // let the page say it is working before the reduction starts: it holds the thread
  await new Promise(resolve => setTimeout(resolve, 0));
  const doc = /** @type {any} */ (how.reduced(level));
  return {nodes: doc.stacks.depth.length, file: await gzip(JSON.stringify(doc))};
}
