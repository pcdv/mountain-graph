// @ts-check
/**
 * What the weights of a profile count. jfr-web's profiles count time or bytes; a profile of
 * collapsed stacks counts samples, which its format has no room for. Formatted here, so that
 * lib/format.js stays jfr-web's.
 */
import * as fmt from '../lib/format.js';

/** @typedef {'ms' | 'bytes' | 'samples'} Unit */

/**
 * @param {number} v
 * @param {Unit} unit that of a profile
 * @returns {string} e.g. "350 ms", "1.5 MiB", "1,200 samples"
 */
export function amount(v, unit) {
  return unit === 'samples' ? `${Math.round(v).toLocaleString()} samples` : fmt.amount(v, unit);
}
