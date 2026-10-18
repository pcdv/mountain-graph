// @ts-check
/**
 * The terrain as a topographic map: tinted by height, contour lines each
 * half the height of the one above, the peaks named; the divides between
 * mountains, and the saddles joining them, marked )( and named; dashed
 * trails between mountains related through a caller, however far apart. Hovering a frame lights
 * it in every mountain it stands in; what it is, and the callers of a
 * mountain clicked, show around the map (terrain-frame.js).
 */
import {h} from '../lib/dom.js';
import {contour, levels} from '../model/contours.js';
import {divides} from '../model/divides.js';
import {terrainFrame, short} from '../components/terrain-frame.js';
import {palette, tint, hued, DEPTH} from './palette.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/** The most contour lines. */
export const LINES = 9;

/** The most height of a view of the terrain, as a share of the window's. */
export const HEIGHT = 0.7;

/**
 * @param {Terrain} t
 * @param {Frame[]} trees the mountains it was raised from, in its order
 * @param {import('../components/terrain-frame.js').Selection} selection the peak whose panel shows
 * @param {Float64Array | null} [hues] per node, the hue of its package (hues.js); none to colour by height only
 * @returns {HTMLElement}
 */
export function mapView(t, trees, selection, hues = null) {
  const colors = palette();
  const canvas = h('canvas', {class: 'map'});
  let scale = 1;
  const frame = terrainFrame(t, trees, selection,
                             'Hover the map: a frame, its path from the peak. Click a mountain: its callers and callees.',
                             () => {
                               light();
                               scale = draw();
                             });
  frame.holder.append(canvas);

  // the tint and the lines, drawn once at the terrain's resolution; the plain clear, for the trails
  // under the land
  const land = document.createElement('canvas');
  land.width = t.width;
  land.height = t.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (land.getContext('2d'));
  const image = ctx.createImageData(t.width, t.height);
  for (let i = 0; i < t.heights.length; i++) {
    const c = tint(colors, t.heights[i], t.top);
    image.data.set(hues && t.cells[i] >= 0 ? hued(c, hues[t.cells[i]]) : c, 4 * i);
    image.data[4 * i + 3] = t.heights[i] > 0 ? 255 : 0;
  }
  ctx.putImageData(image, 0, 0);
  const lines = levels(t.top, LINES, t.top * DEPTH).map(level => contour(t.heights, t.width, t.height, level));
  const divide = divides(t);

  const glow = document.createElement('canvas');
  glow.width = t.width;
  glow.height = t.height;
  const glowing = /** @type {CanvasRenderingContext2D} */ (glow.getContext('2d'));
  /** lights the cells of the frames named as the one hovered */
  const light = () => {
    const image = glowing.createImageData(t.width, t.height);
    const lit = frame.lit();
    if (lit >= 0)
      for (let i = 0; i < t.cells.length; i++) {
        const n = t.cells[i];
        if (frame.isLit(n)) {
          image.data.set(colors.lit, 4 * i);
          image.data[4 * i + 3] = n === lit ? 230 : 140;
        }
      }
    glowing.putImageData(image, 0, 0);
  };

  const draw = () => {
    const width = frame.holder.clientWidth || 800;
    const scale = Math.min(width / t.width, HEIGHT * innerHeight / t.height);
    const ratio = devicePixelRatio || 1;
    canvas.style.width = `${t.width * scale}px`;
    canvas.style.height = `${t.height * scale}px`;
    canvas.width = Math.round(t.width * scale * ratio);
    canvas.height = Math.round(t.height * scale * ratio);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    g.fillStyle = `rgb(${colors.land[0].join(',')})`;
    g.fillRect(0, 0, t.width, t.height);

    // the trails on the plain, under the land, as wide as the relation is strong
    g.strokeStyle = colors.text;
    g.globalAlpha = 0.7;
    g.setLineDash([5 / scale, 4 / scale]);
    for (const trail of t.trails) {
      const [x1, y1, x2, y2] = trail.line;
      g.lineWidth = (1 + 2 * trail.share) / scale;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;

    g.drawImage(land, 0, 0);
    if (frame.lit() >= 0)
      g.drawImage(glow, 0, 0);

    g.lineWidth = 1 / scale;
    g.strokeStyle = colors.line;
    g.beginPath();
    for (const s of lines)
      for (let i = 0; i < s.length; i += 4) {
        g.moveTo(s[i], s[i + 1]);
        g.lineTo(s[i + 2], s[i + 3]);
      }
    g.stroke();

    g.lineWidth = 1.5 / scale;
    g.strokeStyle = colors.text;
    g.globalAlpha = 0.5;
    g.beginPath();
    for (let i = 0; i < divide.length; i += 4) {
      g.moveTo(divide[i], divide[i + 1]);
      g.lineTo(divide[i + 2], divide[i + 3]);
    }
    g.stroke();

    g.globalAlpha = 1;

    const chosen = frame.chosen();
    if (chosen >= 0) {
      const m = t.mountains[chosen];
      g.lineWidth = 2 / scale;
      g.strokeStyle = colors.text;
      g.setLineDash([4 / scale, 3 / scale]);
      g.beginPath();
      g.arc(m.x, m.y, m.r + 2, 0, 2 * Math.PI);
      g.stroke();
      g.setLineDash([]);
    }

    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    /** @type {number[][]} the boxes of the labels drawn, the highest peaks first */
    const taken = [];
    /** @param {string} label @param {number} x @param {number} y @param {number} size of the font, px */
    const name = (label, x, y, size) => {
      const w = g.measureText(label).width + 4;
      x = Math.max(w / 2, Math.min(t.width * scale - w / 2, x));
      const box = [x - w / 2, y - size * 0.7, x + w / 2, y + size * 0.7];
      if (taken.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]))
        return;
      taken.push(box);
      g.lineWidth = 3;
      g.strokeStyle = colors.halo;
      g.strokeText(label, x, y);
      g.fillStyle = colors.text;
      g.fillText(label, x, y);
    };
    t.mountains.forEach(m => name(short(m.name), m.x * scale, m.y * scale, 11));

    // the saddles, the highest first: )( across the way from one peak to the other
    g.font = 'italic 10px system-ui, sans-serif';
    const height = (/** @type {{x: number, y: number}} */ s) => t.heights[Math.floor(s.y) * t.width + Math.floor(s.x)];
    for (const s of t.saddles.filter(s => s.join).sort((a, b) => height(b) - height(a))) {
      const [a, b] = s.nodes.map(n => t.mountains[t.nodes[n].mountain]);
      const angle = Math.atan2(b.y - a.y, b.x - a.x), x = s.x * scale, y = s.y * scale;
      g.lineWidth = 1.5;
      g.strokeStyle = colors.text;
      for (const side of [0, Math.PI]) {
        const cx = x + 9 * Math.cos(angle + side), cy = y + 9 * Math.sin(angle + side);
        g.beginPath();
        g.arc(cx, cy, 6, angle + side + Math.PI - 0.9, angle + side + Math.PI + 0.9);
        g.stroke();
      }
      name(short(s.name), x, y + 13, 10);
    }
    // the trails, named after the caller they share, halfway
    for (const trail of t.trails) {
      const [x1, y1, x2, y2] = trail.line;
      name(short(trail.caller), (x1 + x2) / 2 * scale, (y1 + y2) / 2 * scale, 10);
    }
    return scale;
  };

  // drawn once in the page, to know its width, and again as it changes
  new ResizeObserver(() => scale = draw()).observe(frame.holder);

  /** @param {MouseEvent} e @returns {number} the node under the mouse, -1 on the plain */
  const nodeAt = e => {
    const x = Math.floor(e.offsetX / scale), y = Math.floor(e.offsetY / scale);
    return x >= 0 && y >= 0 && x < t.width && y < t.height ? t.cells[y * t.width + x] : -1;
  };
  canvas.addEventListener('click', e => frame.click(nodeAt(e)));
  canvas.addEventListener('mousemove', e => frame.hover(nodeAt(e)));
  canvas.addEventListener('mouseleave', () => frame.hover(-1));
  return frame.section;
}
