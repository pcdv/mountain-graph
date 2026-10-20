import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadProfiles} from '../web/js/load.js';
import {readFileSync} from 'node:fs';
import {weightOf, tree, ALLOCATED} from '../web/js/profile/profile.js';

/** The profile of a file with a single sampling. */
async function loadProfile(file) {
  const samplings = await loadProfiles(file);
  assert.equal(samplings.length, 1);
  return samplings[0].profile;
}

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

// recorded from fixtures/Work.java for 2.5 s with the profile settings (JDK 21), then reduced with `jfr scrub`
// to the samples: 160 execution, 17 native and 778 allocation ones, by `jfr summary`
const recording = () => new File([readFileSync(new URL('./fixtures/work.jfr.gz', import.meta.url))], 'work.jfr.gz');

test('a recording, gzipped: a sampling per kind of samples', async () => {
  const [wall, alloc, ...others] = await loadProfiles(recording());
  assert.deepEqual(others, []);
  assert.deepEqual([wall.key, wall.label, alloc.key, alloc.label], ['wall', 'Wall clock', 'alloc', 'Allocations']);
  assert.equal(wall.profile.unit, 'ms');
  assert.equal(wall.profile.stack.length, 160 + 17);
  assert.equal(wall.profile.weights[0], 10, 'the period asked of the sampler');
  assert.equal(alloc.profile.unit, 'bytes');
  assert.equal(alloc.profile.stack.length, 778);
});

test('a recording: the work of the program, by method', async () => {
  const [{profile: wall}, {profile: alloc}] = await loadProfiles(recording());
  // the main thread spends its time in these two methods, or in what they call
  const {root} = tree(wall, {all: true, merged: true, java: true});
  const main = root.children[0].children.find(t => t.name.startsWith('[main'));
  const find = (f, name) => f.name === name ? f : f.children.map(c => find(c, name)).find(Boolean);
  const spin = find(main, 'Work.spin'), allocate = find(main, 'Work.allocate');
  assert.ok(spin.total > 0 && allocate.total > 0);
  assert.ok(spin.total + allocate.total >= 0.9 * main.total, 'nearly all of the main thread');

  // bytes allocated: byte[] arrays, under Work.allocate
  const bytes = tree(alloc, {all: true, merged: true}).root;
  const arrays = find(bytes, 'byte[]');
  assert.equal(arrays.types[ALLOCATED], arrays.total);
  assert.ok(arrays.total > 1e6);
  assert.ok(find(bytes, 'Work.allocate').total >= arrays.total * 0.5);
});

test('a recording that is cut is refused, naming the file', async () => {
  await assert.rejects(loadProfiles(new File([Uint8Array.from([0x46, 0x4c, 0x52, 0, 0, 2])], 'cut.jfr')),
                       /cut\.jfr: /);
});

test('collapsed stacks load, gzipped or not', async () => {
  const p = await loadProfile(new File(['main;run 3\nmain;work 2\n'], 'a.folded'));
  assert.equal(p.unit, 'samples');
  assert.equal(p.stack.length, 2);
  await assert.rejects(loadProfile(new File(['hello\n'], 'x.txt')), /x\.txt is neither/);
  await assert.rejects(loadProfile(new File(['a 1\nb\n'], 'y.txt')), /y\.txt: Line 2/);
});
