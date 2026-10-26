// @ts-check
/**
 * The context of a peak: instead of gathering every object of a class into one
 * peak, gather the objects a class holds. A path root→…→holder→object becomes
 * root→…→"object ← holder", so the peak names the cluster and the holders left
 * over stay as its callers.
 *
 * No DOM: tested with Node.
 */
import {FOLD} from '../profile/heap.js';

/**
 * @param {Map<string, number>} stacks path → weight, root first, object last
 * @param {number} context how many frames make a peak: 1 the object's class
 *        alone, 2 the class with its holder, 3 with its holder's holder…
 * @returns {Map<string, number>} the stacks with each tail gathered into one frame
 */
export function contextStacks(stacks, context) {
  if (context <= 1)
    return stacks;
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const [path, size] of stacks) {
    const frames = path.split(';');
    const n = Math.min(context, frames.length);
    // what a reduction folded away makes no peak: an end with a fold in it is
    // the fold, as an end with no class at the top
    const fold = frames.lastIndexOf(FOLD);
    if (fold >= frames.length - n) {
      const key = frames.slice(0, fold + 1).join(';');
      out.set(key, (out.get(key) ?? 0) + size);
      continue;
    }
    // the object first, then the holders outward: "SynchronizedMap ← Store"
    const label = frames.slice(-n).reverse().join(' ← ');
    const kept = frames.slice(0, frames.length - n);
    const key = [...kept, label].join(';');
    out.set(key, (out.get(key) ?? 0) + size);
  }
  return out;
}
