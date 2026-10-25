// @ts-check
import {$} from './lib/dom.js';

/** @returns {Node} what the page shows while no file is open, from its template in index.html */
export function landing() {
  return $('landing', HTMLTemplateElement).content.cloneNode(true);
}
