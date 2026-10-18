// @ts-check
/**
 * The page: a profile picked or dropped, then what it holds. The views to
 * come (peaks, map, terrain) each get their own module under views/.
 */
import {$, h, replace} from './lib/dom.js';
import {loadProfile} from './load.js';
import {peaks} from './model/peaks.js';
import {peaksView} from './views/peaks.js';
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
    const table = h('div');
    const controls = peakControls(peakSettings(), ({count, coverage, hide}) =>
      replace(table, peaksView(peaks(p, {all: true, hide}, {count, coverage}))));
    replace(main, summary(file.name, p), controls, table);
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
