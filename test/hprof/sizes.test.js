// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {HprofBuilder, TYPE, concat} from './hprof-builder.js';

/**
 * A 64-bit dump: a Node of an int and a reference, an Object[3] and a byte[5],
 * each a root of its own, the objects at addresses from `base` on.
 *
 * @param {number} [base] the address of the first object, which says how wide the heap is
 * @param {number} [far] the address of the byte array, the last object
 */
function sample(base = 0x7_0000_0000, far = base + 0x100) {
  const b = new HprofBuilder({idSize: 8})
    .string(0x101, 'Node').string(0x102, 'value').string(0x103, 'next')
    .string(0x104, '[Ljava/lang/Object;')
    .loadClass(0x201, 0x101).loadClass(0x204, 0x104)
    .classDump({classId: 0x201, instanceSize: 12,
                fields: [{nameId: 0x102, type: TYPE.INT}, {nameId: 0x103, type: TYPE.OBJECT}]})
    .classDump({classId: 0x204});
  b.instance(base, 0x201, concat(b.u32(7), b.id(0)));
  b.objectArray(base + 0x40, 0x204, [base, 0, base]);
  b.primitiveArray(far, TYPE.BYTE, 5, new Uint8Array(5));
  return b.rootJavaFrame(base).rootJavaFrame(base + 0x40).rootJavaFrame(far).file('sizes.hprof');
}

/** @param {{stacks: Map<string, number>}} r @param {string} cls */
const sizeOf = (r, cls) => r.stacks.get(`Java Frame;${cls}`);

describe('shallow sizes', () => {
  it('counts a 64-bit heap under 32 GB with compressed pointers, as MAT does', async () => {
    const result = await parseHprof(sample());

    assert.equal(result.report.pointers, 'compressed');
    assert.equal(result.report.pointersGuessed, true);
    // a 12-byte header, an int and a reference of 4: 20, aligned to 24
    assert.equal(sizeOf(result, 'Node'), 24);
    // a 16-byte header with the length, three references of 4: 28, aligned to 32
    assert.equal(sizeOf(result, 'java.lang.Object[]'), 32);
    // a 16-byte header and five bytes: 21, aligned to 24
    assert.equal(sizeOf(result, 'byte[]'), 24);
  });

  it('takes the pointers to be wide in a heap wider than compressed ones reach', async () => {
    // 200 arrays spread over 40 GB: the span is read from one object in 64
    const b = new HprofBuilder({idSize: 8});
    for (let i = 0; i < 200; i++) {
      const at = 0x7_0000_0000 + Math.floor(i * 40 * 2 ** 30 / 200);
      b.primitiveArray(at, TYPE.BYTE, 1, new Uint8Array(1)).rootJavaFrame(at);
    }
    const result = await parseHprof(b.file('wide.hprof'));

    assert.equal(result.report.pointers, 'wide');
    assert.equal(result.report.pointersGuessed, true);
    assert.ok(result.report.heapSpan > 32 * 2 ** 30);
  });

  it('counts wide pointers when told, whatever the heap', async () => {
    const result = await parseHprof(sample(), undefined, {pointers: 'wide'});

    assert.equal(result.report.pointers, 'wide');
    assert.equal(result.report.pointersGuessed, false);
    // a 16-byte header, an int and a reference of 8: 28, aligned to 32
    assert.equal(sizeOf(result, 'Node'), 32);
    // a 24-byte header, three references of 8: 48
    assert.equal(sizeOf(result, 'java.lang.Object[]'), 48);
    // a 24-byte header and five bytes: 29, aligned to 32
    assert.equal(sizeOf(result, 'byte[]'), 32);
  });

  it('counts an instance of a class the dump does not describe by its bytes', async () => {
    const b = new HprofBuilder({idSize: 8});
    b.instance(0x300, 0x999, new Uint8Array(10));
    const result = await parseHprof(b.rootJavaFrame(0x300).file('unknown.hprof'));

    // a 12-byte header and the ten bytes as written: 22, aligned to 24
    assert.equal(sizeOf(result, '<class:2457>'), 24);
  });
});

describe('object counts', () => {
  it('counts the objects of each path beside their bytes', async () => {
    const result = await parseHprof(sample());

    assert.deepEqual([...result.objects.keys()].sort(), [...result.stacks.keys()].sort());
    assert.equal(result.objects.get('Java Frame;Node'), 1);
    assert.equal(result.objects.get('Java Frame;byte[]'), 1);
  });

  it('counts the unreachable objects too', async () => {
    const b = new HprofBuilder({idSize: 8});
    b.primitiveArray(0x300, TYPE.INT, 2, new Uint8Array(8));
    b.primitiveArray(0x310, TYPE.INT, 2, new Uint8Array(8));
    b.primitiveArray(0x320, TYPE.BYTE, 1, new Uint8Array(1));
    const result = await parseHprof(b.rootJavaFrame(0x320).file('unreachable.hprof'));

    assert.equal(result.objects.get('(unreachable);int[]'), 2);
  });
});

describe('the width of references', () => {
  it('knows a 32-bit JVM by its 4-byte ids, which leave nothing to guess', async () => {
    const b = new HprofBuilder({idSize: 4});
    b.primitiveArray(0x300, TYPE.BYTE, 5, new Uint8Array(5));
    const result = await parseHprof(b.rootJavaFrame(0x300).file('small.hprof'));

    assert.equal(result.report.pointers, '32-bit');
    assert.equal(result.report.pointersGuessed, false);
    // a 12-byte header with the length, and five bytes: 17, aligned to 24
    assert.equal(sizeOf(result, 'byte[]'), 24);
  });
});
