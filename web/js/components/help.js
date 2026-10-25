// @ts-check
/**
 * The help: one page, help.html, with an anchor for each feature, shown in a dialog over the view. A
 * "?" beside a setting opens it there. The "?" is a link to the page, so that a click with a modifier
 * opens it in a tab of its own, and a keyboard or a screen reader finds it as a link.
 */
import {h} from '../lib/dom.js';

const PAGE = 'help.html';

/** @type {HTMLDialogElement | null} */
let dialog = null;
/** @type {HTMLIFrameElement | null} */
let frame = null;

/**
 * Shows the help, at a feature when told which.
 *
 * @param {string} [anchor] the id of a section of help.html
 */
export function openHelp(anchor) {
  if (!dialog || !frame) {
    frame = h('iframe', {title: 'Help'});
    const close = h('button', {type: 'button', class: 'button icon close', title: 'Close the help', 'aria-label': 'Close the help',
                               onclick: () => dialog?.close()});
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    dialog = /** @type {HTMLDialogElement} */ (h('dialog', {class: 'help'}, frame, close));
    // a click on the backdrop is a click on the dialog itself, not on what it holds
    dialog.addEventListener('click', e => {
      if (e.target === dialog)
        dialog?.close();
    });
    document.body.append(dialog);
  }
  // loaded once: the page again at another anchor only scrolls, by its hash
  if (!frame.getAttribute('src'))
    frame.setAttribute('src', anchor ? `${PAGE}#${anchor}` : PAGE);
  else {
    const page = frame.contentWindow;
    if (page) {
      // the same hash again does not scroll back to it: leave it first
      page.location.hash = '';
      page.location.hash = anchor ? `#${anchor}` : '';
      if (!anchor)
        page.scrollTo(0, 0);
    }
  }
  if (!dialog.open)
    dialog.showModal();
  frame.focus();
}

/**
 * A "?" that opens the help at a feature.
 *
 * @param {string} anchor the id of a section of help.html
 * @param {string} [about] what it is about, for who reads the link aloud
 * @returns {HTMLAnchorElement}
 */
export function helpLink(anchor, about = '') {
  const link = /** @type {HTMLAnchorElement} */ (h('a', {class: 'help-link', href: `${PAGE}#${anchor}`, target: '_blank',
                                                         title: 'Help on this', 'aria-label': `Help${about ? ` on ${about}` : ''}`}, '?'));
  link.addEventListener('click', e => {
    // with a modifier, or a middle click, the browser's own: the page in a tab
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)
      return;
    e.preventDefault();
    // the "?" sits in a label: a click must not reach its control
    e.stopPropagation();
    openHelp(anchor);
  });
  return link;
}

/**
 * The help from the header and the keyboard: the "?" key (outside a field being typed in) and F1.
 *
 * @param {HTMLElement} [button] the header's, which opens it at the top
 */
export function installHelp(button) {
  button?.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)
      return;
    e.preventDefault();
    openHelp();
  });
  addEventListener('keydown', e => {
    const target = /** @type {HTMLElement | null} */ (e.target);
    const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
                              && /** @type {HTMLInputElement} */ (target).type !== 'range');
    if (e.key === 'F1' || (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      openHelp();
    }
  });
}
