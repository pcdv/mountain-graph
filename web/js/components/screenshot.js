// @ts-check
/**
 * A picture of the view shown, by hotkey: S saves it as a PNG, C copies it to the clipboard. It holds the
 * canvas of the map or of the 3D view, and the signs over the peaks of the 3D view, which are not drawn
 * in it; the panels floating over it too with Shift (S and C in capitals), drawn again by paint-dom.js.
 */
import {h} from '../lib/dom.js';
import {paintElements} from './paint-dom.js';

/** How long the message stays, ms. */
const TOAST = 2000;

/** @type {HTMLElement | null} */
let toast = null;
/** @type {number | undefined} */
let hiding;

/** @param {string} text */
function say(text) {
  toast ??= h('div', {class: 'toast', role: 'status'});
  toast.textContent = text;
  toast.hidden = false;
  document.body.append(toast);
  clearTimeout(hiding);
  hiding = setTimeout(() => toast && (toast.hidden = true), TOAST);
}

/**
 * @param {ParentNode} root
 * @returns {HTMLCanvasElement | null} the canvas of the view shown: the last, as a view being replaced is before it
 */
function viewCanvas(root) {
  const all = [...root.querySelectorAll('.map-holder canvas')];
  return /** @type {HTMLCanvasElement | null} */ (all[all.length - 1] ?? null);
}

/**
 * @param {HTMLCanvasElement} view
 * @param {boolean} [panels] whether the panels floating over the view are in the picture too
 * @returns {HTMLCanvasElement} a copy of it, with the signs of the peaks over it, and the names of the trails
 */
export function compose(view, panels = false) {
  const out = document.createElement('canvas');
  out.width = view.width;
  out.height = view.height;
  const g = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  g.drawImage(view, 0, 0);
  const box = view.getBoundingClientRect();
  if (box.width === 0)
    return out;
  const k = view.width / box.width;
  const names = view.parentElement?.querySelectorAll('.peak-labels span:not([hidden])') ?? [];
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const page = getComputedStyle(document.body);
  for (const name of names) {
    if (name.classList.contains('sign')) {
      paintSign(g, name, box, k);
      continue;
    }
    const r = name.getBoundingClientRect(), style = getComputedStyle(name);
    g.font = `${style.fontStyle} ${parseFloat(style.fontSize) * k}px ${style.fontFamily}`;
    const x = (r.left + r.width / 2 - box.left) * k, y = (r.top + r.height / 2 - box.top) * k;
    g.strokeStyle = page.backgroundColor;
    g.lineWidth = 3 * k;
    g.strokeText(name.textContent ?? '', x, y);
    g.fillStyle = style.color;
    g.fillText(name.textContent ?? '', x, y);
  }
  if (panels) {
    // the hovered line, the panel of the peak and the legend of the colours, over the view as on the page, those shown
    const shown = (view.closest('.stage-view') ?? view.closest('.terrain'))
      ?.querySelectorAll('.map-info:not([hidden]), .map-dock:not([hidden]) .map-panel, .hue-legend') ?? [];
    paintElements(g, [...shown], box, k);
  }
  return out;
}

/**
 * Draws a peak's sign as the page shows it: its plate with the shadow and the rule inside it, the name and
 * the weight under it. The sign is scaled by the page's transform, which the text does not follow in what is
 * measured of it: the size of its font is scaled here by how much its box is.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {Element} sign
 * @param {DOMRect} view where the canvas of the view is on the page, in CSS pixels
 * @param {number} k canvas pixels to a CSS pixel
 */
function paintSign(g, sign, view, k) {
  const r = sign.getBoundingClientRect(), style = getComputedStyle(sign);
  // how much the page scaled it, by distance and by the setting
  const s = sign instanceof HTMLElement && sign.offsetWidth > 0 ? r.width / sign.offsetWidth : 1;
  const x = (r.left - view.left) * k, y = (r.top - view.top) * k, w = r.width * k, h = r.height * k;
  const radius = (parseFloat(style.borderTopLeftRadius) || 0) * s * k;
  g.save();
  g.fillStyle = style.backgroundColor;
  g.shadowColor = 'rgba(0, 0, 0, 0.3)';
  g.shadowBlur = 6 * s * k;
  g.shadowOffsetY = 2 * s * k;
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.fill();
  g.restore();
  // the rule, 3 px inside the edge
  const inset = 3 * s * k;
  g.save();
  g.strokeStyle = style.color;
  g.lineWidth = s * k;
  g.beginPath();
  g.roundRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, Math.max(0, radius - inset));
  g.stroke();
  g.restore();
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = style.color;
  for (const line of sign.children) {
    const q = line.getBoundingClientRect(), text = getComputedStyle(line);
    g.globalAlpha = Number(text.opacity);
    g.font = `${text.fontStyle} ${text.fontWeight} ${parseFloat(text.fontSize) * s * k}px ${text.fontFamily}`;
    g.fillText(line.textContent ?? '', (q.left + q.width / 2 - view.left) * k, (q.top + q.height / 2 - view.top) * k);
  }
  g.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function png(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('the canvas gave no image')), 'image/png'));
}

/**
 * @param {'save' | 'copy'} how
 * @param {string} name of the file, without its extension
 * @param {ParentNode} [root] where the view is
 * @param {boolean} [panels] with the panels floating over the view
 */
export async function screenshot(how, name, root = document, panels = false) {
  const view = viewCanvas(root);
  if (!view) {
    say('Nothing to take a picture of');
    return;
  }
  try {
    const blob = await png(compose(view, panels));
    if (how === 'copy') {
      await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
      say('Picture copied');
    }
    else {
      const link = h('a', {href: URL.createObjectURL(blob), download: `${name}.png`});
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      say(`Picture saved as ${name}.png`);
    }
  }
  catch (e) {
    say(`No picture: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * Takes the keys: S and C, with no modifier, outside a field.
 *
 * @param {() => string} name of the file to save, without its extension
 */
export function screenshotKeys(name) {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.target instanceof HTMLElement
        && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))
      return;
    const key = e.key.toLowerCase();
    if (key === 's' || key === 'c') {
      e.preventDefault();
      screenshot(key === 's' ? 'save' : 'copy', name(), document, e.shiftKey);
    }
  });
}
