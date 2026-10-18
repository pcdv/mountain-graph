// @ts-check
/**
 * A hue for each frame of a terrain, from its package: the packages that
 * branch first share the colour wheel, each sub-package takes a part of its
 * parent's share, so that the packages of a part of the code have hues near
 * each other, and those of unrelated libraries distinct ones. Each share is
 * as large as what shows of the package on the terrain: the hues go where
 * the land is. A package with a single sub-package passes it its whole
 * share: a chain of them (com.example.server) keeps one hue.
 *
 * The caption names the root packages only, those whose hues stand apart:
 * where each chain from the top first branches or has frames of its own,
 * past a leading domain (com, org).
 *
 * No DOM: tested with Node.
 */

/** @typedef {import('./terrain.js').Terrain} Terrain */
/** @typedef {import('./peaks.js').Grain} Grain */

/** The part of its share a package gives its sub-packages: the rest keeps neighbours apart. */
const SPREAD = 0.7;

/** First parts of package names that are a domain, not a root package. */
const DOMAINS = new Set(['com', 'org', 'net', 'io', 'edu', 'gov', 'dev', 'app', 'co', 'me', 'eu',
                         'fr', 'de', 'uk', 'ch', 'it', 'nl', 'be', 'es', 'us', 'jp', 'cn', 'ru']);

/**
 * A root package as the caption names it.
 *
 * @typedef {object} Hue
 * @property {string} name of the package
 * @property {number} hue 0 to 1: its sub-packages' are near
 * @property {number} share of the cells of the land in a package that its frames take, those of
 *           its sub-packages included
 */

/**
 * @param {Terrain} t
 * @param {Grain} grain what its peaks gather: a peak is a method, a class or a package
 * @returns {{hues: Float64Array, legend: Hue[]}} per node, its hue from 0 to 1, NaN for a frame in
 *          no package (a thread); and the root packages that show, in the order of the wheel
 */
export function packageHues(t, grain) {
  const packages = t.nodes.map(n => n.depth === 0 && grain === 'package' ? n.name
                                    : packageOf(n.depth === 0 && grain === 'class' ? n.name + '.x' : n.name));

  // the cells of each package's frames: what of it shows
  /** @type {Map<string, number>} */
  const area = new Map();
  for (const n of t.cells)
    if (n >= 0 && packages[n])
      area.set(packages[n], (area.get(packages[n]) ?? 0) + 1);

  /**
   * @typedef {object} Pkg
   * @property {Map<string, Pkg>} children
   * @property {number} area its cells and its sub-packages', a package hidden under others counted
   *           as one: it still has a hue
   * @property {number} shows its cells and its sub-packages'
   * @property {boolean} own whether frames are in it, not only in sub-packages
   * @property {number} hue
   */
  /** @returns {Pkg} */
  const pkg = () => ({children: new Map(), area: 0, shows: 0, own: false, hue: NaN});
  const root = pkg();
  for (const p of new Set(packages))
    if (p) {
      const shows = area.get(p) ?? 0, a = Math.max(1, shows);
      let at = root;
      at.area += a;
      at.shows += shows;
      for (const part of p.split('.')) {
        let next = at.children.get(part);
        if (!next)
          at.children.set(part, next = pkg());
        at = next;
        at.area += a;
        at.shows += shows;
      }
      at.own = true;
    }

  /** @param {Pkg} pkg @param {number} from @param {number} to its share of the wheel */
  const share = (pkg, from, to) => {
    pkg.hue = (from + to) / 2;
    const children = [...pkg.children.keys()].sort().map(name => /** @type {Pkg} */ (pkg.children.get(name)));
    // each a part as large as what shows of it; all of it to a single one, else less, apart
    const spread = children.length === 1 ? 1 : SPREAD;
    let at = from;
    for (const c of children) {
      const width = (to - from) * c.area / pkg.area, middle = at + width / 2;
      share(c, middle - width * spread / 2, middle + width * spread / 2);
      at += width;
    }
  };
  share(root, 0, 1);

  /** @type {Map<string, number>} */
  const hues = new Map();
  for (const p of new Set(packages))
    if (p) {
      let at = root;
      for (const part of p.split('.'))
        at = /** @type {Pkg} */ (at.children.get(part));
      hues.set(p, wrap(at.hue));
    }

  /** @type {Hue[]} in the order of the wheel: that of the children */
  const legend = [];
  /** @param {Pkg} at @param {string} name @param {number} depth */
  const roots = (at, name, depth) => {
    const past = depth >= (DOMAINS.has(name.split('.')[0]) ? 2 : 1);
    if (past && (at.own || at.children.size !== 1)) {
      if (at.shows > 0)
        legend.push({name, hue: wrap(at.hue), share: at.shows / root.shows});
      return;
    }
    for (const part of [...at.children.keys()].sort())
      roots(/** @type {Pkg} */ (at.children.get(part)), name ? `${name}.${part}` : part, depth + 1);
  };
  roots(root, '', 0);
  return {hues: Float64Array.from(packages, p => p ? /** @type {number} */ (hues.get(p)) : NaN), legend};
}

/** @param {number} hue @returns {number} on the wheel, 0 to 1 */
function wrap(hue) {
  return ((hue % 1) + 1) % 1;
}

/**
 * @param {string} method a frame's name: package, class, method
 * @returns {string} its package, '' for none
 */
export function packageOf(method) {
  const dot = method.lastIndexOf('.');
  // the outer class of an inner one, or of a lambda (Outer$$Lambda.0x12.test)
  const cls = dot > 0 ? method.substring(0, dot).split('$')[0] : '';
  const pkg = cls.lastIndexOf('.');
  return pkg > 0 ? cls.substring(0, pkg) : '';
}
