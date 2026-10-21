import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isJfr, readJfr, javaName} from '../../web/js/profile/jfr.js';
import {weightOf, tree, COMPILED, INTERPRETED, ALLOCATED, SYNTHETIC} from '../../web/js/profile/profile.js';

// A recording written by hand, as the JDK does: chunks of an event for the types, constant pools and samples.

/** @param {number} n @returns {number[]} compressed: 7 bits at a time, the lowest first; the ninth byte whole */
function int(n) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    if (n < 0x80) {
      out.push(n);
      return out;
    }
    out.push(n % 0x80 | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return out;
}

/** @param {string} s */
const str = s => {
  const b = [...new TextEncoder().encode(s)];
  return [3, ...int(b.length), ...b];
};

/** An event: its size, which counts its own bytes, then its type and fields. */
function event(type, ...fields) {
  const body = [...int(type), ...fields.flat()];
  for (let size = 1; ; size++)
    if (int(body.length + size).length === size)
      return [...int(body.length + size), ...body];
}

const LONG = 1, INT = 2, BOOLEAN = 3, STRING = 4, SYMBOL = 10, CLASS = 11, METHOD = 12, FRAME_TYPE = 13,
      FRAME = 14, STACK = 15, THREAD = 16, EXECUTION = 20, ALLOCATION = 21, SETTING = 22, CHECKPOINT = 1,
      FLAK_REQUEST = 23, OPERATION = 24, SEGMENT = 25;

/** [name, id, fields: [name, type, pool?, dimension?]] */
const types = [
  ['long', LONG, []], ['int', INT, []], ['boolean', BOOLEAN, []], ['java.lang.String', STRING, []],
  ['jdk.types.Symbol', SYMBOL, [['string', STRING]]],
  ['java.lang.Class', CLASS, [['name', SYMBOL, true]]],
  ['jdk.types.Method', METHOD, [['type', CLASS, true], ['name', SYMBOL, true]]],
  ['jdk.types.FrameType', FRAME_TYPE, [['description', STRING]]],
  ['jdk.types.StackFrame', FRAME, [['method', METHOD, true], ['lineNumber', INT], ['type', FRAME_TYPE, true]]],
  ['jdk.types.StackTrace', STACK, [['truncated', BOOLEAN], ['frames', FRAME, false, 1]]],
  ['java.lang.Thread', THREAD, [['osName', STRING], ['javaName', STRING], ['javaThreadId', LONG]]],
  ['jdk.ExecutionSample', EXECUTION, [['startTime', LONG], ['sampledThread', THREAD, true],
                                      ['stackTrace', STACK, true]]],
  ['jdk.ObjectAllocationSample', ALLOCATION, [['startTime', LONG], ['eventThread', THREAD, true],
                                              ['stackTrace', STACK, true], ['objectClass', CLASS, true],
                                              ['weight', LONG]]],
  ['jdk.ActiveSetting', SETTING, [['startTime', LONG], ['id', LONG], ['name', STRING], ['value', STRING]]],
  ['flak.Request', FLAK_REQUEST, [['startTime', LONG], ['duration', LONG], ['eventThread', THREAD, true], ['app', STRING],
                                  ['method', STRING], ['route', STRING], ['path', STRING], ['status', INT],
                                  ['bytesIn', LONG], ['bytesOut', LONG]]],
  ['jfrweb.Operation', OPERATION, [['startTime', LONG], ['duration', LONG], ['eventThread', THREAD, true], ['id', LONG],
                                   ['name', STRING], ['detail', STRING], ['async', BOOLEAN], ['failed', BOOLEAN],
                                   ['error', STRING], ['bytesIn', LONG], ['bytesOut', LONG]]],
  ['jfrweb.OperationSegment', SEGMENT, [['startTime', LONG], ['duration', LONG], ['eventThread', THREAD, true],
                                        ['id', LONG]]],
];

/** A string kept in the pool of strings, as an event or a pool refers to it. */
const pooled = key => [2, ...int(key)];

