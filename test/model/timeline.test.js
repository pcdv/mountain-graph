import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, COMPILED} from '../../web/js/profile/profile.js';
import {span, histogram, interval, checked, operations, within} from '../../web/js/model/timeline.js';

// a recording of 4 s with a sample at 0, 1, 1.5 and 3.9 s, 10 ms each
const p = decode({
  version: 4,
  unit: 'ms',
  weights: [10, 10],
  start: '2026-10-20T08:00:00Z',
  end: 4_000_000_000,
  strings: [' app.Work.run', ' main'],
  stacks: [0, 0 << 3 | COMPILED],
  samples: {
    time: [0, 1000, 500, 2400],
    stack: [0, 0, 0, 0],
    thread: [0, 0, 0, 0],
    operation: [-1, -1, -1, -1],
    kind: [0, 0, 0, 0],
  },
  threads: [[1, 1]],
  operations: {name: [], start: [], duration: [], thread: [], detail: [], status: [], failed: [], error: [],
               async: [], bytesIn: [], bytesOut: []},
});

test('the span of a recording, none for collapsed stacks, which have no time', () => {
  assert.equal(span(p), 4000);
  assert.equal(span({...p, start: ''}), 0);
});

test('the weight of the samples per bucket, on a boundary in the later one', () => {
  const {span: ms, ms: buckets} = histogram(p, {all: true}, 4);
  assert.equal(ms, 4000);
  assert.deepEqual([...buckets], [10, 20, 0, 10]);
  assert.deepEqual([...histogram({...p, start: ''}, {all: true}, 4).ms], []);
});

test('a selection as an interval in seconds, whichever way it was dragged', () => {
  assert.deepEqual(interval(0.25, 0.75, 4000), {from: 1, to: 3});
  assert.deepEqual(interval(0.75, 0.25, 4000), {from: 1, to: 3});
  assert.deepEqual(interval(0, 0.5, 4000), {to: 2}, 'from the start: no from');
  assert.deepEqual(interval(0.5, 1, 4000), {from: 2}, 'up to the end: no to');
});

test('an empty selection, or all the recording, is no interval', () => {
  assert.equal(interval(0.5, 0.5, 4000), null);
  assert.equal(interval(-1, 2, 4000), null, 'dragged past both ends');
  assert.deepEqual(interval(-1, 0.5, 4000), {to: 2}, 'dragged past the start');
});

test('an interval kept is trusted only if it is a part of the recording', () => {
  assert.deepEqual(checked({from: 1, to: 3}, 4000), {from: 1, to: 3});
  assert.deepEqual(checked({to: 2}, 4000), {to: 2});
  assert.deepEqual(checked({from: 2, junk: 1}, 4000), {from: 2}, 'nothing else kept');
  for (const bad of [null, undefined, 3, 'x', {}, {from: 3, to: 1}, {from: 2, to: 2}, {from: -1}, {to: 5}, {from: '1'},
                     {from: 4}])
    assert.equal(checked(bad, 4000), null, JSON.stringify(bad));
  assert.equal(checked({from: 1}, 0), null, 'a recording with no time');
});

// operations op0 to op9, op k with 10 - k samples of 10 ms, in the first second; two samples outside any, in the last
const ops = (() => {
  const names = Array.from({length: 10}, (_, k) => `op${k}`);
  const operation = [], time = [];
  names.forEach((_, k) => {
    for (let j = 0; j < 10 - k; j++)
      operation.push(k), time.push(10);
  });
  operation.push(-1, -1);
  time.push(3500 - time.reduce((a, b) => a + b, 0), 0);
  return decode({
    version: 4,
    unit: 'ms',
    weights: [10, 10],
    start: '2026-10-20T08:00:00Z',
    end: 4_000_000_000,
    strings: [' app.Work.run', ' main', ...names.map(n => ' ' + n)],
    stacks: [0, 0 << 3 | COMPILED],
    samples: {time, stack: operation.map(() => 0), thread: operation.map(() => 0), operation, kind: operation.map(() => 0)},
    threads: [[1, 1]],
    operations: {name: names.map((_, k) => k + 2), start: names.map(() => 0), duration: names.map(() => 0),
                 thread: names.map(() => 0), detail: names.map(() => -1), status: names.map(() => 0),
                 failed: names.map(() => 0), error: names.map(() => -1), async: names.map(() => 0),
                 bytesIn: names.map(() => 0), bytesOut: names.map(() => 0)},
  });
})();

test('the weight per bucket by operation: the heaviest by name, the others together, then none', () => {
  const r = operations(ops, {all: true}, 4);
  assert.deepEqual(r.series.map(s => `${s.name} ${s.total}`),
                   ['op0 100', 'op1 90', 'op2 80', 'op3 70', 'op4 60', 'op5 50', 'op6 40', 'op7 30']);
  assert.deepEqual([...r.series[0].ms], [100, 0, 0, 0]);
  assert.deepEqual([...r.other], [30, 0, 0, 0], 'op8 and op9');
  assert.deepEqual([...r.none], [0, 0, 0, 20], 'the two samples outside any operation');
  const all = histogram(ops, {all: true}, 4).ms;
  for (let b = 0; b < 4; b++)
    assert.equal(r.series.reduce((sum, s) => sum + s.ms[b], r.other[b] + r.none[b]), all[b], `bucket ${b} adds up`);
});

test('no series of the others, nor of none, when there are none; nothing without operations', () => {
  const few = decode({
    version: 4, unit: 'ms', weights: [10, 10], start: '2026-10-20T08:00:00Z', end: 4_000_000_000,
    strings: [' app.Work.run', ' main', ' op0'], stacks: [0, 0 << 3 | COMPILED],
    samples: {time: [0, 100], stack: [0, 0], thread: [0, 0], operation: [0, 0], kind: [0, 0]},
    threads: [[1, 1]],
    operations: {name: [2], start: [0], duration: [0], thread: [0], detail: [-1], status: [0], failed: [0], error: [-1],
                 async: [0], bytesIn: [0], bytesOut: [0]},
  });
  const r = operations(few, {all: true}, 4);
  assert.equal(r.series.length, 1);
  assert.equal(r.other, null);
  assert.equal(r.none, null);
  assert.equal(operations(p, {all: true}, 4), null, 'a recording with no operations');
});

test('the weight within an interval: the buckets it covers, the edge ones in proportion', () => {
  const ms = Float64Array.of(10, 20, 30, 40);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  near(within(ms, 0, 1), 100);
  near(within(ms, 0.25, 0.75), 50);
  near(within(ms, 0.125, 0.375), 10 / 2 + 20 / 2);
  near(within(ms, 0.9, 1), 40 * 0.4);
  near(within(ms, 0.5, 0.5), 0);
  near(within(new Float64Array(0), 0, 1), 0);
});
