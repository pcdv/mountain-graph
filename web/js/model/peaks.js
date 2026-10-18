// @ts-check
/**
 * The peaks of a profile: the methods its samples ran in most, or their
 * classes or packages, each the top of a mountain. A sample has one top
 * frame, so it belongs to one peak at most: the peaks and the plain (the
 * samples whose top is no peak) add up to all the samples kept, and the
 * peaks' share of them is the coverage.
 *
 * No DOM: tested with Node.
 */
import {tree, mainType, SYNTHETIC} from '../profile/profile.js';

/** @typedef {import('../profile/profile.js').Profile} Profile */
/** @typedef {import('../profile/profile.js').Filter} Filter */
/** @typedef {import('../profile/profile.js').Frame} Frame */

/**
 * What a peak gathers: a method, the methods of a class (its inner classes
 * with it), or those of a package. CPU time is scattered over many methods:
 * gathered, fewer peaks hold more of it.
 *
 * @typedef {'method' | 'class' | 'package'} Grain
 */

/**
 * @typedef {object} Peak
 * @property {string} name of the method, class or package
 * @property {number} self ms of the samples it ran in, at the top of the stack: its mountain
 * @property {number} total ms of the samples it was anywhere in
 * @property {number} share its self time over that of all the samples kept, 0 to 1
 */

/**
 * @typedef {object} Peaks
 * @property {Peak[]} peaks the most self time first
 * @property {number} plain ms of the samples whose top frame is no peak, those with no method
 *           at the top included
 * @property {number} bare ms of the plain's samples with no method at the top: no stack, or all
 *           its frames hidden (a thread running only JDK code, with the JDK hidden)
 * @property {number} coverage the share of the time the peaks hold, 0 to 1
 * @property {number} total ms of all the samples kept
 */

/**
 * @typedef {object} PeakOptions
 * @property {number} [count] the most peaks to take, 10 by default
 * @property {number} [coverage] a share of the time, 0 to 1: no more peaks are taken once the
 *           ones taken hold it; 1 by default, taking count peaks
 * @property {Grain} [grain] what a peak gathers, a method by default
 */

/**
 * What a method belongs to at a grain: "a.b.C$D.run" is in class "a.b.C" and
 * package "a.b". A name that is not a qualified method (a native library, a
 * hidden class) is its own class, and its own package.
 *
 * @param {string} name of the method
 * @param {Grain} grain
 * @returns {string}
 */
export function owner(name, grain) {
  if (grain === 'method')
    return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0)
    return name;
  const cls = name.substring(0, dot);
  const dollar = cls.indexOf('$');
  const outer = dollar > 0 ? cls.substring(0, dollar) : cls;
  if (grain === 'class')
    return outer;
  const pkg = outer.lastIndexOf('.');
  return pkg > 0 ? outer.substring(0, pkg) : outer;
}

/**
 * The methods, classes or packages with the most self time, as peaks: as many
 * as count, fewer when those taken already reach the coverage asked or
 * nothing else ran.
 *
 * @param {Profile} p
 * @param {Filter} filter the samples kept, and the frames hidden: their time goes to the first
 *        frame under them that is not
 * @param {PeakOptions} [options]
 * @returns {Peaks}
 */
export function peaks(p, filter, {count = 10, coverage = 1, grain = 'method'} = {}) {
  const {root} = tree(p, {...filter, merged: true, reversed: false});
  const total = root.total;
  /** @type {Map<string, Peak>} */
  const all = new Map();
  /** @type {Set<string>} the peaks on the path walked, to count a sample's total once */
  const on = new Set();
  let bare = 0;
  /** @param {Frame} f */
  const walk = f => {
    let entered = '';
    if (f === root || mainType(f) === SYNTHETIC)
      bare += f.self;
    else {
      const name = owner(f.name, grain);
      let peak = all.get(name);
      if (!peak)
        all.set(name, peak = {name, self: 0, total: 0, share: 0});
      peak.self += f.self;
      if (!on.has(name)) {
        peak.total += f.total;
        on.add(entered = name);
      }
    }
    f.children.forEach(walk);
    if (entered)
      on.delete(entered);
  };
  walk(root);

  const sorted = [...all.values()].sort((a, b) => b.self - a.self || b.total - a.total
                                                  || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  /** @type {Peak[]} */
  const taken = [];
  let self = 0;
  for (const peak of sorted) {
    if (taken.length >= count || peak.self <= 0 || (total > 0 && self / total >= coverage))
      break;
    taken.push({...peak, share: total > 0 ? peak.self / total : 0});
    self += peak.self;
  }
  return {peaks: taken, plain: total - self, bare, coverage: total > 0 ? self / total : 0, total};
}

/**
 * The mountains of peaks: each the tree of the samples that ran in the peak,
 * its callers as children and so on down to where execution entered, the
 * operation (or the thread, for the samples outside operations) last. Its
 * total is the peak's self time. A class's or package's mountain has its
 * methods that ran as children, their callers under them.
 *
 * @param {Profile} p
 * @param {Filter} filter that the peaks were found with
 * @param {Peak[]} list
 * @param {Grain} [grain] that the peaks were found with
 * @returns {Map<string, Frame>} by the name of the peak
 */
export function mountains(p, filter, list, grain = 'method') {
  const names = new Set(list.map(peak => peak.name));
  // its children are the methods at the top of the samples, and the operations
  // of those with no method at the top, left out
  const {root} = tree(p, {...filter, reversed: true});
  /** @type {Map<string, Frame[]>} */
  const tops = new Map();
  for (const f of root.children) {
    if (mainType(f) === SYNTHETIC)
      continue;
    const name = owner(f.name, grain);
    if (names.has(name))
      tops.set(name, [...tops.get(name) ?? [], f]);
  }
  return new Map([...tops].map(([name, methods]) => [name, grain === 'method' ? methods[0] : {
    name,
    total: methods.reduce((sum, f) => sum + f.total, 0),
    self: 0,
    types: methods.reduce((types, f) => types.map((t, i) => t + f.types[i]), methods[0].types.map(() => 0)),
    children: methods,
  }]));
}
