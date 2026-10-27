// @ts-check
import {$, h} from './lib/dom.js';
import {segmented} from './components/form.js';

/**
 * A profile of the gallery (web/gallery/index.json).
 *
 * @typedef {object} GalleryEntry
 * @property {string} file in web/gallery/
 * @property {string} title
 * @property {string} description
 * @property {'time' | 'allocations' | 'memory'} kind
 */

/** @returns {Promise<GalleryEntry[]>} what the gallery holds: none when it cannot be read */
async function gallery() {
  try {
    const response = await fetch(new URL('../gallery/index.json', import.meta.url));
    return response.ok ? (await response.json()).profiles ?? [] : [];
  }
  catch (e) {
    return [];
  }
}

/**
 * @param {(entry: GalleryEntry) => void} open what to do with the profile chosen
 * @returns {HTMLElement} the page's gallery, filled once the index is read
 */
function galleryPage(open) {
  const cards = h('p', {class: 'muted'}, 'Reading the gallery…');
  const page = h('div', {class: 'landing', hidden: true},
    h('h2', null, 'Gallery'),
    h('p', {class: 'muted'}, 'Profiles to try, opened here in your browser like a file of your own.'),
    cards);
  gallery().then(entries => {
    if (!entries.length) {
      cards.textContent = 'The gallery could not be read.';
      return;
    }
    cards.replaceWith(...entries.map(entry => {
      const tint = entry.kind === 'memory' ? 'heap' : 'profiles';
      return h('button', {class: `kind gallery ${tint}`, type: 'button', onclick: () => open(entry)},
        h('h3', null, entry.title, ' ', h('span', {class: `chip ${tint}`}, entry.kind)),
        h('p', null, entry.description));
    }));
  });
  return page;
}

/**
 * What the page shows while no file is open: two pages under a choice, the template of index.html (what the
 * page reads) and the gallery. The address says which, so that the gallery has a link of its own.
 *
 * @param {(entry: GalleryEntry) => void} open what to do with the profile chosen
 * @returns {Node}
 */
export function landing(open) {
  const reading = /** @type {HTMLElement} */ (
    /** @type {DocumentFragment} */ ($('landing', HTMLTemplateElement).content.cloneNode(true)).firstElementChild);
  const gallerySection = galleryPage(open);
  const choice = segmented([['open', 'Open a file'], ['gallery', 'Gallery']],
                           location.hash === '#gallery' ? 'gallery' : 'open');
  const show = () => {
    const inGallery = choice.value === 'gallery';
    reading.hidden = inGallery;
    gallerySection.hidden = !inGallery;
    history.replaceState(null, '', inGallery ? '#gallery' : location.pathname + location.search);
  };
  choice.addEventListener('input', show);
  show();
  const content = document.createDocumentFragment();
  content.append(h('div', {class: 'landing-choice'}, choice), reading, gallerySection);
  return content;
}
