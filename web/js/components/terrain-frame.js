// @ts-check
/**
 * What the map and the 3D view share around their drawing: the line under
 * it telling the frame hovered (its path from the peak, the heaviest way on
 * to where execution entered), the panel beside it with the callers of the
 * mountain clicked, or what it called and what ran at the top, and which
 * frames are lit. The panel is as wide as dragged, remembered. A view draws and picks; it
 * tells the frame which node is under the mouse, and redraws when told.
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {callersTree} from './callers.js';
import {amount} from '../model/units.js';

/** @typedef {import('../model/terrain.js').Terrain} Terrain */
/** @typedef {import('../profile/profile.js').Frame} Frame */
/** @typedef {import('../model/callees.js').Top} Top */
/** @typedef {{tree: Frame, tops: Top[], groups: {name: string, ms: number}[]}} Called */

const WIDTH = 'mountaingraph.panel.width';

/** @returns {number} the width of the panel beside the view, px, as last dragged */
export function panelWidth() {
  const w = Number(readSetting(WIDTH));
  return w >= 240 ? w : 520;
}

/**
 * What the page keeps of the panel, and gives it.
 *
 * @typedef {object} Selection
 * @property {string} chosen the name of the peak whose panel shows, '' for none
 * @property {'callers' | 'callees'} [tab] what the panel shows
 * @property {(name: string) => Called} [callees] what a peak called
 * @property {import('../model/units.js').Unit} [unit] what the weights count, as the profile tells; ms when not told
 */

/**
 * @typedef {object} TerrainFrame
 * @property {HTMLElement} section the whole, to put in the page
 * @property {HTMLElement} holder where the view puts its drawing, as wide as it may be
 * @property {() => number} lit the node hovered, -1 for none
 * @property {() => number} chosen the mountain whose callers show, -1 for none
 * @property {(n: number) => boolean} isLit whether a node is lit: it is named as the one hovered
 * @property {(n: number) => void} hover the node under the mouse, -1 for none: redraws if it changed
 * @property {(n: number) => void} click on a node: shows its mountain's panel, left as it is if it
 *           shows already (a tree unfolded, a tab); on the plain, -1, hides it
 */

/**
 * @param {Terrain} t
 * @param {Frame[]} trees the mountains it was raised from, in its order
 * @param {Selection} selection kept up to date, so that the same panel shows when the view is
 *        built again
 * @param {string} hint what to do, until something is hovered
 * @param {() => void} redraw called when what is lit or chosen changed
 * @returns {TerrainFrame}
 */
export function terrainFrame(t, trees, selection, hint, redraw) {
  const unit = selection.unit ?? 'ms';
  const info = h('div', {class: 'map-info muted'}, hint);
  const holder = h('div', {class: 'map-holder'});
  const panel = h('aside', {class: 'map-panel'});
  panel.style.width = `${panelWidth()}px`;
  const split = h('div', {class: 'map-split', title: 'Drag to widen the panel'});
  // the view fills the section; the line and the panel float over it
  const dock = h('div', {class: 'map-dock'}, split, panel);
  const section = h('section', {class: 'terrain'}, holder, info, dock);
  split.addEventListener('pointerdown', e => {
    split.setPointerCapture(e.pointerId);
    const right = panel.getBoundingClientRect().right;
    /** @param {PointerEvent} m */
    const move = m => {
      const w = Math.max(240, Math.min(section.clientWidth - 120, right - m.clientX));
      panel.style.width = `${w}px`;
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', () => {
      split.removeEventListener('pointermove', move);
      writeSetting(WIDTH, Math.round(panel.getBoundingClientRect().width));
    }, {once: true});
  });

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
    dock.hidden = m < 0;
    if (m < 0)
      return;
    const tree = trees[m];
    const called = selection.callees;
    const tab = called ? selection.tab ?? 'callers' : 'callers';
    /** @param {'callers' | 'callees'} to */
    const button = to => h('button', {type: 'button', class: to === tab ? 'button on' : 'button', onclick: () => {
      selection.tab = to;
      choose(m);
    }}, to === 'callers' ? 'Callers' : 'Callees');
    panel.replaceChildren(
      h('div', {class: 'panel-head'},
        h('b', null, tree.name),
        h('button', {type: 'button', class: 'button', title: 'Close', onclick: () => {
          choose(-1);
          redraw();
        }}, '×')),
      ...called ? [h('div', {class: 'panel-tabs'}, button('callers'), button('callees'))] : [],
      ...tab === 'callees' && called ? calleesOf(called(tree.name), unit) : [
        h('div', {class: 'muted'}, `${amount(tree.total, unit)} at the top; its callers, the heaviest first:`),
        callersTree(tree, 'callers', unit),
      ]);
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
      info.replaceChildren(...(n < 0 ? [hint] : describe(t, children, n, unit)));
      redraw();
    },
    click: n => {
      // its mountain's, kept as it is when it shows already; on the plain, none
      const m = n < 0 ? -1 : t.nodes[n].mountain;
      if (m === chosen)
        return;
      choose(m);
      redraw();
    },
  };
}

/**
 * @param {Called} called what a peak called, and what ran at the top
 * @param {import('../model/units.js').Unit} unit
 * @returns {HTMLElement[]}
 */
function calleesOf({tree, tops, groups}, unit) {
  const total = tree.total;
  const shown = tops.slice(0, 8);
  /** @param {number} ms */
  const share = ms => `${(100 * ms / total).toFixed(0)}%`;
  return [
    h('div', {class: 'muted'}, `${amount(total, unit)} it was in, no frame hidden. At the top:`),
    h('div', {class: 'groups'}, groups.slice(0, 6).map(g => h('span', {class: 'kind', title: amount(g.ms, unit)},
                                                            `${g.name} ${share(g.ms)}`))),
    h('div', {class: 'muted'}, 'The methods:'),
    h('ul', {class: 'tops'}, shown.map(top => h('li', null,
      h('span', {class: 'frame'}, top.name),
      h('span', {class: 'muted'}, ` ${amount(top.ms, unit)}, ${(100 * top.ms / total).toFixed(1)}%`),
      top.kind ? h('span', {class: 'kind'}, top.kind) : null))),
    ...tops.length > shown.length ? [h('div', {class: 'muted'}, `and ${tops.length - shown.length} more`)] : [],
    h('div', {class: 'muted'}, 'What it called, the heaviest first:'),
    callersTree(tree, 'callees', unit),
  ];
}

/**
 * @param {Terrain} t
 * @param {number[][]} children of each node
 * @param {number} n the node hovered
 * @param {import('../model/units.js').Unit} unit
 * @returns {Node[]}
 */
function describe(t, children, n, unit) {
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
      h('span', {class: 'muted'}, ` ${amount(node.total, unit)}, `
                                  + `${(100 * node.total / peak.total).toFixed(1)}%`));
  };
  const node = t.nodes[n];
  // a saddle: the time through it toward each peak it joins
  const saddle = t.saddles.find(s => s.nodes.includes(n));
  return [
    h('div', null, h('b', null, node.name), ` ${amount(node.total, unit)}, `
      + `${(100 * node.total / peak.total).toFixed(1)}% of ${short(peak.name)}, `
      + `${node.depth} ${node.depth === 1 ? 'call' : 'calls'} down`),
    ...saddle ? [h('div', null, 'A saddle: ', saddle.nodes.map(i => {
      const m = t.mountains[t.nodes[i].mountain];
      return `${amount(t.nodes[i].total, unit)} toward ${short(m.name)}`;
    }).join(', '))] : [],
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
