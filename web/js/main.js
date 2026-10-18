// @ts-check
/**
 * The page: a profile picked or dropped, then its peaks, as a map of their
 * mountains and as a table. Each view has its own module under views/.
 */
import {$, h, replace} from './lib/dom.js';
import {loadProfile} from './load.js';
import {peaks, mountains} from './model/peaks.js';
import {massif} from './model/terrain.js';
import {peaksView} from './views/peaks.js';
import {mapView, HEIGHT, PANEL} from './views/map.js';
import {leaveOut} from './model/samples.js';
import {peakControls, peakSettings} from './components/peak-controls.js';

/** @typedef {import('./profile/profile.js').Profile} Profile */

const main = $('main', HTMLElement);
const picker = $('picker', HTMLInputElement);

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

/** @param {File} file */
async function open(file) {
  replace(main, h('p', {class: 'muted'}, `Reading ${file.name}…`));
  try {
    const p = await loadProfile(file);
    const map = h('div'), table = h('div');
    /** @type {Set<string>} */
    const open = new Set();
    const selection = {chosen: ''};
    /** @type {{waits: string, kept: Profile, left: number} | null} the samples kept, while waits is the same */
    let kept = null;
    const controls = peakControls(peakSettings(), ({grain, count, coverage, waits, hide, java}) => {
      if (kept?.waits !== waits) {
        const {profile, left} = leaveOut(p, waits);
        kept = {waits, kept: profile, left};
      }
      const q = kept.kept;
      const filter = {all: true, hide, java};
      const r = peaks(q, filter, {count, coverage, grain});
      const m = mountains(q, filter, r.peaks, grain);
      // as wide as the page allows, less the callers beside it: the mountains spread in its shape
      const width = main.clientWidth - 32 - (selection.chosen ? PANEL : 0);
      const aspect = Math.max(1, width / (HEIGHT * innerHeight));
      const trees = r.peaks.flatMap(peak => m.get(peak.name) ?? []);
      replace(map, mapView(massif(trees, 600, aspect), trees, selection));
      replace(table, peaksView(r, m, open, kept.left));
    });
    replace(main, summary(file.name, p), controls, map, table);
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
      ms += p.weights[p.kind[i]];
  return h('section', null,
    h('h2', null, name),
    h('p', null,
      `${p.kind.length.toLocaleString()} samples (${Math.round(ms).toLocaleString()} ms with a stack), `
      + `${p.parent.length.toLocaleString()} stack nodes, ${p.threads.length} threads, `
      + `${p.operations.count.toLocaleString()} operations, recorded from ${p.start} `
      + `for ${(p.end / 1e9).toFixed(1)} s.`));
}
