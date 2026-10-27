// @ts-check
/**
 * "Save with loss…" in a heap's file menu: the profile reduced to what the page draws, a file small
 * enough for a gallery or a report. The level of loss is chosen, and the size it gives said before
 * the file is saved.
 */
import {h} from '../lib/dom.js';
import {bytes} from '../lib/format.js';
import {encode} from '../profile/heap.js';
import {reduce, reducedDocument, LEVELS, LEVEL_TEXT, DEFAULT_LEVEL} from '../model/reduce.js';
import {gzip} from '../gzip.js';
import {saveFile, savedName} from '../save-file.js';

/** @typedef {import('../profile/heap.js').HeapProfile} HeapProfile */

/**
 * @param {string} name of the file the page opened
 * @param {HeapProfile} p
 * @param {object} [beside] what the original keeps beside the profile, which the reduced file keeps too
 * @returns {HTMLElement}
 */
export function saveReduced(name, p, beside = {}) {
  /** @type {Map<number, Promise<{nodes: number, file: Uint8Array<ArrayBuffer>}>>} */
  const made = new Map();
  /** @param {number} level */
  const make = level => {
    let done = made.get(level);
    if (!done)
      made.set(level, done = reduced(p, level, beside));
    return done;
  };
  /** @type {Promise<number> | undefined} */
  let whole;

  const select = h('select', null, LEVELS.map((_, i) =>
    h('option', {value: i, selected: i === DEFAULT_LEVEL}, LEVEL_TEXT[i].name)));
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
      whole ??= gzip(JSON.stringify({...encode(p), ...beside})).then(g => g.length);
      const full = await whole;
      if (Number(select.value) !== level)
        return;
      chosen = r;
      result.textContent = `${p.parent.length.toLocaleString()} nodes become ${r.nodes.toLocaleString()}: `
        + `${bytes(r.file.length)} gzipped, against ${bytes(full)} for the whole profile. `
        + LEVEL_TEXT[level].about[0].toUpperCase() + LEVEL_TEXT[level].about.slice(1) + '.';
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
    h('summary', {title: 'A Flamepack of what the page draws, much smaller, for a gallery or a report'},
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
 * @param {HeapProfile} p
 * @param {number} level of LEVELS
 * @param {object} beside
 * @returns {Promise<{nodes: number, file: Uint8Array<ArrayBuffer>}>} the reduced profile, gzipped as saved
 */
async function reduced(p, level, beside) {
  // let the page say it is working before the walk of the paths starts: it holds the thread
  await new Promise(resolve => setTimeout(resolve, 0));
  const loss = LEVELS[level];
  const profile = reduce(p, loss);
  return {nodes: profile.parent.length, file: await gzip(JSON.stringify(reducedDocument(profile, loss, beside)))};
}
