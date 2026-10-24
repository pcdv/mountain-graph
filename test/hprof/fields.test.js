// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {HprofBuilder, TYPE, concat} from './hprof-builder.js';

/**
 * B extends A. A declares one object field `a`; B declares an int `n` and an
 * object field `b`. An instance of B holds n, b, then a — this class first,
 * then the super class, as HPROF writes them.
 *
 * Reading the fields in the wrong order would take the int for a reference and
 * miss `b`, so only TargetA would be reachable.
 */
function inheritedField() {
  return new HprofBuilder()
    .string(0x101, 'A')
    .string(0x102, 'B')
    .string(0x103, 'a')
    .string(0x104, 'n')
    .string(0x105, 'b')
    .string(0x106, 'TargetA')
    .string(0x107, 'TargetB')
    .loadClass(0x201, 0x101)
    .loadClass(0x202, 0x102)
    .loadClass(0x203, 0x106)
    .loadClass(0x204, 0x107)
    .classDump({classId: 0x201, instanceSize: 4, fields: [{nameId: 0x103, type: TYPE.OBJECT}]})
    .classDump({classId: 0x202, superId: 0x201, instanceSize: 12, fields: [
      {nameId: 0x104, type: TYPE.INT},
      {nameId: 0x105, type: TYPE.OBJECT},
    ]})
    .classDump({classId: 0x203})
    .classDump({classId: 0x204})
    .instance(0x301, 0x203) // TargetA, held by A.a
    .instance(0x302, 0x204) // TargetB, held by B.b
    .instance(0x300, 0x202, concat(
      new Uint8Array([0, 0, 0, 42]), // n, an int, at offset 0
      new Uint8Array([0, 0, 0x03, 0x02]), // b = 0x302, at offset 4
      new Uint8Array([0, 0, 0x03, 0x01]), // a = 0x301, at offset 8
    ))
    .rootJavaFrame(0x300)
    .file('inherited.hprof');
}

describe('instance fields', () => {
  it('reads the class fields before the super class fields', async () => {
    const result = await parseHprof(inheritedField());

    assert.equal(result.report.unreachableSize, 0);
    const paths = [...result.stacks.keys()].sort();
    assert.deepEqual(paths, [
      'Java Frame;B',
      'Java Frame;B;TargetA',
      'Java Frame;B;TargetB',
    ]);
  });

  it('counts the instance and both objects it holds', async () => {
    const result = await parseHprof(inheritedField());

    // 4-byte ids are a 32-bit JVM's: an 8-byte header, and references of 4. The
    // instance is 8 + 4 + 4 + 4, 24 once aligned; each target its header alone
    assert.equal(result.report.reachableSize, 24 + 8 + 8);
  });
});