/** The metadata event: a table of strings, then the tree of elements naming each by an index in it. */
function metadata() {
  const strings = [];
  const index = s => {
    let i = strings.indexOf(s);
    if (i < 0)
      i = strings.push(s) - 1;
    return i;
  };
  const element = (name, attributes = {}, children = []) =>
    [...int(index(name)), ...int(Object.keys(attributes).length),
     ...Object.entries(attributes).flatMap(([k, v]) => [...int(index(k)), ...int(index(String(v)))]),
     ...int(children.length), ...children.flat()];
  const root = element('root', {}, [element('metadata', {}, types.map(([name, id, fields]) =>
    element('class', {name, id}, fields.map(([n, type, pool, dimension]) =>
      element('field', {name: n, class: type, ...pool ? {constantPool: 'true'} : {}, ...dimension ? {dimension} : {}})))))]);
  return event(0, int(0), int(0), int(0), int(strings.length), strings.flatMap(str), root);
}

/** A checkpoint: pools of type id, with their entries by key. */
function pools(...list) {
  return event(CHECKPOINT, int(0), int(0), int(0), [0], int(list.length),
               list.flatMap(([type, entries]) => [...int(type), ...int(entries.length),
                                                  ...entries.flatMap(([key, ...fields]) => [...int(key), ...fields.flat()])]));
}

/**
 * One chunk. Ticks are ns: a sample at ms is at 1000 + ms * 1e6 ticks.
 *
 * @param {object} o
 * @param {number} o.start ns since the epoch
 * @param {string} o.app the class of the methods
 * @param {number[][]} o.exec [ms, stack key, thread key (1 by default)]
 * @param {number[][]} [o.events] other events, as event() writes them
 * @param {number[][]} [o.alloc] [ms, stack key, class key, bytes]
 * @param {string} [o.period]
 */
function chunk({start, app, exec, alloc = [], events = [], period = '10 ms', duration = 1e9}) {
  const ticks = ms => int(1000 + ms * 1e6);
  const body = [
    ...pools(
      [SYMBOL, [[1, str(app)], [2, str('run')], [3, str('work')], [4, str('[B')]]],
      [CLASS, [[1, int(1)], [2, int(4)]]],
      [METHOD, [[1, int(1), int(2)], [2, int(1), int(3)]]],
      [FRAME_TYPE, [[1, str('Interpreted')], [2, str('JIT compiled')]]],
      // top frame first, as JFR lists them: work under run; the second trace is cut
      [STACK, [[1, [0], int(2), int(2), int(0), int(2), int(1), int(0), int(1)],
               [2, [1], int(1), int(2), int(0), int(2)]]],
      [THREAD, [[1, [1], str('main'), int(7)], [2, [1], str('worker'), int(8)], [3, [1], pooled(9), int(9)]]],
      // strings that events and pools refer to by their key
      [STRING, [[7, str('GET')], [8, str('/app')], [9, str('pooled-thread')], [10, str('/user/:id')],
                [11, str('/app/user/42')]]]),
    ...event(SETTING, int(0), int(EXECUTION), str('enabled'), str('true')),
    ...event(SETTING, int(0), int(EXECUTION), str('period'), str(period)),
    ...exec.flatMap(([ms, stack, thread = 1]) => event(EXECUTION, ticks(ms), int(thread), int(stack))),
    ...events.flatMap(e => e(ticks)),
    ...alloc.flatMap(([ms, stack, cls, bytes]) => event(ALLOCATION, ticks(ms), int(1), int(stack), int(cls), int(bytes))),
  ];
  const meta = metadata();
  const header = new Uint8Array(68);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x464c5200);
  view.setUint16(4, 2);
  view.setBigInt64(8, BigInt(68 + body.length + meta.length));
  view.setBigInt64(24, BigInt(68 + body.length));
  view.setBigInt64(32, BigInt(start));
  view.setBigInt64(40, BigInt(duration));
  view.setBigInt64(48, 1000n);
  view.setBigInt64(56, 1_000_000_000n);
  view.setInt32(64, 1);
  return [...header, ...body, ...meta];
}

const T0 = 1_760_000_000_000_000_000;

test('told by its first bytes', () => {
  assert.equal(isJfr(Uint8Array.from(chunk({start: T0, app: 'a/A', exec: []}))), true);
  assert.equal(isJfr(new TextEncoder().encode('{"version":4}')), false);
});

