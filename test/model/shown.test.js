import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, tree, COMPILED, NATIVE} from '../../web/js/profile/profile.js';
import {leaveOut, WAITS} from '../../web/js/model/samples.js';
import {shown, leavesOut} from '../../web/js/model/shown.js';
import {encodeSamples} from '../../web/js/profile/encode.js';

const strings = ['app.Server.loop', 'app.Work.run', 'main', 'sun.nio.ch.WEPoll.wait', 'java.util.HashMap.get',
                 'app.Other.go', 'poller', 'GET /x'];

/**
 * nodes, depth first as the format has them (depth, string, type):
 *   0 Server.loop; 1 > HashMap.get; 2 > > Work.run; 3 > WEPoll.wait; 4 > Work.run; 5 Other.go; 6 > HashMap.get
 * samples, a second apart: Work.run through HashMap.get, Work.run direct (in an operation when there is one),
 * a wait, HashMap.get under Other.go, HashMap.get under Server.loop, no stack
 *
 * @param {boolean} [withOperation]
 */
function profile(withOperation = false) {
  const nodes = [[0, 0, COMPILED], [1, 4, COMPILED], [2, 1, COMPILED], [1, 3, NATIVE], [1, 1, COMPILED],
                 [0, 5, COMPILED], [1, 4, COMPILED]];
  return decode({
    version: 4,
    unit: 'ms',
    weights: [10, 20],
    start: '2026-10-18T08:00:00Z',
    end: 6_000_000_000,
    strings: strings.map(s => ' ' + s),
    stacks: nodes.flatMap(([parent, string, type]) => [parent, string << 3 | type]),
    samples: {
      time: [0, 1000, 1000, 1000, 1000, 1000],
      stack: [2, 4, 3, 6, 1, -1],
      thread: [0, 0, 1, 0, 0, 0],
      operation: withOperation ? [-1, 0, -1, -1, -1, -1] : [-1, -1, -1, -1, -1, -1],
      kind: [0, 0, 1, 0, 0, 0],
    },
    threads: [[2, 1], [6, 2]],
    operations: withOperation
      ? {name: [7], start: [1000], duration: [10], thread: [0], detail: [-1], status: [0], failed: [0], error: [-1],
         async: [0], bytesIn: [0], bytesOut: [0]}
      : {name: [], start: [], duration: [], thread: [], detail: [], status: [], failed: [], error: [], async: [],
         bytesIn: [], bytesOut: []},
  });
}

const none = {waits: '', hide: '', java: false};
const JDK = String.raw`^(java|javax|jdk|sun|com\.sun)\.`;

/** What the page draws of a profile with a view's settings: the flame graph of its samples. */
function drawn(p, {waits, hide, java, from, to, operation}) {
  const only = operation ? {all: false, name: operation} : {all: true};
  const {root, samples} = tree(leaveOut(p, waits).profile, {...only, hide, java, from, to});
  return JSON.stringify({root, samples});
}

test('a view that leaves nothing out shows the profile itself', () => {
  const p = profile();
  assert.equal(shown(p, none), p);
  assert.equal(shown(p, {...none, hide: 'nothing of the kind'}), p, 'a frame to hide that no stack has');
  assert.equal(shown(p, {...none, waits: '('}), p, 'an invalid expression hides nothing');
});

test('the waits are left out, and the thread that waited goes with them', () => {
  const p = profile();
  const q = shown(p, {...none, waits: WAITS});
  assert.deepEqual([...q.time], [0, 1000, 3000, 4000, 5000]);
  assert.deepEqual(q.threads.map(t => t.name), ['main']);
  assert.deepEqual([...q.thread], [0, 0, 0, 0, 0]);
});

test('the native samples go when only Java is shown; an interval keeps the samples inside it', () => {
  const p = profile();
  assert.deepEqual([...shown(p, {...none, java: true}).kind], [0, 0, 0, 0, 0]);
  assert.deepEqual([...shown(p, {...none, from: 1, to: 4}).time], [1000, 2000, 3000]);
  assert.deepEqual([...shown(p, {...none, from: 4}).time], [4000, 5000]);
  assert.deepEqual([...shown(p, {...none, to: 1}).time], [0]);
});

test('the frames hidden are out of the stacks, their time with their callers, and the stacks that meet are one', () => {
  const p = profile();
  const q = shown(p, {...none, hide: JDK});
  const names = [...q.stack].map(n => {
    const path = [];
    for (; n >= 0; n = q.parent[n])
      path.unshift(q.strings[q.frame[n] >>> 3]);
    return path.join(' > ');
  });
  // the wait is in sun.*, hidden too: its time is Server.loop's
  assert.deepEqual(names, ['app.Server.loop > app.Work.run', 'app.Server.loop > app.Work.run',
                           'app.Server.loop', 'app.Other.go', 'app.Server.loop', '']);
  assert.equal(q.stack[0], q.stack[1], 'Work.run through the hidden frame and direct is one node');
});

test('what a view saves draws as the view drew it: the flame graph is the same', () => {
  for (const operation of [false, true]) {
    const p = profile(operation);
    for (const view of [
      {...none, hide: JDK},
      {...none, waits: WAITS},
      {...none, java: true},
      {...none, from: 1, to: 4},
      {waits: WAITS, hide: JDK, java: true, from: 1},
      {waits: WAITS, hide: JDK, java: false, to: 5},
      ...operation ? [{...none, operation: 'GET /x'}, {waits: WAITS, hide: JDK, java: true, operation: 'GET /x'}] : [],
    ])
      assert.equal(drawn(shown(p, view), none), drawn(p, view), JSON.stringify(view));
  }
});

test('an operation keeps its samples only, and the threads stay when operations refer to them', () => {
  const p = profile(true);
  const q = shown(p, {...none, operation: 'GET /x'});
  assert.deepEqual([...q.time], [1000]);
  assert.equal(q.threads, p.threads);
  assert.equal(q.operations, p.operations);
  assert.deepEqual([...shown(p, {...none, operation: 'GET /y'}).time], []);
});

test('the weights of the samples kept follow them', () => {
  const p = {...profile(), weight: Float64Array.from([1, 2, 3, 4, 5, 6])};
  assert.deepEqual([...shown(p, {...none, from: 1, to: 4}).weight], [2, 3, 4]);
});

test('what is shown is a profile that can be written, and gives what the view drew', () => {
  const p = profile();
  const view = {waits: WAITS, hide: JDK, java: true};
  const doc = encodeSamples(shown(p, view), {kind: 'wall'});
  const back = decode(JSON.parse(JSON.stringify(doc)));
  assert.equal(drawn(back, none), drawn(p, view));
  assert.ok(!JSON.stringify(doc).includes('WEPoll'), 'the wait is not in the file');
  assert.ok(!JSON.stringify(doc).includes('poller'), 'nor the thread that waited');
  assert.ok(!JSON.stringify(doc).includes('HashMap'), 'nor the frame hidden');
});

test('what a view leaves out, in words', () => {
  assert.deepEqual(leavesOut(none), []);
  assert.deepEqual(leavesOut({waits: WAITS, hide: JDK, java: true, from: 1, operation: 'GET /x'}),
                   ['the waits', 'the hidden frames', 'the native samples', 'what is outside the interval',
                    'what is outside the operation']);
  assert.deepEqual(leavesOut({...none, waits: '('}), [], 'an invalid expression leaves nothing out');
});
