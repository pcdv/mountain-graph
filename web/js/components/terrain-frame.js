// @ts-check
/**
 * What the map and the 3D view share around their drawing: the line under
 * it telling the frame hovered (its path from the peak, the heaviest way on
 * to where execution entered), the panel beside it with the callers of the
 * mountain clicked, or what it called and what ran at the top, and which
 * frames are lit. The panel is as wide as dragged, remembered. A view draws and picks; it
 * tells the frame which node is under the mouse, and redraws when told.
 *
 * A heap's panel says what the peak holds and who holds it instead, and walks
 * the object graph: a name clicked shows that object (holders.js).
 */
import {h} from '../lib/dom.js';
import {readSetting, writeSetting} from '../lib/settings.js';
import {callersTree} from './callers.js';
import {heldBy, holdersOf} from './holders.js';
import {amount} from '../model/units.js';
import {helpTip} from './help.js';

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
 * What the panel shows: a peak's callers or callees, or for a heap what it holds or who holds it.
 *
 * @typedef {'callers' | 'callees' | 'holds' | 'holders'} Tab
 */

/**
 * What the page keeps of the panel, and gives it.
 *
 * @typedef {object} Selection
 * @property {string} chosen the name of the peak whose panel shows, '' for none
 * @property {Tab} [tab] what the panel shows
 * @property {(name: string) => Called} [callees] what a peak called
 * @property {import('../model/units.js').Unit} [unit] what the weights count, as the profile tells; ms when not told
 * @property {boolean} [holds] the mountain is what the peak holds, not its callers: a heap dump
 * @property {number[]} [nodes] the node of each mountain in the profile, in the terrain's order
 * @property {(node: number) => Frame | undefined} [holdsAt] what an object holds, when the panel
 *           can be walked: clicking a frame then shows that object instead of the peak
 * @property {(node: number) => Frame | undefined} [heldByAt] who holds an object
 * @property {number} [subject] the object the panel shows, kept up to date
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
 * @param {() => void} redraw called when what is lit or chosen changed
 * @returns {TerrainFrame}
 */
