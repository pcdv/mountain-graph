// @ts-check
/**
 * The peaks of a profile as a table, with no graphics: each peak's self and
 * total time and its share, the coverage reached peak after peak, and the
 * plain left over.
 */
import {h} from '../lib/dom.js';

/** @typedef {import('../model/peaks.js').Peaks} Peaks */

/**
 * @param {Peaks} r
 * @returns {HTMLElement}
 */
export function peaksView(r) {
  let covered = 0;
  return h('section', {class: 'peaks'},
    h('h3', null, `${r.peaks.length} peaks cover ${percent(r.coverage)} of ${ms(r.total)}`),
    h('p', {class: 'muted'},
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
        r.peaks.map(peak => {
          covered += peak.share;
          return h('tr', null,
            h('td', {class: 'name'}, peak.name),
            h('td', {class: 'num'}, ms(peak.self)),
            h('td', {class: 'num'}, percent(peak.share)),
            h('td', {class: 'num muted'}, percent(covered)),
            h('td', {class: 'num'}, ms(peak.total)));
        }))));
}

/** @param {number} n */
function ms(n) {
  return `${Math.round(n).toLocaleString()} ms`;
}

/** @param {number} share 0 to 1 */
function percent(share) {
  return `${(100 * share).toFixed(1)}%`;
}
