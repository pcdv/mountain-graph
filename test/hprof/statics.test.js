// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {HprofBuilder, TYPE} from './hprof-builder.js';

/**
 * A class whose static field holds the only reference to an object. The class
 * object is a sticky-class root; nothing else points at the held object, so it
 * is reachable only if the class object is in the graph and its static fields
 * are followed.
 */
function staticHolder() {
  return new HprofBuilder()
    .string(0x101, 'Holder')
    .string(0x102, 'Held')
    .string(0x103, 'held')
    .loadClass(0x201, 0x101)
    .loadClass(0x202, 0x102)
    .classDump({classId: 0x201, staticFields: [{nameId: 0x103, type: TYPE.OBJECT, value: 0x300}]})
    .classDump({classId: 0x202})
    .instance(0x300, 0x202)
    .rootStickyClass(0x201)
    .file('statics.hprof');
}

describe('class objects', () => {
  it('follows a static field to the object it holds', async () => {
    const result = await parseHprof(staticHolder());

    assert.equal(result.report.unreachableSize, 0);
    assert.equal(result.stacks.get('System Class;Holder;Held'), 8);
  });

  it('counts the class object as reachable, though it weighs nothing', async () => {
    const result = await parseHprof(staticHolder());

    // a class object is metadata outside the heap: it takes no bytes, so it makes
    // no stack of its own, but the walk goes through it
    assert.equal(result.stacks.has('System Class;Holder'), false);
    // a 32-bit JVM's object of no field: its 8-byte header alone
    assert.equal(result.report.reachableSize, 8);
    assert.equal(result.report.unreachableSize, 0);
  });

  it('follows a constant pool entry to the object it holds', async () => {
    const file = new HprofBuilder()
      .string(0x101, 'Holder')
      .string(0x102, 'Held')
      .loadClass(0x201, 0x101)
      .loadClass(0x202, 0x102)
      .classDump({classId: 0x201, constantPool: [{type: TYPE.OBJECT, value: 0x300}]})
      .classDump({classId: 0x202})
      .instance(0x300, 0x202)
      .rootStickyClass(0x201)
      .file('constants.hprof');

    const result = await parseHprof(file);

    assert.equal(result.report.unreachableSize, 0);
    assert.equal(result.stacks.get('System Class;Holder;Held'), 8);
  });
});
