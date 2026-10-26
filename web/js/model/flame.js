// @ts-check
/**
 * A flame graph's layout: each frame a box as wide as its time, its callees
 * on the level above. The same layout is drawn on a page (views/flame.js)
 * and, later, on a plane in the 3D world.
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * A frame laid out.
 *
 * @typedef {object} Box
 * @property {Frame} frame
 * @property {Box | null} parent
 * @property {number} level 0 for the root
 * @property {number} left in the unit of the profile, from the left of the root
 */

/**
 * @typedef {object} Flame
 * @property {Box} root
 * @property {Box[][]} levels the boxes of each level, from the left
 */

/**
 * @param {Frame} root
 * @returns {Flame} the boxes of the tree, the children of a frame side by side in its width
 */
export function layout(root) {
  /** @type {Box[][]} */
  const levels = [];
  /**
   * @param {Frame} frame
   * @param {Box | null} parent
   * @param {number} level
   * @param {number} left
   * @returns {Box}
   */
  const place = (frame, parent, level, left) => {
    const box = {frame, parent, level, left};
    (levels[level] ??= []).push(box);
    let x = left;
    for (const c of frame.children) {
      place(c, box, level + 1, x);
      x += c.total;
    }
    return box;
  };
  return {root: place(root, null, 0, 0), levels};
}

/**
 * @param {Flame} flame
 * @param {Box | null} zoomed the box filling the width, null for the root
 * @returns {{from: number, span: number}} the range shown, from the left of the root
 */
export function range(flame, zoomed) {
  const z = zoomed ?? flame.root;
  return {from: z.left, span: z.frame.total || 1};
}

/**
 * @param {Flame} flame
 * @param {Box | null} zoomed
 * @param {number} x where, from 0 at the left of the range shown to 1 at its right
 * @param {number} level
 * @returns {Box | null} the box there
 */
export function pick(flame, zoomed, x, level) {
  const boxes = flame.levels[level];
  if (!boxes || x < 0 || x >= 1)
    return null;
  const {from, span} = range(flame, zoomed);
  const at = from + x * span;
  // the boxes are sorted by their left, the widest zoom is over thousands
  let lo = 0, hi = boxes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, b = boxes[mid];
    if (at < b.left)
      hi = mid - 1;
    else if (at >= b.left + b.frame.total)
      lo = mid + 1;
    else
      return b;
  }
  return null;
}

/**
 * @param {Box} box
 * @returns {string[]} the names from the root's children down to the box; empty for the root
 */
export function pathOf(box) {
  /** @type {string[]} */
  const names = [];
  for (let b = box; b.parent; b = b.parent)
    names.unshift(b.frame.name);
  return names;
}

/**
 * @param {Flame} flame
 * @param {string[]} path as pathOf gives it
 * @returns {Box | null} the box on that path, if the tree still has it
 */
export function follow(flame, path) {
  let b = flame.root;
  for (const name of path) {
    const parent = b;
    const next = flame.levels[b.level + 1]?.find(c => c.parent === parent && c.frame.name === name);
    if (!next)
      return null;
    b = next;
  }
  return b;
}

/**
 * @param {Flame} flame
 * @param {Box} box
 * @returns {number} the deepest level a callee of the box reaches, its own if it has none
 */
export function deepest(flame, box) {
  const end = box.left + box.frame.total;
  let level = box.level;
  // its callees are in its width, on each level up to the deepest
  while (flame.levels[level + 1]?.some(b => b.left >= box.left && b.left < end && b.frame.total > 0))
    level++;
  return level;
}

/**
 * @param {Flame} flame
 * @param {RegExp} pattern
 * @returns {number} the weight of the frames matching, each counted once: not again under a match
 */
export function matched(flame, pattern) {
  /** @param {Frame} f @returns {number} */
  const sum = f => pattern.test(f.name) ? f.total : f.children.reduce((s, c) => s + sum(c), 0);
  return sum(flame.root.frame);
}
