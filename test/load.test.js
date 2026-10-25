import {test, describe} from 'node:test';
import assert from 'node:assert/strict';
import {loadFile, loadParse} from '../web/js/load.js';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {weightOf, tree, ALLOCATED} from '../web/js/profile/profile.js';
import {encode} from '../web/js/profile/heap.js';
import {parseWithJheap} from '../web/js/hprof/jheap.js';
import {HprofBuilder} from './hprof/hprof-builder.js';

/** The samplings of a file of samples. */
async function loadProfiles(file) {
  const loaded = await loadFile(file);
  assert.equal(loaded.kind, 'samples');
  return loaded.samplings;
}

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

// recorded by fixtures/OpsWork.java (JDK 21): 51 operations, alpha 30, beta 20 and an asynchronous gamma, in 90
// execution samples. jfr-web's export of the same file has the same operations and the same samples in each
test('a recording with operations: each sample in the operation its thread was running', async () => {
  const [{profile: p}] = await loadProfiles(new File([readFileSync(new URL('./fixtures/ops.jfr.gz', import.meta.url))],
                                                     'ops.jfr.gz'));
  assert.equal(p.operations.count, 51);
  const per = new Map();
  for (const op of p.operation) {
    const name = op < 0 ? '(none)' : p.strings[p.operations.name[op]];
    per.set(name, (per.get(name) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...per].sort()), {'(none)': 9, alpha: 19, beta: 13, gamma: 49});
  const names = [...Array(p.operations.count).keys()].map(i => p.strings[p.operations.name[i]]);
  assert.equal(names.filter(n => n === 'alpha').length, 30);
  const gamma = names.indexOf('gamma');
  assert.equal(p.operations.async[gamma], 1);
  assert.equal(p.strings[p.operations.detail[gamma]], 'async');
  assert.equal(p.strings[p.operations.thread[names.indexOf('alpha')]], 'alpha-thread');
  // rooted by operation, as jfr-web's flame graphs are
  const {root} = tree(p, {});
  assert.deepEqual(root.children.map(c => c.name).sort(), ['alpha', 'beta', 'gamma']);
});

test('a recording that is cut is refused, naming the file', async () => {
  await assert.rejects(loadProfiles(new File([Uint8Array.from([0x46, 0x4c, 0x52, 0, 0, 2])], 'cut.jfr')),
                       /cut\.jfr: /);
});

test('collapsed stacks load, gzipped or not', async () => {
  const p = await loadProfile(new File(['main;run 3\nmain;work 2\n'], 'a.folded'));
  assert.equal(p.unit, 'samples');
  assert.equal(p.stack.length, 2);
  assert.equal((await loadProfile(new File([gzipSync('main;run 3\n')], 'a.folded.gz'))).stack.length, 1);
  await assert.rejects(loadProfile(new File(['hello\n'], 'x.txt')), /x\.txt is none of what this page reads/);
  await assert.rejects(loadProfile(new File(['a 1\nb\n'], 'y.txt')), /y\.txt: Line 2/);
});

const module = new WebAssembly.Module(readFileSync(new URL('../web/js/hprof/jheap.wasm', import.meta.url)));

/**
 * A dump as the page is given it, which fails the test if the page ever reads
 * it whole: a dump of gigabytes does not fit in the page.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {File}
 */
function picked(bytes, name) {
  const file = new File([bytes], name);
  const whole = () => {
    throw new Error('the whole file was read');
  };
  return Object.assign(file, {arrayBuffer: whole, stream: whole, text: whole, bytes: whole});
}

/**
 * jheap's parse in this thread, as the page's worker does it, reading the
 * bytes the test made: Node reads no `File` synchronously.
 *
 * @param {Uint8Array} bytes
 * @returns {import('../web/js/hprof/dump.js').Parser}
 */
const inThread = bytes => (file, onProgress) => parseWithJheap(module, {
  size: file.size,
  name: file.name,
  onProgress,
  readAt: (offset, into) => {
    const part = bytes.subarray(offset, offset + into.length);
    into.set(part);
    return part.length;
  },
});

const dump = new HprofBuilder()
  .string(0x100, 'java/lang/String')
  .loadClass(0x200, 0x100)
  .classDump({classId: 0x200})
  .instance(0x300, 0x200)
  .rootUnknown(0x300)
  .build();

/** A heap loaded from a file: the kind is checked. */
async function loadHeap(file, options) {
  const loaded = await loadFile(file, options);
  assert.equal(loaded.kind, 'heap');
  return loaded;
}

describe('a heap dump', () => {
  test('is parsed with jheap, and the page says what it read', async () => {
    const {heap: {profile, stats}, parse} = await loadHeap(picked(dump, 'heap.hprof'), {parse: inThread(dump)});

    assert.equal(stats.report?.instanceCount, 1);
    assert.equal(stats.totalSize, 8);
    assert.equal(stats.objectCount, 1, 'the instance, not its class');
    assert.deepEqual([...profile.strings].filter(s => s).sort(), ['Unknown', 'all', 'java.lang.String']);
    assert.equal(parse.name, 'heap.hprof');
  });

  test('is shown again from the parse kept of it, without parsing', async () => {
    const {parse} = await loadHeap(picked(dump, 'heap.hprof'), {parse: inThread(dump)});
    const kept = structuredClone(parse);

    const {profile, stats} = loadParse(kept);

    assert.equal(stats.report?.instanceCount, 1);
    assert.equal(profile.stack.length, 1);
  });

  test('has its names anonymized as samples have', async () => {
    const anonymous = {enabled: true, packages: false, depth: 2, keep: [], replace: [{from: 'String', to: 'Text'}]};
    const {heap: {profile}} = await loadHeap(picked(dump, 'heap.hprof'), {parse: inThread(dump), anonymous});

    assert.ok(profile.strings.includes('java.lang.Text'));
    assert.ok(profile.objects, 'the objects of each path stay');
  });

  test('opens from the parse jheap keeps beside it, with its report, without parsing', async () => {
    const {heap: parsed} = await loadHeap(picked(dump, 'heap.hprof'), {parse: inThread(dump)});
    const kept = JSON.stringify({...encode(parsed.profile), heap: {report: parsed.stats.report}});
    const parse = () => assert.fail('a profile is not parsed');

    const {heap: {profile, stats}, parse: none} = await loadHeap(new File([kept], 'heap.jheap.json'), {parse});

    assert.equal(stats.report?.instanceCount, 1);
    assert.equal(stats.totalSize, 8);
    assert.equal(profile.stack.length, parsed.profile.stack.length);
    assert.equal(none, null, 'the file is kept, not a parse');
  });

  test('opens from a profile the page exported, without a report: what it can count, it does', async () => {
    const {heap: parsed} = await loadHeap(picked(dump, 'heap.hprof'), {parse: inThread(dump)});
    const saved = JSON.stringify(encode(parsed.profile));

    const {heap: {stats}} = await loadHeap(new File([saved], 'heap.profile.json'));

    assert.equal(stats.report, null);
    assert.equal(stats.totalSize, 8);
    assert.equal(stats.objectCount, 1);
  });

  test('gzipped, is not read here: the page says what reads it', async () => {
    await assert.rejects(loadFile(new File([gzipSync(dump)], 'heap.hprof.gz')),
      /heap\.hprof\.gz is a gzipped heap dump, which the page cannot read: .*jheap.* heap\.jheap\.json/);
  });

  test('cut short, says what jheap says of it', async () => {
    const cut = dump.subarray(0, dump.length - 5);
    await assert.rejects(loadFile(picked(cut, 'cut.hprof'), {parse: inThread(cut)}), /Truncated file/);
  });
});
