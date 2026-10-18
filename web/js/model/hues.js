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
 * No DOM: tested with Node.
 */

/** @typedef {import('./terrain.js').Terrain} Terrain */
/** @typedef {import('./peaks.js').Grain} Grain */

/** The part of its share a package gives its sub-packages: the rest keeps neighbours apart. */
const SPREAD = 0.7;

/**
 * A package as the caption names it.
 *
 * @typedef {object} Hue
 * @property {string} name of the package
 * @property {number} hue 0 to 1
 * @property {number} share of the cells of the land in a package that its frames take
 */

/**
 * @param {Terrain} t
 * @param {Grain} grain what its peaks gather: a peak is a method, a class or a package
 * @returns {{hues: Float64Array, legend: Hue[]}} per node, its hue from 0 to 1, NaN for a frame in
 *          no package (a thread); and the packages that show, in the order of the wheel
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

  /** @typedef {{children: Map<string, Pkg>, area: number, hue: number}} Pkg */
  /** @type {Pkg} */
  const root = {children: new Map(), area: 0, hue: NaN};
  for (const p of new Set(packages))
    if (p) {
      // at least a cell: a package hidden under others still has a hue
      const a = Math.max(1, area.get(p) ?? 0);
      let at = root;
      at.area += a;
      for (const part of p.split('.')) {
        let next = at.children.get(part);
        if (!next)
          at.children.set(part, next = {children: new Map(), area: 0, hue: NaN});
        at = next;
        at.area += a;
      }
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

  /** @type {Map<string, number>} unwrapped: in the order of the wheel */
  const hues = new Map();
  for (const p of new Set(packages))
    if (p) {
      let at = root;
      for (const part of p.split('.'))
        at = /** @type {Pkg} */ (at.children.get(part));
      hues.set(p, at.hue);
    }
  const land = [...area.values()].reduce((s, a) => s + a, 0);
  return {
    hues: Float64Array.from(packages, p => p ? wrap(/** @type {number} */ (hues.get(p))) : NaN),
    legend: [...area].map(([name, a]) => ({name, hue: /** @type {number} */ (hues.get(name)), share: a / land}))
                     .sort((a, b) => a.hue - b.hue)
                     .map(e => ({...e, hue: wrap(e.hue)})),
  };
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
