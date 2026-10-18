// @ts-check
/**
 * The terrain as a topographic map: tinted by height, contour lines each
 * half the height of the one above, the peaks named. Hovering a frame shows
 * its path from the peak and the heaviest way on to where execution entered,
 * and lights it in every mountain it stands in.
 */
import {h} from '../lib/dom.js';
import {contour, levels} from '../model/contours.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../model/terrain.js').TerrainNode} TerrainNode */

/** The most contour lines, and how far down they go below the highest peak. */
const LINES = 9, DEPTH = 1 / 256;

/** The most height of the map, as a share of the window's. */
export const HEIGHT = 0.7;

/**
 * @param {Terrain} t
 * @returns {HTMLElement}
 */
export function mapView(t) {
  const colors = palette();
  const canvas = h('canvas', {class: 'map'});
  const info = h('div', {class: 'map-info muted'}, 'Hover the map: a frame, its path from the peak.');
  const section = h('section', {class: 'terrain'}, canvas, info);

  // the tint and the lines, drawn once at the terrain's resolution
  const land = document.createElement('canvas');
  land.width = t.width;
  land.height = t.height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (land.getContext('2d'));
  const image = ctx.createImageData(t.width, t.height);
  for (let i = 0; i < t.heights.length; i++) {
    const c = tint(colors, t.heights[i], t.top);
    image.data.set(c, 4 * i);
    image.data[4 * i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const lines = levels(t.top, LINES, t.top * DEPTH).map(level => contour(t.heights, t.width, t.height, level));

  // the node lit, and the frames of the same name
  const names = new Map();
  const nameOf = new Int32Array(t.nodes.length);
  t.nodes.forEach((n, i) => {
    if (!names.has(n.name))
      names.set(n.name, names.size);
    nameOf[i] = names.get(n.name);
  });
  /** @type {number[][]} */
  const children = t.nodes.map(() => []);
  t.nodes.forEach((n, i) => n.parent >= 0 && children[n.parent].push(i));
  let lit = -1;
  const glow = document.createElement('canvas');
  glow.width = t.width;
  glow.height = t.height;
  const glowing = /** @type {CanvasRenderingContext2D} */ (glow.getContext('2d'));
  /** lights the cells of the frames named as the node lit */
  const light = () => {
    const image = glowing.createImageData(t.width, t.height);
    if (lit >= 0) {
      const name = nameOf[lit];
      for (let i = 0; i < t.cells.length; i++) {
        const n = t.cells[i];
        if (n >= 0 && nameOf[n] === name) {
          image.data.set(colors.lit, 4 * i);
          image.data[4 * i + 3] = n === lit ? 230 : 140;
        }
      }
    }
    glowing.putImageData(image, 0, 0);
  };

  const draw = () => {
    const width = section.clientWidth || 800;
    const scale = Math.min(width / t.width, HEIGHT * innerHeight / t.height);
    const ratio = devicePixelRatio || 1;
    canvas.style.width = `${t.width * scale}px`;
    canvas.style.height = `${t.height * scale}px`;
    canvas.width = Math.round(t.width * scale * ratio);
    canvas.height = Math.round(t.height * scale * ratio);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    g.drawImage(land, 0, 0);

    if (lit >= 0)
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

    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    /** @type {number[][]} the boxes of the labels drawn, the highest peaks first */
    const taken = [];
    t.mountains.forEach(m => {
      const label = short(m.name);
      const w = g.measureText(label).width + 4;
      const x = Math.max(w / 2, Math.min(t.width * scale - w / 2, m.x * scale)), y = m.y * scale;
      const box = [x - w / 2, y - 8, x + w / 2, y + 8];
      if (taken.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]))
        return;
      taken.push(box);
      g.lineWidth = 3;
      g.strokeStyle = colors.halo;
      g.strokeText(label, x, y);
      g.fillStyle = colors.text;
      g.fillText(label, x, y);
    });
    return scale;
  };

  let scale = 1;
  // drawn once in the page, to know its width, and again as it changes
  new ResizeObserver(() => scale = draw()).observe(section);

  canvas.addEventListener('mousemove', e => {
    const x = Math.floor(e.offsetX / scale), y = Math.floor(e.offsetY / scale);
    const n = x >= 0 && y >= 0 && x < t.width && y < t.height ? t.cells[y * t.width + x] : -1;
    if (n === lit)
      return;
    lit = n;
    light();
    scale = draw();
    info.replaceChildren(...(n < 0 ? ['The plain.'] : describe(t, children, n)));
  });
  canvas.addEventListener('mouseleave', () => {
    lit = -1;
    light();
    scale = draw();
  });
  return section;
}

