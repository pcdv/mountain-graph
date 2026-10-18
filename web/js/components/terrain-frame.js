// @ts-check
/**
 * What the map and the 3D view share around their drawing: the line under
 * it telling the frame hovered (its path from the peak, the heaviest way on
 * to where execution entered), the panel beside it with the callers of the
 * mountain clicked, and which frames are lit. A view draws and picks; it
 * tells the frame which node is under the mouse, and redraws when told.
 */
import {h} from '../lib/dom.js';
import {callersTree} from './callers.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * @typedef {object} TerrainFrame
 * @property {HTMLElement} section the whole, to put in the page
 * @property {HTMLElement} holder where the view puts its drawing, as wide as it may be
 * @property {() => number} lit the node hovered, -1 for none
 * @property {() => number} chosen the mountain whose callers show, -1 for none
 * @property {(n: number) => boolean} isLit whether a node is lit: it is named as the one hovered
 * @property {(n: number) => void} hover the node under the mouse, -1 for none: redraws if it changed
 * @property {(n: number) => void} click on a node: shows its mountain's callers, or hides them when
 *           they show; on the plain, hides them
 */

/**
 * @param {Terrain} t
 * @param {Frame[]} trees the mountains it was raised from, in its order
 * @param {{chosen: string}} selection the name of the peak whose callers show, '' for none: kept up
 *        to date, so that the same one shows when the view is built again
 * @param {string} hint what to do, until something is hovered
 * @param {() => void} redraw called when what is lit or chosen changed
 * @returns {TerrainFrame}
 */
export function terrainFrame(t, trees, selection, hint, redraw) {
  const info = h('div', {class: 'map-info muted'}, hint);
  const holder = h('div', {class: 'map-holder'});
  const panel = h('aside', {class: 'map-panel'});
  const section = h('section', {class: 'terrain'}, h('div', {class: 'map-side'}, holder, info), panel);

  // the frames of the same name, lit together
  /** @type {Map<string, number>} */
  const names = new Map();
  const nameOf = new Int32Array(t.nodes.length);
  t.nodes.forEach((n, i) => {
    if (!names.has(n.name))
      names.set(n.name, names.size);
    nameOf[i] = /** @type {number} */ (names.get(n.name));
  });
  /** @type {number[][]} */
  const children = t.nodes.map(() => []);
  t.nodes.forEach((n, i) => n.parent >= 0 && children[n.parent].push(i));

  let lit = -1;
  let chosen = t.mountains.findIndex(m => m.name === selection.chosen);
  /** @param {number} m */
  const choose = m => {
    chosen = m;
    selection.chosen = m < 0 ? '' : t.mountains[m].name;
    panel.hidden = m < 0;
    if (m < 0)
      return;
    const tree = trees[m];
    panel.replaceChildren(
      h('div', {class: 'panel-head'},
        h('b', null, tree.name),
        h('button', {type: 'button', class: 'button', title: 'Close', onclick: () => {
          choose(-1);
          redraw();
        }}, '×')),
      h('div', {class: 'muted'}, `${Math.round(tree.total).toLocaleString()} ms; its callers, the heaviest first:`),
      callersTree(tree));
  };
  choose(chosen);

  return {
    section,
    holder,
    lit: () => lit,
    chosen: () => chosen,
    isLit: n => lit >= 0 && n >= 0 && nameOf[n] === nameOf[lit],
    hover: n => {
      if (n === lit)
        return;
      lit = n;
      info.replaceChildren(...(n < 0 ? [hint] : describe(t, children, n)));
      redraw();
    },
    click: n => {
      choose(n < 0 || t.nodes[n].mountain === chosen ? -1 : t.nodes[n].mountain);
      redraw();
    },
  };
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
      + `${(100 * node.total / peak.total).toFixed(1)}% of ${short(peak.name)}, `
      + `${node.depth} ${node.depth === 1 ? 'call' : 'calls'} down`),
    h('ol', {class: 'path'},
      up.map(i => row(i, i === n ? 'here' : '')),
      on.map(i => row(i, 'on'))),
  ];
}

/**
 * @param {string} name of a method, class or package
 * @returns {string} its last two parts: "Class.method", "package.Class", "a.b"
 */
export function short(name) {
  const paren = name.indexOf('(');
  const parts = (paren > 0 ? name.substring(0, paren) : name).split('.');
  return parts.slice(-2).join('.');
}