test('execution samples: stacks from the root, the type of each frame, the weight of a sample', () => {
  const {wall} = readJfr(Uint8Array.from(chunk({start: T0, app: 'app/Main', exec: [[0, 1], [10, 1], [30, 2]]})));
  assert.equal(wall.unit, 'ms');
  assert.equal(wall.stack.length, 3);
  assert.deepEqual([...wall.time], [0, 10, 30]);
  assert.equal(wall.weights[0], 10, 'the period of the settings');
  assert.deepEqual(wall.threads, [{name: 'main', id: 7}]);
  assert.equal(wall.start, new Date(T0 / 1e6).toISOString());

  const {root} = tree(wall, {all: true, merged: true});
  const thread = root.children[0].children[0];
  assert.equal(thread.total, 30);
  const truncated = thread.children.find(f => f.name === '(truncated)');
  assert.equal(truncated.total, 10, 'a cut stack starts under (truncated)');
  const run = thread.children.find(f => f.name === 'app.Main.run');
  assert.equal(run.total, 20);
  assert.equal(run.types[INTERPRETED], 20);
  const work = run.children[0];
  assert.deepEqual([work.name, work.total, work.self, work.types[COMPILED]], ['app.Main.work', 20, 20, 20]);
});

test('allocation samples: where, then the class allocated, weighing bytes', () => {
  const {alloc} = readJfr(Uint8Array.from(chunk({start: T0, app: 'app/Main', exec: [[0, 1]],
                                                  alloc: [[5, 1, 2, 100], [6, 1, 2, 50]]})));
  assert.equal(alloc.unit, 'bytes');
  assert.deepEqual([0, 1].map(i => weightOf(alloc, i)), [100, 50]);
  const {root} = tree(alloc, {all: true, merged: true});
  assert.equal(root.total, 150);
  let f = root;
  while (f.children.length)
    f = f.children[0];
  assert.equal(f.name, 'byte[]', 'the class, as Java writes it');
  assert.equal(f.types[ALLOCATED], 150);
  assert.notEqual(f.type, SYNTHETIC);
});

test('without allocation samples, none; without execution samples, none', () => {
  assert.equal(readJfr(Uint8Array.from(chunk({start: T0, app: 'a/A', exec: [[0, 1]]}))).alloc, null);
  assert.equal(readJfr(Uint8Array.from(chunk({start: T0, app: 'a/A', exec: [], alloc: [[0, 1, 2, 8]]}))).wall, null);
});

test('chunks: their pools their own, the times counted from the first', () => {
  const second = chunk({start: T0 + 2e9, app: 'app/Other', exec: [[5, 1]]});
  const {wall} = readJfr(Uint8Array.from([...chunk({start: T0, app: 'app/Main', exec: [[0, 1]], duration: 2e9}), ...second]));
  assert.deepEqual([...wall.time], [0, 2005]);
  assert.equal(wall.threads.length, 1, 'the same thread in both');
  const names = wall.strings.filter(s => s.startsWith('app.'));
  assert.deepEqual(names.sort(), ['app.Main.run', 'app.Main.work', 'app.Other.run', 'app.Other.work']);
  assert.equal(wall.end, 3e9);
});

test('not a recording it reads: said in words', () => {
  assert.throws(() => readJfr(new TextEncoder().encode('hello')), /Not a JFR recording/);
  const cut = Uint8Array.from(chunk({start: T0, app: 'a/A', exec: [[0, 1]]})).subarray(0, 100);
  assert.throws(() => readJfr(cut), /cut/);
});

test('class names as Java writes them', () => {
  assert.equal(javaName('java/lang/String'), 'java.lang.String');
  assert.equal(javaName('[B'), 'byte[]');
  assert.equal(javaName('[[I'), 'int[][]');
  assert.equal(javaName('[Ljava/lang/Object;'), 'java.lang.Object[]');
});

// the events of operations, at ms: a thread key, then what the event holds
/** @param {number} ms @param {number} length @param {number} thread @param {number} id @param {string} name @param {boolean} [async] */
const operation = (ms, length, thread, id, name, async = false) => ticks =>
  event(OPERATION, ticks(ms), int(length * 1e6), int(thread), int(id), str(name), str(`${name} detail`),
        [async ? 1 : 0], [0], [0], int(0), int(0));
/** @param {number} ms @param {number} length @param {number} thread @param {number} id */
const segment = (ms, length, thread, id) => ticks => event(SEGMENT, ticks(ms), int(length * 1e6), int(thread), int(id));
/** @param {number} ms @param {number} length @param {number} thread @param {string | null} route @param {number} status */
const request = (ms, length, thread, route, status) => ticks =>
  event(FLAK_REQUEST, ticks(ms), int(length * 1e6), int(thread), str('/app'), str('GET'),
        route === null ? [0] : str(route), str('/app/user/42'), int(status), int(100), int(2000));

