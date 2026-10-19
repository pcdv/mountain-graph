import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, COMPILED, NATIVE} from '../../web/js/profile/profile.js';
import {leaveOut, WAITS} from '../../web/js/model/samples.js';

// strings: 0 "app.Server.loop", 1 "app.Work.run", 2 "main", 3 "sun.nio.ch.WEPoll.wait"
const strings = ['app.Server.loop', 'app.Work.run', 'main', 'sun.nio.ch.WEPoll.wait'];

// nodes: 0 Server.loop, 1 > WEPoll.wait, 2 Work.run
const p = decode({
  version: 4,
  unit: 'ms',
  weights: [10, 20],
  start: '2026-10-18T08:00:00Z',
  end: 1_000_000,
  strings: strings.map(s => ' ' + s),
  stacks: [0, 0 << 3 | COMPILED, 1, 3 << 3 | NATIVE, 0, 1 << 3 | COMPILED],
  samples: {
    // waiting, working, waiting, no stack, working
    time: [0, 10, 10, 10, 10],
    stack: [1, 2, 1, -1, 2],
    thread: [0, 0, 0, 0, 0],
    operation: [-1, -1, -1, -1, -1],
    kind: [1, 0, 1, 0, 0],
  },
  threads: [[2, 1]],
  operations: {name: [], start: [], duration: [], thread: [], detail: [], status: [], failed: [], error: [],
               async: [], bytesIn: [], bytesOut: []},
});

test('the samples waiting left out, by their top frame; the others kept, in order', () => {
  const {profile, left} = leaveOut(p, WAITS);
  assert.equal(left, 40);
  assert.deepEqual([...profile.stack], [2, -1, 2]);
  assert.deepEqual([...profile.time], [10, 30, 40]);
  assert.deepEqual([...profile.kind], [0, 0, 0]);
  assert.equal(profile.strings, p.strings, 'the rest shared');
});

test('a frame under the top does not count: a server loop that waits is not a wait', () => {
  assert.equal(leaveOut(p, 'Server').left, 0);
});

test('no pattern, or an invalid one: the profile itself', () => {
  assert.equal(leaveOut(p, '').profile, p);
  assert.equal(leaveOut(p, '(').profile, p);
  assert.equal(leaveOut(p, 'nothing').profile, p);
});
