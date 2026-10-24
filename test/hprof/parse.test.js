// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {HprofBuilder} from './hprof-builder.js';

/**
 * One class, one instance of it, and a root pointing at the instance.
 *
 * @param {number} [idSize]
 */
function minimal(idSize = 4) {
  return new HprofBuilder({idSize})
    .string(0x100, 'java/lang/String')
    .loadClass(0x200, 0x100)
    .classDump({classId: 0x200})
    .instance(0x300, 0x200)
    .rootUnknown(0x300)
    .file('tiny.hprof');
}

describe('parseHprof', () => {
  it('reads a class, an instance and a root', async () => {
    const result = await parseHprof(minimal());

    assert.equal(result.report.classCount, 1);
    assert.equal(result.report.stringCount, 1);
    assert.equal(result.report.rootCount, 1);
    assert.equal(result.report.instanceCount, 1);
    assert.equal(result.report.objectArrayCount, 0);
    assert.equal(result.report.primitiveArrayCount, 0);
    // 4-byte ids are a 32-bit JVM's: an object of no field is its 8-byte header
    assert.equal(result.report.totalSize, 8);
    assert.equal(result.report.reachableSize, 8);
    assert.equal(result.report.unreachableSize, 0);
    assert.equal(result.report.uniquePathCount, 1);
  });

  it('aggregates by the path from the root, object class last', async () => {
    const result = await parseHprof(minimal());

    assert.deepEqual([...result.stacks.keys()], ['Unknown;java.lang.String']);
    assert.equal(result.stacks.get('Unknown;java.lang.String'), 8);
  });

  it('reports how long each phase took', async () => {
    const result = await parseHprof(minimal());

    const r = result.report;
    assert.equal(r.fileName, 'tiny.hprof');
    assert.equal(r.version, 'JAVA PROFILE 1.0.2');
    assert.equal(r.idSize, 4);
    assert.ok(r.parseTimeMs >= 0);
    assert.ok(r.metadataTimeMs >= 0);
    assert.ok(r.objectsTimeMs >= 0);
    assert.ok(r.graphTimeMs >= 0);
    assert.equal(r.heapSegmentCount, 1);
    assert.ok(r.heapSegmentBytes > 0);
    assert.deepEqual(r.rootsByType, {Unknown: 1});
  });

  it('reads 8-byte identifiers', async () => {
    const result = await parseHprof(minimal(8));

    assert.equal(result.report.idSize, 8);
    assert.equal(result.report.instanceCount, 1);
    assert.equal(result.stacks.get('Unknown;java.lang.String'), 16);
  });
});

describe('a corrupt file', () => {
  /**
   * The minimal dump with a record of its own after the strings.
   *
   * @param {(b: HprofBuilder) => Uint8Array} record
   */
  function withRecord(record) {
    const b = new HprofBuilder()
      .string(0x100, 'java/lang/String')
      .loadClass(0x200, 0x100);
    b.chunks.push(record(b));
    return b.classDump({classId: 0x200}).instance(0x300, 0x200).rootUnknown(0x300).file('bad.hprof');
  }

  it('stops at a tag no HPROF record has, and says where', async () => {
    const file = withRecord(b => b.record(0x55, new Uint8Array(4)));

    await assert.rejects(parseHprof(file), /Unknown record tag 0x55 at offset \d+/);
  });

  it('stops after a record whose length is wrong, rather than read garbage to the end', async () => {
    // a class load said to be 1 byte long: the next tag is read inside it
    const file = withRecord(b => {
      const rec = b.record(0x02, new Uint8Array([0, 0, 0, 1, 0, 0, 0x2, 0, 0, 0, 0, 0, 0, 0, 1, 0]));
      new DataView(rec.buffer).setUint32(5, 1, false);
      return rec;
    });

    await assert.rejects(parseHprof(file), /Unknown record tag/);
  });

  it('says so when a record runs past the end of the file', async () => {
    const bytes = minimal().slice(0, -1);
    const file = new File([await bytes.arrayBuffer()], 'cut.hprof');

    await assert.rejects(parseHprof(file), /Truncated file: the record at offset \d+ is \d+ bytes long, 1 more/);
  });

  it('says so when the file holds no heap dump', async () => {
    const file = new HprofBuilder().string(0x100, 'java/lang/String').file('cpu.hprof');

    await assert.rejects(parseHprof(file), /cpu.hprof has no heap dump in it/);
  });

  it('says so when the heap dump holds no object', async () => {
    const b = new HprofBuilder().string(0x100, 'java/lang/String');
    b.chunks.push(b.record(0x1c, new Uint8Array(0)));

    await assert.rejects(parseHprof(b.file('empty.hprof')), /empty.hprof has a heap dump with no object in it/);
  });

  it('refuses identifiers that are neither 4 nor 8 bytes', async () => {
    const bytes = new HprofBuilder().string(0x100, 'java/lang/String').build();
    // the identifier size follows the version and its terminating zero
    new DataView(bytes.buffer).setUint32('JAVA PROFILE 1.0.2'.length + 1, 0, false);

    await assert.rejects(parseHprof(new File([bytes], 'zero.hprof')), /Identifiers of 0 bytes/);
  });
});
