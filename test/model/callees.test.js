import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decode, COMPILED, NO_OPERATION} from '../../web/js/profile/profile.js';
import {callees, kindOf} from '../../web/js/model/callees.js';


// strings: 0 "A.a", 1 "B.b", 2 "C.c", 3 "Main.run", 4 "java.util.HashMap.get", 5 "main"
const strings = ['A.a', 'B.b', 'C.c', 'Main.run', 'java.util.HashMap.get', 'main'];
const f = string => string << 3 | COMPILED;

// nodes, depth first: 0 Main.run, 1 > A.a, 2 > A.a > HashMap.get, 3 > B.b,
// 4 > B.b > A.a, 5 > C.c
const p = decode({
  version: 4,
  unit: 'ms',
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

test('callees: what a peak called, hidden frames shown, and what ran at the top', () => {
  // A.a, called by Main.run and by B.b, ran HashMap.get twice: hidden, its time is A.a's
  const hide = {all: true, hide: '^java\.'};
  const {tree, tops} = callees(p, hide, 'A.a');
  assert.equal(tree.name, 'A.a');
  assert.equal(tree.total, 50);
  assert.deepEqual(tree.children.map(c => `${c.name} ${c.total}`), ['java.util.HashMap.get 20']);
  assert.deepEqual(tops.map(t => `${t.name} ${t.ms}`), ['A.a 30', 'java.util.HashMap.get 20']);
  // by kind, or else by package: A.a has none
  assert.deepEqual(callees(p, hide, 'A.a').groups.map(g => `${g.name} ${g.ms}`), ['A 30', 'collections 20']);
  // B.b: A.a above it
  assert.deepEqual(callees(p, hide, 'B.b').tree.children.map(c => `${c.name} ${c.total}`), ['A.a 10']);
  // by class: its methods first
  assert.deepEqual(callees(p, hide, 'A', 'class').tree.children.map(c => c.name), ['A.a']);
});

test('the kind of work of well known frames', () => {
  assert.equal(kindOf('java.util.zip.Deflater.deflateBytes'), 'compression');
  assert.equal(kindOf('sun.nio.ch.SocketDispatcher.write0'), 'network write');
  assert.equal(kindOf('jdk.internal.misc.Unsafe.park'), 'lock');
  assert.equal(kindOf('sun.nio.fs.WindowsNativeDispatcher.FindFirstFile0'), 'file I/O');
  assert.equal(kindOf('java.lang.invoke.DirectMethodHandle$Holder.invokeVirtual'), 'reflection');
  assert.equal(kindOf('com.sun.org.apache.xerces.internal.util.SymbolTable.addSymbol'), 'XML');
  assert.equal(kindOf('java.util.HashMap.getNode'), 'collections');
  assert.equal(kindOf('A.a'), '');
});
