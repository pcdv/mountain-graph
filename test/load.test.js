import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProfile} from '../web/js/load.js';
import {weightOf} from '../web/js/profile/profile.js';

const doc = version => ({
  version,
  weights: [20, 5],
  ...version >= 4 ? {unit: 'ms'} : {},
  start: '2026-10-18T08:00:00Z',
  end: 60_000_000,
  strings: [' Main.run', ' main'],
  stacks: [0, 0 << 3],
  samples: {time: [0, 1000], stack: [0, 0], thread: [0, 0], operation: [-1, -1], kind: [0, 1]},
  threads: [[1, 1]],
  operations: {name: [], start: [], duration: [], thread: [], detail: [], status: [], failed: [], error: [],
               async: [], bytesIn: [], bytesOut: []},
});

const file = (version, name = 'p.json') => new File([JSON.stringify(doc(version))], name);

test('a profile of version 3 loads as one counting time', async () => {
  const p = await loadProfile(file(3));
  assert.equal(p.unit, 'ms');
  assert.equal(p.weight, null);
  assert.deepEqual([weightOf(p, 0), weightOf(p, 1)], [20, 5]);
});

test('a profile of version 4 loads as it is', async () => {
  assert.equal((await loadProfile(file(4))).unit, 'ms');
});

test('another version is refused in words for the user', async () => {
  await assert.rejects(loadProfile(file(2, 'old.json')), /old\.json is a profile of version 2/);
  await assert.rejects(loadProfile(file(5, 'new.json')), /new\.json is a profile of version 5/);
});

test('collapsed stacks load, gzipped or not', async () => {
  const p = await loadProfile(new File(['main;run 3\nmain;work 2\n'], 'a.folded'));
  assert.equal(p.unit, 'samples');
  assert.equal(p.stack.length, 2);
  await assert.rejects(loadProfile(new File(['hello\n'], 'x.txt')), /x\.txt is neither/);
  await assert.rejects(loadProfile(new File(['a 1\nb\n'], 'y.txt')), /y\.txt: Line 2/);
});
