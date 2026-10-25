// From web-lib (https://github.com/pcdv/web-lib), src/tip.ts: changed there, then synced here.
// @ts-nocheck: its types are in tip.d.ts
/**
 * A tip: a short help message shown over the page while an element (the
 * label of a control) is hovered or has the focus, with a button to more
 * help (a page, a dialog) when there is more to say. The pointer can go
 * from the element into the message to reach the button.
 *
 * In place of a title: the message shows sooner, is styled with the page,
 * and holds a button. It is put at the end of the body, in the top layer
 * when the browser has popovers: a pane that scrolls or clips does not cut
 * it, and a click in it does not reach a label it would sit in.
 *
 * The page styles them: `.has-tip` the element (a dotted underline, say),
 * `.tip-bubble` the message, `.tip-more` its button.
 */
import {h} from './dom.js';

/** How long the pointer stays on the element before the message shows, ms. */
const DELAY = 300;
/** How long the pointer may be out of the element and the message before it hides, ms. */
const LINGER = 250;
/** The space kept between the message and the edges of the window, px. */
const MARGIN = 8;

/** The message shown, one at a time, and the element it is for. */
let bubble = null;
let owner = null;
let showing;
let hiding;
let ids = 0;

/**
 * Gives an element a tip.
 *
 * @param el what shows it, hovered or focused: the label of a control, or the control
 * @param message what the control does, in a sentence or two
 * @param more a button to more help, none if the message says it all
 * @returns el
 */
export function tip(el, message, more) {
  const id = `tip-${++ids}`;
  el.classList.add('has-tip');
  el.setAttribute('aria-describedby', id);
  const open = () => show(el, id, message, more);

  el.addEventListener('pointerenter', e => {
    if (e.pointerType === 'touch')
      return;
    clearTimeout(hiding);
    if (owner !== el) {
      clearTimeout(showing);
      showing = setTimeout(open, DELAY);
    }
  });
  el.addEventListener('pointerleave', () => {
    clearTimeout(showing);
    if (owner === el)
      later();
  });
  // from the keyboard only: a click focuses a control too, and a tip at each click would be in the way
  el.addEventListener('focusin', () => {
    if (owner !== el && el.matches(':has(:focus-visible), :focus-visible'))
      open();
  });
  el.addEventListener('focusout', e => {
    // to the message's button, it stays
    if (owner === el && !(bubble && e.relatedTarget instanceof Node && bubble.contains(e.relatedTarget)))
      later();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape' && owner === el) {
      e.stopPropagation();
      hideTip();
    }
  });
  // a press starts something else: a drag, a choice
  el.addEventListener('pointerdown', () => {
    clearTimeout(showing);
    hideTip();
  });
  return el;
}

/** Hides the message after a while, unless the pointer comes back. */
function later() {
  clearTimeout(hiding);
  hiding = setTimeout(hideTip, LINGER);
}

/** Hides the message shown, if any. */
export function hideTip() {
  clearTimeout(hiding);
  clearTimeout(showing);
  if (!bubble)
    return;
  // a browser without popovers knows no :popover-open either
  if (typeof bubble.hidePopover === 'function' && bubble.matches(':popover-open'))
    bubble.hidePopover();
  bubble.remove();
  bubble = owner = null;
}

function show(el, id, message, more) {
  hideTip();
  // the element gone meanwhile: a view built again
  if (!el.isConnected)
    return;
  const button = more ? h('button', {type: 'button', class: 'tip-more', onclick: () => {
    hideTip();
    more.open();
  }}, more.label ?? 'More…') : null;
  const shown = h('div', {id, class: 'tip-bubble', role: 'tooltip', popover: 'manual'},
                  h('div', null, message), button);
  // placed by its top left corner, whatever the popover's own style puts
  Object.assign(shown.style, {position: 'fixed', inset: 'auto', margin: '0', left: '0', top: '0'});
  shown.addEventListener('pointerenter', () => clearTimeout(hiding));
  shown.addEventListener('pointerleave', () => later());
  shown.addEventListener('focusout', e => {
    if (!(e.relatedTarget instanceof Node && (shown.contains(e.relatedTarget) || el.contains(e.relatedTarget))))
      later();
  });
  shown.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hideTip();
    }
  });
  document.body.append(shown);
  if (typeof shown.showPopover === 'function')
    shown.showPopover();
  bubble = shown;
  owner = el;
  place(shown, el);
}

/** Under the element, or over it when there is no room below, kept inside the window. */
function place(bubble, el) {
  const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(r.left, innerWidth - MARGIN - b.width));
  const below = r.bottom + 4;
  const top = below + b.height <= innerHeight - MARGIN ? below : Math.max(MARGIN, r.top - 4 - b.height);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}
