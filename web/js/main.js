// @ts-check
/**
 * The page: a file picked or dropped, then the view of its kind (kinds/):
 * samples as the methods where the time goes, a heap as the objects that hold
 * the memory. Each a map of mountains filling the window under the header,
 * with a table of the peaks floating over it and its settings in a pane
 * docked beside it.
 */
import {$, h, replace} from './lib/dom.js';
import {loadFile, loadParse} from './load.js';
import {stopParsing} from './hprof/dump.js';
import {keepFile, lastFile, lastInterval, forgetFile} from './last-file.js';
import {landing} from './landing.js';
import {anonymizing} from './components/anonymizing.js';
import {screenshotKeys} from './components/screenshot.js';
import {installHelp} from './components/help.js';
import {settingsPane} from './components/settings-pane.js';
import {showSamples} from './kinds/samples.js';
import {showHeap} from './kinds/heap.js';

/** @typedef {import('./load.js').Parse} Parse */

const picker = $('picker', HTMLInputElement);
const closeButton = $('close', HTMLButtonElement);
const progress = $('progress', HTMLElement);
const progressText = /** @type {HTMLElement} */ (progress.querySelector('.progress-text'));
const progressFill = /** @type {HTMLElement} */ (progress.querySelector('.progress-fill'));

/** @type {import('./kinds/page.js').Page} */
const page = {
  main: $('main', HTMLElement),
  bar: $('bar', HTMLElement),
  tools: $('tools', HTMLElement),
  settings: $('settings-body', HTMLElement),
  strip: $('timeline', HTMLElement),
  relayout: () => {},
  remember: () => {},
  reopen: () => current && (current instanceof File ? open(current, true) : openParse(current)),
};

closeButton.addEventListener('click', close);
settingsPane($('settings', HTMLElement), $('settings-toggle', HTMLButtonElement), () => page.relayout());
show(landing());

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

addEventListener('pagehide', () => page.remember());
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && page.remember());

/** @type {number | undefined} */
let resizing;
addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => page.relayout(), 300);
});

/**
 * @type {File | Parse | null} what is shown, to show again when the anonymizing settings change: a
 *       dump's parse rather than the dump, which would be parsed again
 */
let current = null;

/** Set once a file is opened: the one kept last is then not worth showing. */
let opening = false;

/**
 * @param {File} file
 * @param {boolean} [again] the file kept last, opened again: its interval in focus comes back with it
 */
async function open(file, again = false) {
  opening = true;
  // a dump parsing for the file shown before is not worth finishing
  stopParsing();
  current = file;
  clear(`Reading ${file.name}…`);
  try {
    const loaded = await loadFile(file, {anonymous: anonymizing(), onProgress: showProgress});
    progress.hidden = true;
    // closed, or another file opened, while this one was read
    if (current !== file)
      return;
    if (loaded.kind === 'heap') {
      // a dump's parse is kept, not the dump: parsing it again takes as long as the first time
      if (loaded.parse)
        current = loaded.parse;
      if (!again)
        keepFile(loaded.parse ?? file);
      showHeap(page, file.name, loaded.heap);
    }
    else {
      const focus = again ? await lastInterval() : null;
      if (!again)
        keepFile(file);
      showSamples(page, file.name, loaded.samplings, focus);
    }
  }
  catch (e) {
    // a parse stopped for another file: that one is shown
    if (e instanceof DOMException && e.name === 'AbortError')
      return;
    progress.hidden = true;
    replace(page.main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/**
 * Shows the parse kept of a dump, without parsing it.
 *
 * @param {Parse} parse
 * @param {boolean} [restored] kept from the last time the page was open
 */
function openParse(parse, restored = false) {
  current = parse;
  clear(`Reading ${parse.name}…`);
  try {
    showHeap(page, parse.name, loadParse(parse, anonymizing()), restored);
  }
  catch (e) {
    // a parse kept by an earlier page that this one cannot read: forgotten, not shown broken at each reload
    if (restored)
      forgetFile();
    replace(page.main, h('p', {class: 'error'}, /** @type {Error} */ (e).message));
  }
}

/** @param {string} message what the page does, until it shows the file */
function clear(message) {
  show(h('p', {class: 'muted'}, message));
  closeButton.hidden = false;
}

/** @param {Node} content what the page shows in place of a view */
function show(content) {
  page.relayout = () => {};
  page.remember = () => {};
  page.main.classList.remove('stage');
  replace(page.bar);
  replace(page.tools);
  replace(page.settings);
  replace(page.strip);
  page.strip.hidden = true;
  replace(page.main, content);
}

/** Closes the graph: the page shows what it reads again, and does not reopen the file on reload. */
function close() {
  stopParsing();
  current = null;
  picker.value = '';
  progress.hidden = true;
  closeButton.hidden = true;
  show(landing());
  forgetFile();
}

/**
 * @param {string} phase
 * @param {number} percent
 */
function showProgress(phase, percent) {
  progress.hidden = false;
  progressText.textContent = `${phase}… ${percent}%`;
  progressFill.style.width = `${percent}%`;
}

// S saves a picture of the view, C copies it
installHelp($('help', HTMLElement));
screenshotKeys(() => (current?.name ?? 'mountain-graph').replace(/(\.\w+)?(\.gz)?$/, ''));

// the file opened last, shown again: a dump as its parse, a reload then being about the view, not the file
lastFile().then(kept => {
  if (!kept || opening)
    return;
  if (kept instanceof File)
    open(kept, true);
  else
    openParse(kept, true);
});
