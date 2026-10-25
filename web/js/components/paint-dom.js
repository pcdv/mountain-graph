// @ts-check
/**
 * Draws elements of the page onto a canvas, as the page lays them out: their boxes (background, border,
 * rounded corners), their text line by line, the numbers of their lists. For a picture of the view with the
 * panels floating over it; it is what the panels use, not any HTML: images, canvases, shadows and pseudo
 * elements are left out.
 */

/**
 * @param {CanvasRenderingContext2D} g
 * @param {Element[]} elements the roots to draw, in the order of the page, each over the one before
 * @param {{left: number, top: number}} origin where the canvas is on the page, in CSS pixels
 * @param {number} k canvas pixels to a CSS pixel
 */
export function paintElements(g, elements, origin, k) {
  g.save();
  g.scale(k, k);
  g.translate(-origin.left, -origin.top);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (const el of elements)
    paint(g, el);
  g.restore();
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {Element} el
 */
function paint(g, el) {
  // not laid out: hidden, or without a box
  if (el.getClientRects().length === 0)
    return;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none')
    return;
  const r = el.getBoundingClientRect();
  g.save();
  g.globalAlpha *= Number(style.opacity);
  box(g, r, style);
  // what is scrolled or cut off by its box is not in the picture
  if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
    g.beginPath();
    g.rect(r.left, r.top, r.width, r.height);
    g.clip();
  }
  if (style.display === 'list-item')
    marker(g, el, r, style);
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE)
      text(g, /** @type {Text} */ (node), style);
    else if (node instanceof Element && !(node instanceof HTMLCanvasElement || node instanceof SVGElement))
      paint(g, node);
  }
  g.restore();
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {DOMRect} r
 * @param {CSSStyleDeclaration} style
 */
function box(g, r, style) {
  const border = parseFloat(style.borderTopWidth) || 0;
  const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
  if (!filled && border === 0)
    return;
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
  g.beginPath();
  g.roundRect(r.left, r.top, r.width, r.height, radius);
  if (filled) {
    g.fillStyle = style.backgroundColor;
    g.fill();
  }
  if (border > 0 && style.borderTopStyle !== 'none') {
    g.beginPath();
    g.roundRect(r.left + border / 2, r.top + border / 2, r.width - border, r.height - border, Math.max(0, radius - border / 2));
    g.lineWidth = border;
    g.strokeStyle = style.borderTopColor;
    g.stroke();
  }
}

/**
 * The number or bullet of a list item, which the page draws and the element does not hold.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {Element} el
 * @param {DOMRect} r
 * @param {CSSStyleDeclaration} style
 */
function marker(g, el, r, style) {
  const type = style.listStyleType;
  if (type === 'none' || !el.parentElement)
    return;
  const rank = [...el.parentElement.children].filter(c => getComputedStyle(c).display === 'list-item').indexOf(el);
  const start = el.parentElement instanceof HTMLOListElement ? el.parentElement.start : 1;
  const label = type === 'decimal' ? `${start + rank}.` : '•';
  setFont(g, style);
  g.fillStyle = style.color;
  g.textAlign = 'right';
  g.fillText(label, r.left - 4, firstLine(el, r));
  g.textAlign = 'left';
}

/**
 * @param {Element} el
 * @param {DOMRect} r
 * @returns {number} the middle of the first line of text of el
 */
function firstLine(el, r) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const first = [...range.getClientRects()].find(q => q.width > 0);
  return first ? first.top + first.height / 2 : r.top + r.height / 2;
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {CSSStyleDeclaration} style
 */
function setFont(g, style) {
  g.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * The text of a node, a line at a time: where each line starts is where the first of its characters is.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {Text} node
 * @param {CSSStyleDeclaration} style
 */
function text(g, node, style) {
  const s = node.data;
  if (s.trim() === '')
    return;
  setFont(g, style);
  g.fillStyle = style.color;
  const range = document.createRange();
  /** @param {{x: number, y: number, text: string}} l */
  const draw = l => g.fillText(style.textTransform === 'uppercase' ? l.text.toUpperCase() : l.text, l.x, l.y);
  /** @type {{x: number, y: number, text: string} | null} */
  let line = null;
  for (let i = 0; i < s.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const q = range.getBoundingClientRect();
    // collapsed white space has no box
    if (q.width === 0)
      continue;
    const y = q.top + q.height / 2;
    if (line && Math.abs(line.y - y) < q.height / 2)
      line.text += s[i];
    else {
      if (line)
        draw(line);
      line = {x: q.left, y, text: s[i]};
    }
  }
  if (line)
    draw(line);
}