export function terrainFrame(t, trees, selection, redraw) {
  const unit = selection.unit ?? 'ms';
  // the line floating over the view says what is hovered, and is there only then: how to move around is in the help
  const info = h('div', {class: 'map-info muted', hidden: true});
  const holder = h('div', {class: 'map-holder'});
  // the line sits at the bottom left, and goes to the corner farthest from the pointer when it comes near it:
  // it hides neither what is hovered nor the slopes around
  holder.addEventListener('pointermove', e => {
    if (info.hidden)
      return;
    const r = info.getBoundingClientRect(), near = 24, gap = 12;
    if (!(e.clientX > r.left - near && e.clientX < r.right + near && e.clientY > r.top - near && e.clientY < r.bottom + near))
      return;
    const s = section.getBoundingClientRect();
    // the panel, when it shows, takes the right of the view
    const edge = dock.hidden ? s.right : dock.getBoundingClientRect().left;
    let best = {right: false, top: false, far: -1};
    for (const right of [false, true])
      for (const top of [false, true]) {
        const left = right ? edge - gap - r.width : s.left + gap, above = top ? s.top + gap : s.bottom - gap - r.height;
        const far = Math.hypot(Math.max(left - e.clientX, 0, e.clientX - (left + r.width)),
                               Math.max(above - e.clientY, 0, e.clientY - (above + r.height)));
        if (far > best.far)
          best = {right, top, far};
      }
    info.classList.toggle('right', best.right);
    info.classList.toggle('top', best.top);
    info.style.right = best.right ? `${s.right - edge + gap}px` : '';
  });
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
    const name = m < 0 ? '' : t.mountains[m].name;
    // the object walked to is kept while the same peak shows, so that changing a
    // setting redraws the view without sending the panel back to the peak
    const same = m >= 0 && selection.chosen === name && selection.subject !== undefined;
    chosen = m;
    selection.chosen = name;
    if (!same)
      selection.subject = m < 0 ? undefined : selection.nodes?.[m];
    dock.hidden = m < 0;
    if (m >= 0)
      render(m);
  };
  /** @param {number} m */
  const render = m => {
    const tree = trees[m];
    const called = selection.callees;
    const holds = selection.holdsAt;
    const subject = selection.subject ?? selection.nodes?.[m] ?? -1;
    /** @param {Frame} f */
    const pick = f => {
      const node = /** @type {{node?: number}} */ (f).node;
      if (node === undefined || node === subject)
        return;
      selection.subject = node;
      render(m);
    };
    /** @type {{id: Tab, label: string}[]} */
    const tabs = holds ? [{id: 'holds', label: 'Holds'}, {id: 'holders', label: 'Held by'}]
      : called ? [{id: 'callers', label: 'Callers'}, {id: 'callees', label: 'Callees'}]
      : [];
    const first = tabs[0]?.id ?? 'callers';
    const tab = tabs.some(x => x.id === selection.tab) ? selection.tab : first;
    /** @param {Tab} to @param {string} label */
    const button = (to, label) => h('button', {type: 'button', class: to === tab ? 'button on' : 'button',
      onclick: () => {
        selection.tab = to;
        render(m);
      }}, label);
    // walked away from the peak: the panel shows another object, and says how to get back
    const shown = subject >= 0 && subject !== selection.nodes?.[m] ? selection.holdsAt?.(subject) : undefined;
    panel.replaceChildren(
      h('div', {class: 'panel-head'},
        helpTip(h('b', null, shown?.name ?? tree.name), 'panel', selection.holdsAt
          ? 'Holds: what the object holds. Held by: who holds it, out to the root. A name clicked shows that object'
          : selection.callees
            ? 'Callers: what called the peak, its slopes. Callees: what it called, and where the time went at the top'
            : 'Who holds the objects of this peak, the heaviest first: the slopes of its mountain'),
        ...shown ? [h('button', {type: 'button', class: 'button', title: 'Back to the peak', onclick: () => {
          selection.subject = selection.nodes?.[m];
          render(m);
        }}, '← peak')] : [],
        h('button', {type: 'button', class: 'button', title: 'Close', onclick: () => {
          choose(-1);
          redraw();
        }}, '×')),
      ...tabs.length > 1 ? [h('div', {class: 'panel-tabs'}, tabs.map(x => button(x.id, x.label)))] : [],
      ...tab === 'callees' && called ? calleesOf(called(tree.name), unit)
        : tab === 'holders' && holds ? heldBy(selection.heldByAt?.(subject), shown ?? tree, unit, pick)
        : shown ? [
          h('div', {class: 'muted'}, `${amount(shown.total, unit)} it holds, the heaviest first:`),
          callersTree(shown, 'holds', unit, {flat: false, onPick: pick}),
        ]
        : [
          h('div', {class: 'muted'}, selection.holds
            ? `${amount(tree.total, unit)} at the top; what it holds, the heaviest first:`
            : `${amount(tree.total, unit)} at the top; its callers, the heaviest first:`),
          ...holdersOf(tree),
          callersTree(tree, selection.holds ? 'holds' : 'callers', unit,
            {flat: !selection.holds, onPick: holds ? pick : undefined}),
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
      info.hidden = n < 0;
      info.replaceChildren(...(n < 0 ? [] : describe(t, children, n, unit, selection.holds === true)));
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
 * @param {boolean} holds the mountains are what their peaks hold, a step being a reference, not a call
 * @returns {Node[]}
 */
function describe(t, children, n, unit, holds) {
  /** @type {number[]} */
  const up = [];
  for (let i = n; i >= 0; i = t.nodes[i].parent)
    up.unshift(i);
  const peak = t.nodes[up[0]];
  // the heaviest way on, to where execution entered; a heap's way on is what the
  // object holds, which the panel lists: the line says who holds it instead
  /** @type {number[]} */
  const on = [];
  for (let i = n; !holds && children[i].length > 0;) {
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
      + `${node.depth} ${holds ? 'reference' : 'call'}${node.depth === 1 ? '' : 's'} down`),
    ...saddle ? [h('div', null, 'A saddle: ', saddle.nodes.map(i => {
      const m = t.mountains[t.nodes[i].mountain];
      return `${amount(t.nodes[i].total, unit)} toward ${short(m.name)}`;
    }).join(', '))] : [],
    // a heap's object first, then who holds it out to the peak, as the panel's "Held by" lists them
    h('ol', {class: 'path'},
      (holds ? [...up].reverse() : up).map(i => row(i, i === n ? 'here' : '')),
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
