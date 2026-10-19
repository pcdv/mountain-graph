// @ts-check
/**
 * The peaks of a profile as a table, with no graphics: each peak's self and
 * total time and its share, the coverage reached peak after peak, and the
 * plain left over. A peak clicked shows its mountain under it: its callers,
 * down to where execution entered.
 */
import {h} from '../lib/dom.js';
import {callersTree} from '../components/callers.js';
import {amount} from '../lib/format.js';

/** @typedef {import('../model/peaks.js').Peaks} Peaks */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * @param {Peaks} r
 * @param {Map<string, Frame>} mountains by the name of the peak
 * @param {Set<string>} open the names of the peaks whose mountain shows, kept up to date as they
 *        are clicked: the same set given again keeps them open when the table is drawn again
 * @param {number} [left] ms of the samples left out before, as waits
 * @param {'ms' | 'bytes'} [unit] what the weights count, as the profile tells
 * @returns {HTMLElement}
 */
export function peaksView(r, mountains, open, left = 0, unit = 'ms') {
  /** @param {number} n */
  const ms = n => amount(n, unit);
  let covered = 0;
  return h('section', {class: 'peaks'},
    h('h3', null, `${r.peaks.length} peaks cover ${percent(r.coverage)} of ${ms(r.total)}`),
    h('p', {class: 'muted'},
      left > 0 ? `Left out as waits: ${ms(left)}. ` : '',
      `The plain: ${ms(r.plain)} (${percent(r.total > 0 ? r.plain / r.total : 0)}), `
      + `${ms(r.bare)} of it with no method at the top.`),
    h('table', null,
      h('thead', null,
        h('tr', null,
          h('th', null, 'Peak'),
          h('th', {class: 'num'}, 'Self'),
          h('th', {class: 'num'}, 'Share'),
          h('th', {class: 'num'}, 'Covered'),
          h('th', {class: 'num'}, 'Total'))),
      h('tbody', null,
        r.peaks.flatMap(peak => {
          covered += peak.share;
          const mountain = mountains.get(peak.name);
          const cell = h('td', {colspan: 5});
          const below = h('tr', {class: 'mountain'}, cell);
          const show = () => {
            below.hidden = !open.has(peak.name);
            if (!below.hidden && mountain && !cell.firstChild)
              cell.append(callersTree(mountain, 'callers', unit));
          };
          show();
          const row = h('tr', {class: 'peak', title: 'Its callers', onclick: () => {
            if (!open.delete(peak.name))
              open.add(peak.name);
            show();
            row.classList.toggle('open', !below.hidden);
          }},
            h('td', {class: 'name'}, peak.name),
            h('td', {class: 'num'}, ms(peak.self)),
            h('td', {class: 'num'}, percent(peak.share)),
            h('td', {class: 'num muted'}, percent(covered)),
            h('td', {class: 'num'}, ms(peak.total)));
          row.classList.toggle('open', !below.hidden);
          return [row, below];
        }))));
}


/** @param {number} share 0 to 1 */
function percent(share) {
  return `${(100 * share).toFixed(1)}%`;
}
