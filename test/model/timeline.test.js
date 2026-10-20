import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, COMPILED} from '../../web/js/profile/profile.js';
import {span, histogram, interval, checked} from '../../web/js/model/timeline.js';

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
