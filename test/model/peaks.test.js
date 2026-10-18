import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, COMPILED, NO_OPERATION} from '../../web/js/profile/profile.js';
import {peaks, mountains} from '../../web/js/model/peaks.js';

// strings: 0 "A.a", 1 "B.b", 2 "C.c", 3 "Main.run", 4 "java.util.HashMap.get", 5 "main"
const strings = ['A.a', 'B.b', 'C.c', 'Main.run', 'java.util.HashMap.get', 'main'];
const f = string => string << 3 | COMPILED;

// nodes, depth first: 0 Main.run, 1 > A.a, 2 > A.a > HashMap.get, 3 > B.b,
// 4 > B.b > A.a, 5 > C.c
const p = decode({
  version: 3,
  weights: [10, 1],
  start: '2026-10-18T08:00:00Z',
  end: 1_000_000,
  // not front-coded: no string shares a prefix with the previous one
  strings: strings.map(s => ' ' + s),
  stacks: [0, f(3), 1, f(0), 2, f(4), 1, f(1), 2, f(0), 1, f(2)],
  samples: {
    // A.a 3 times, once called by B.b; HashMap.get under A.a twice; B.b once;
    // C.c once; Main.run once; one sample with no stack
    time: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    stack: [1, 1, 4, 2, 2, 3, 5, 0, -1],
    thread: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    operation: [-1, -1, -1, -1, -1, -1, -1, -1, -1],
    kind: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  threads: [[5, 1]],
  operations: {name: [], start: [], duration: [], thread: [], detail: [], status: [], failed: [], error: [],
               async: [], bytesIn: [], bytesOut: []},
});

const all = {all: true};

/** @param {import('../../web/js/model/peaks.js').Peak[]} list */
const names = list => list.map(peak => `${peak.name} ${peak.self} ${peak.total}`);

test('the most self time first; peaks and plain add up to all the samples', () => {
  const r = peaks(p, all);
  assert.deepEqual(names(r.peaks), ['A.a 30 50', 'java.util.HashMap.get 20 20', 'Main.run 10 80',
                                    'B.b 10 20', 'C.c 10 10']);
  assert.equal(r.total, 90);
  assert.equal(r.plain, 10);
  assert.equal(r.bare, 10, 'the sample with no stack');
  assert.equal(r.coverage, 80 / 90);
  assert.equal(r.peaks[0].share, 30 / 90);
});

test('as many peaks as asked, the others in the plain', () => {
  const r = peaks(p, all, {count: 2});
  assert.deepEqual(names(r.peaks), ['A.a 30 50', 'java.util.HashMap.get 20 20']);
  assert.equal(r.plain, 40);
  assert.equal(r.bare, 10);
  assert.equal(r.coverage, 50 / 90);
});

test('no more peaks once the coverage asked is reached', () => {
  assert.equal(peaks(p, all, {coverage: 0.5}).peaks.length, 2, '30 + 20 of 90 reach half');
  assert.equal(peaks(p, all, {coverage: 0.3}).peaks.length, 1);
});

test('hidden frames give their self time to their callers', () => {
  const r = peaks(p, {...all, hide: '^java\\.'});
  assert.deepEqual(names(r.peaks), ['A.a 50 50', 'Main.run 10 80', 'B.b 10 20', 'C.c 10 10']);
  assert.equal(r.plain, 10);
});

test('no samples: no peaks, nothing covered', () => {
  const r = peaks(p, {thread: 'none'});
  assert.deepEqual(r, {peaks: [], plain: 0, bare: 0, coverage: 0, total: 0});
});

test('a stack all hidden: no method at the top, bare', () => {
  const r = peaks(p, {...all, hide: '.'});
  assert.deepEqual(r.peaks, []);
  assert.equal(r.bare, 90);
});

/** A tree as lines "path total", the root first. */
function lines(t, prefix = '') {
  const path = prefix ? `${prefix};${t.name}` : t.name;
  return [`${path} ${t.total}`, ...t.children.flatMap(c => lines(c, path))];
}

test('a mountain: the peak, its callers down to the thread where execution entered', () => {
  const r = peaks(p, all, {count: 2});
  const m = mountains(p, all, r.peaks);
  assert.deepEqual([...m.keys()], ['A.a', 'java.util.HashMap.get']);
  assert.deepEqual(lines(m.get('A.a')), [
    'A.a 30',
    'A.a;B.b 10',
    'A.a;B.b;Main.run 10',
    'A.a;B.b;Main.run;[main tid=1] 10',
    `A.a;B.b;Main.run;[main tid=1];${NO_OPERATION} 10`,
    'A.a;Main.run 20',
    'A.a;Main.run;[main tid=1] 20',
    `A.a;Main.run;[main tid=1];${NO_OPERATION} 20`,
  ]);
  assert.equal(m.get('A.a').total, r.peaks[0].self);
});

test('a mountain with frames hidden: their callers in their place', () => {
  const filter = {...all, hide: '^java\.'};
  const m = mountains(p, filter, peaks(p, filter, {count: 1}).peaks);
  assert.deepEqual(lines(m.get('A.a')).slice(0, 3), ['A.a 50', 'A.a;B.b 10', 'A.a;B.b;Main.run 10']);
  assert.equal(m.get('A.a').total, 50);
});