test('operations: flak requests and those of the API, each sample in the innermost its thread was in', () => {
  const {wall} = readJfr(Uint8Array.from(chunk({
    start: T0, app: 'app/Main',
    // main: import 0-50, a step inside it 10-20, a request 100-160 and a failed one with no route 300-310;
    // an asynchronous operation (id 5) 200-300 with a segment on worker 210-230 and one on main 250-260
    events: [operation(0, 50, 1, 1, 'import'), operation(10, 10, 1, 2, 'step'), request(100, 60, 1, '/user/:id', 200),
             request(300, 10, 1, null, 503), operation(200, 100, 1, 5, 'quote', true), segment(210, 20, 2, 5),
             segment(250, 10, 1, 5)],
    exec: [[5, 1], [15, 1], [30, 1], [70, 1], [120, 1], [220, 1, 2], [225, 1], [255, 1], [305, 1], [400, 1]],
  })));
  const o = wall.operations;
  assert.equal(o.count, 5);
  const name = i => wall.strings[o.name[i]];
  assert.deepEqual([0, 1, 2, 3, 4].map(name),
                   ['import', 'step', 'GET /app/user/:id', 'GET (no route)', 'quote']);
  assert.equal(wall.strings[o.detail[0]], 'import detail');
  assert.equal(wall.strings[o.detail[2]], 'GET /app/user/42');
  assert.equal(wall.strings[o.thread[0]], 'main');
  assert.deepEqual([...o.status], [0, 0, 200, 503, 0]);
  assert.deepEqual([...o.failed], [0, 0, 0, 1, 0]);
  assert.equal(wall.strings[o.error[3]], 'HTTP 503');
  assert.equal(o.error[2], -1);
  assert.deepEqual([...o.async], [0, 0, 0, 0, 1]);
  assert.deepEqual([...o.bytesIn.slice(2, 4)], [100, 100]);
  assert.deepEqual([...o.start.slice(0, 3)], [0, 10e6, 100e6]);
  assert.deepEqual([...o.duration.slice(0, 3)], [50e6, 10e6, 60e6]);
  // 5 import, 15 step (innermost), 30 import again, 70 none, 120 the request, 220 the quote on worker,
  // 225 none on main (the segment there is later), 255 the quote on main, 305 the request with no route, 400 none
  assert.deepEqual([...wall.operation], [0, 1, 0, -1, 2, 4, -1, 4, 3, -1]);
});

test('operations: none in a recording without their events; the allocation samples too are in them', () => {
  const none = readJfr(Uint8Array.from(chunk({start: T0, app: 'app/Main', exec: [[0, 1]]})));
  assert.equal(none.wall.operations.count, 0);
  assert.deepEqual([...none.wall.operation], [-1]);
  const {alloc} = readJfr(Uint8Array.from(chunk({start: T0, app: 'app/Main', exec: [[0, 1]], alloc: [[5, 1, 2, 100], [90, 1, 2, 50]],
                                                  events: [operation(0, 10, 1, 1, 'import')]})));
  assert.deepEqual([...alloc.operation], [0, -1]);
  assert.equal(alloc.strings[alloc.operations.name[0]], 'import');
});

test('strings kept in the pool of strings, written after the events: a request, a thread name', () => {
  const {wall} = readJfr(Uint8Array.from(chunk({
    start: T0, app: 'app/Main',
    events: [ticks => event(FLAK_REQUEST, ticks(100), int(60e6), int(1), pooled(8), pooled(7), pooled(10), pooled(11),
                            int(200), int(0), int(0))],
    exec: [[120, 1], [130, 1, 3]],
  })));
  assert.equal(wall.operations.count, 1);
  assert.equal(wall.strings[wall.operations.name[0]], 'GET /app/user/:id');
  assert.equal(wall.strings[wall.operations.detail[0]], 'GET /app/user/42');
  assert.deepEqual(wall.threads.map(t => t.name), ['main', 'pooled-thread']);
  assert.deepEqual([...wall.operation], [0, -1], 'the second sample is of another thread');
});
