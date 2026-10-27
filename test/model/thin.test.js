// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {readJfr} from '../../web/js/profile/jfr.js';
import {readCollapsed} from '../../web/js/profile/collapsed.js';
import {decode, tree, weightOf} from '../../web/js/profile/profile.js';
import {encodeSamples} from '../../web/js/profile/encode.js';
import {peaks} from '../../web/js/model/peaks.js';
import {thin, THIN, LEVELS} from '../../web/js/model/thin.js';

/** @typedef {import('../../web/js/profile/profile.js').Profile} Profile */
/** @typedef {import('../../web/js/profile/profile.js').Frame} Frame */

/** @param {Profile} p @param {import('../../web/js/model/thin.js').Thinning} level */
const thinned = (p, level) => decode(JSON.parse(JSON.stringify(encodeSamples(thin(p, level)))));

/**
 * @param {Frame} root
 * @param {number} least
 * @returns {Map<string, number>} the frames of a flame graph at least that wide, by path
 */
function wide(root, least) {
  /** @type {Map<string, number>} */
  const out = new Map();
  /** @param {Frame} f @param {string} path */
  const walk = (f, path) => {
    if (f.total < least)
      return;
    out.set(path, f.total);
    for (const c of f.children)
      walk(c, `${path};${c.name}`);
  };
  walk(root, '');
  return out;
}

describe('thin', () => {
  // a hot method called from many paths, each seen once; a method hardly run, down paths of their own;
  // and one as rare, called from a wide frame
  const lines = ['main;work;hot 400', 'main;work;wide;rare 1', 'main;work;wide 400'];
  for (let i = 0; i < 100; i++)
    lines.push(`main;caller${i};hot 1`, `main;other${i};cold${i} 1`);
  const p = readCollapsed(lines.join('\n'));

  /**
   * @param {Profile} q
   * @param {string[]} names of the frames from main up
   * @returns {Frame | undefined}
   */
  const at = (q, ...names) => {
    // a collapsed profile's tree is rooted by operation, then thread
    let f = tree(q, {all: true}).root.children[0].children[0];
    for (const name of names)
      f = f?.children.find(c => c.name === name);
    return f;
  };

  it('gathers the stacks thin both ways, and only those', () => {
    const q = thinned(p, {least: 0.01});
    const top = Array.from(q.stack, s => q.strings[q.frame[s] >>> 3]);
    // cold's and rare's: each under 1%, and so is its method
    assert.equal(top.filter(name => name === THIN).length, 101);
    // hot's thin paths stay: hot runs enough
    assert.equal(top.filter(name => name === 'hot').length, 101);
    assert.equal(tree(q, {all: true}).root.total, tree(p, {all: true}).root.total);
    assert.ok(!q.strings.some(s => /^(cold|other)\d|^rare$/.test(s)));
  });

  it('cuts a thin stack at its deepest caller wide enough', () => {
    const q = thinned(p, {least: 0.01});
    // the paths to cold are thin from main up; rare's is from wide up
    assert.equal(at(q, 'main', THIN)?.total, 100);
    assert.equal(at(q, 'main', 'work', 'wide', THIN)?.total, 1);
    assert.equal(at(q, 'main', 'work', 'wide')?.total, 401);
  });

  for (const [i, level] of LEVELS.entries()) {
    it(`keeps every sample's time, the wide frames and the peaks of a recording, at level ${i}`, () => {
      const {wall} = readJfr(gunzipSync(readFileSync(new URL('../fixtures/work.jfr.gz', import.meta.url))));
      assert.ok(wall);
      const q = thinned(wall, level);

      assert.deepEqual([...q.time], [...wall.time]);
      assert.deepEqual(Array.from(q.stack, (_, j) => weightOf(q, j)), Array.from(wall.stack, (_, j) => weightOf(wall, j)));
      const before = tree(wall, {all: true}).root, after = tree(q, {all: true}).root;
      const least = level.least * before.total;
      for (const [path, total] of wide(before, least))
        assert.equal(wide(after, least).get(path), total, path);
      for (const grain of /** @type {const} */ (['method', 'class', 'package'])) {
        const kept = peaks(q, {all: true}, {grain}).peaks.filter(peak => peak.self >= least);
        assert.deepEqual(kept, peaks(wall, {all: true}, {grain}).peaks.filter(peak => peak.self >= least), grain);
      }
    });
  }
});
