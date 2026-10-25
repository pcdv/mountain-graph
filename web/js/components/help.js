// @ts-check
/**
 * The help: one page, help.html, with an anchor for each feature, shown in a dialog over the view. A
 * setting's label, hovered (lib/tip.js), says in short what it does, and opens the help there for more.
 */
import {h} from '../lib/dom.js';
import {tip} from '../lib/tip.js';

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
  wanted = anchor;
  // shown before loaded or scrolled: a page in a closed dialog has no layout to scroll
  if (!dialog.open)
    dialog.showModal();
  // loaded once: the page again at another anchor only scrolls
  if (!frame.getAttribute('src')) {
    frame.addEventListener('load', () => scrollTo(wanted));
    frame.setAttribute('src', PAGE);
  }
  else
    scrollTo(anchor);
  frame.focus();
}

/** @type {string | undefined} the anchor asked for last, for the page to scroll to once loaded */
let wanted;

/**
 * Scrolls the page of the help to a section, and marks it as the target of the page's address.
 *
 * @param {string} [anchor] the id of a section, none for the top
 */
function scrollTo(anchor) {
  const page = frame?.contentWindow;
  if (!page)
    return;
  // the same hash again would not mark the section: leave it first
  page.location.hash = '';
  const section = anchor ? page.document.getElementById(anchor) : null;
  if (section) {
    page.location.hash = `#${anchor}`;
    section.scrollIntoView();
  }
  else
    page.scrollTo(0, 0);
}

/**
 * Gives an element a short help, shown while it is hovered, with a button to the help at a feature.
 *
 * @template {HTMLElement} T
 * @param {T} el the label of the feature
 * @param {string} anchor the id of a section of help.html
 * @param {string} message what the feature does, in a sentence or two
 * @returns {T} el
 */
export function helpTip(el, anchor, message) {
  return tip(el, message, {label: 'More', open: () => openHelp(anchor)});
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