/**
 * @param {Terrain} t
 * @param {number[][]} children of each node
 * @param {number} n the node hovered
 * @returns {Node[]}
 */
function describe(t, children, n) {
  /** @type {number[]} */
  const up = [];
  for (let i = n; i >= 0; i = t.nodes[i].parent)
    up.unshift(i);
  const peak = t.nodes[up[0]];
  // the heaviest way on, to where execution entered
  /** @type {number[]} */
  const on = [];
  for (let i = n; children[i].length > 0;) {
    i = children[i].reduce((a, b) => t.nodes[b].total > t.nodes[a].total ? b : a);
    on.push(i);
  }
  /** @param {number} i @param {string} cls */
  const row = (i, cls) => {
    const node = t.nodes[i];
    return h('li', {class: cls}, node.name,
      h('span', {class: 'muted'}, ` ${Math.round(node.total).toLocaleString()} ms, `
                                  + `${(100 * node.total / peak.total).toFixed(1)}%`));
  };
  const node = t.nodes[n];
  return [
    h('div', null, h('b', null, node.name), ` ${Math.round(node.total).toLocaleString()} ms, `
      + `${(100 * node.total / peak.total).toFixed(1)}% of ${short(peak.name)}, ${node.depth} ${node.depth === 1 ? 'call' : 'calls'} down`),
    h('ol', {class: 'path'},
      up.map(i => row(i, i === n ? 'here' : '')),
      on.map(i => row(i, 'on'))),
  ];
}

/**
 * @param {string} name of a method, class or package
 * @returns {string} its last two parts: "Class.method", "package.Class", "a.b"
 */
function short(name) {
  const paren = name.indexOf('(');
  const parts = (paren > 0 ? name.substring(0, paren) : name).split('.');
  return parts.slice(-2).join('.');
}

/**
 * @typedef {object} Palette
 * @property {number[][]} land rgb from the plain up to the highest peak
 * @property {string} line
 * @property {number[]} lit rgb of the frame hovered, and of those of its name
 * @property {string} text
 * @property {string} halo
 */

/** @returns {Palette} from the page's style, light or dark */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const v = (/** @type {string} */ name) => style.getPropertyValue(name).trim();
  return {
    land: ['--plain', '--land-1', '--land-2', '--land-3', '--land-4', '--land-5'].map(name => rgb(v(name))),
    line: v('--contour'),
    lit: rgb(v('--lit')),
    text: v('--fg'),
    halo: v('--bg'),
  };
}

/** @param {string} hex "#rrggbb" */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

/**
 * The colour of a height: the plain at 0, then up the palette by halvings,
 * as the contour lines go.
 *
 * @param {Palette} colors
 * @param {number} height
 * @param {number} top
 * @returns {number[]}
 */
function tint(colors, height, top) {
  const land = colors.land;
  if (height <= 0)
    return land[0];
  // 0 at the top, 1 at the lowest line
  const lowest = Math.log2(1 / DEPTH);
  const depth = Math.min(1, Math.log2(top / height) / lowest);
  const at = 1 + (1 - depth) * (land.length - 2);
  const i = Math.min(land.length - 2, Math.floor(at)), f = at - i;
  const a = land[i], b = land[Math.min(land.length - 1, i + 1)];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f));
}
