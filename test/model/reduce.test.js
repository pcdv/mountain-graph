// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {reduce, compare, LEVELS} from '../../web/js/model/reduce.js';
import {stacksToProfile, FOLD} from '../../web/js/profile/heap.js';
import {SYNTHETIC} from '../../web/js/profile/profile.js';

/**
 * A heap as a dump gives it: a cache and a queue holding most of the memory,
 * down paths of a few holders, and a root holding hundreds of small classes,
 * each object its own bytes.
 */
function heap() {
  /** @type {Map<string, number>} */
  const bytes = new Map(), objects = new Map();
  /** @param {string} path @param {number} size */
  const add = (path, size) => {
    bytes.set(path, size);
    objects.set(path, 1 + (size >> 6));
  };
  add('Java Frame', 100);
  add('Java Frame;com.example.Server', 200);
  add('Java Frame;com.example.Server;com.example.Cache', 300);
  add('Java Frame;com.example.Server;com.example.Cache;java.util.HashMap', 400);
  for (let i = 0; i < 200; i++) {
    const node = `Java Frame;com.example.Server;com.example.Cache;java.util.HashMap;java.util.HashMap$Node${i % 20}`;
    add(node, 50 + i);
    add(`${node};entry${i}.cache.Entry`, 80);
    add(`${node};entry${i}.cache.Entry;byte[]`, 1000 + 7 * i);
    add(`${node};entry${i}.cache.Entry;java.lang.String`, 40);
  }
  add('Java Frame;com.example.Worker;java.util.ArrayDeque;java.lang.Object[]', 9000);
  for (let i = 0; i < 100; i++) {
    add(`Java Frame;com.example.Worker;java.util.ArrayDeque;java.lang.Object[];com.example.Task${i % 10};byte[]`, 300 + i);
    add(`Java Frame;com.example.Worker;java.util.ArrayDeque;java.lang.Object[];com.example.Task${i % 10}`, 30);
  }
  // a package is what holds a class's package, as the page reads a frame: lib3 for lib3.util.Helper
  for (let i = 0; i < 300; i++) {
    add(`System Class;lib${i}.util.Helper`, 10 + i % 13);
    add(`System Class;lib${i}.util.Helper;java.lang.String`, 24);
  }
  return stacksToProfile(bytes, objects);
}

/** @param {import('../../web/js/profile/heap.js').HeapProfile} p */
function deepest(p) {
  let most = 0;
  for (let i = 0; i < p.parent.length; i++) {
    let d = 0;
    for (let j = i; p.parent[j] >= 0; j = p.parent[j])
      d++;
    most = Math.max(most, d);
  }
  return most;
}

/** @param {Float64Array | null | undefined} a */
const sum = a => (a ?? []).reduce((x, y) => x + y, 0);

describe('reduce', () => {
  for (const [level, loss] of LEVELS.entries()) {
    it(`keeps every byte and object, and the peaks where they were, at level ${level}`, () => {
      const p = heap(), r = reduce(p, loss);

      assert.equal(sum(r.weight), sum(p.weight));
      assert.equal(sum(r.objects), sum(p.objects));
      for (const d of compare(p, r, loss)) {
        assert.equal(d.moved, 0, d.view);
        assert.equal(d.self, 0, d.view);
        assert.equal(d.depths, 0, d.view);
      }
    });
  }

  it('gets smaller, folding into synthetic frames, no path longer than it was', () => {
    const p = heap(), r = reduce(p, LEVELS[1]);

    assert.ok(r.parent.length < p.parent.length * 2 / 3, `${r.parent.length} nodes of ${p.parent.length}`);
    assert.ok(deepest(r) <= deepest(p));
    const folds = [...r.frame].filter(f => r.strings[f >>> 3] === FOLD);
    assert.ok(folds.length > 0);
    assert.ok(folds.every(f => (f & 7) === SYNTHETIC));
  });

  it('draws as the whole with nothing to lose', () => {
    const p = heap();
    const loss = {least: 3e-4, peaks: 100, context: 5, totals: true, together: false, strays: false};

    for (const d of compare(p, reduce(p, loss), loss))
      assert.deepEqual({...d, ridges: 0}, {view: d.view, moved: 0, self: 0, total: 0, depths: 0, ridges: 0,
                                            missing: 0, added: 0, worst: 0});
  });
});
