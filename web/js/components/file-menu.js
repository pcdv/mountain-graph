// @ts-check
/**
 * The file open, in the header: its name and a line of what it holds; a click
 * on the name drops a menu with all that is known of it and what can be done
 * with it (its export, saved with loss or not; for a heap, its parse's report).
 */
import {h} from '../lib/dom.js';

/**
 * @param {string} name of the file
 * @param {string} brief what it holds, short enough for the header
 * @param {...(Node | null)} details the menu's content
 * @returns {HTMLElement[]} the name, the line, and the menu (a popover, in the top layer)
 */
export function fileMenu(name, brief, ...details) {
  const menu = h('div', {id: 'file-menu', class: 'file-menu', popover: 'auto'}, h('h2', null, name), details);
  const button = h('button', {type: 'button', class: 'file-name', popovertarget: 'file-menu',
                              title: 'What the file holds'},
                   h('span', null, name), chevron());
  // under the name, kept inside the window
  menu.addEventListener('beforetoggle', e => {
    if (/** @type {any} */ (e).newState !== 'open')
      return;
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 8 - Math.min(560, innerWidth - 16)))}px`;
  });
  return [button, h('span', {class: 'brief', title: brief}, brief), menu];
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}
