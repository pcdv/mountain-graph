// @ts-check
/**
 * Saving a file from the page: what a download is called, and the download.
 */
import {h} from './lib/dom.js';

/**
 * @param {string} name of the file the page opened: a dump, or a profile kept beside one
 * @param {string} suffix what the saved file's name ends with, extension included
 * @returns {string} the name without what says what it was: `heap.jheap.json.gz` is `heap`
 */
export function savedName(name, suffix) {
  return `${name.replace(/(\.jheap|\.flamepack)?\.(hprof|json|fpk)(\.gz)?$/i, '')}${suffix}`;
}

/**
 * @param {string} filename
 * @param {Blob} blob
 */
export function saveFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', {href: url, download: filename});
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
