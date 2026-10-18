// @ts-check
/**
 * The caption of a terrain coloured by package: each package that shows,
 * with its hue, in the order of the wheel, so that the packages of a part of
 * the code stand together. The smallest are counted, not named.
 */
import {h} from '../lib/dom.js';
import {palette, tint, hued} from '../views/palette.js';

/** @typedef {import('../model/hues.js').Hue} Hue */

/** The least share of the land a package named takes. */
const LEAST = 0.01;

/**
 * @param {Hue[]} legend
 * @returns {HTMLElement}
 */
export function hueLegend(legend) {
  const colors = palette();
  // the colour of a slope high up: the hue plain to see
  const slope = tint(colors, 1 / 4, 1);
  const named = legend.filter(e => e.share >= LEAST);
  const rest = legend.length - named.length;
  return h('p', {class: 'hue-legend'},
    named.map(e => h('span', {title: `${e.name}: ${(100 * e.share).toFixed(1)}% of the land`},
      h('i', {style: `background: rgb(${hued(slope, e.hue).join(',')})`}), e.name)),
    rest > 0 ? h('span', {class: 'muted'}, `and ${rest} smaller`) : null);
}
