// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {HprofBuilder, TYPE} from './hprof-builder.js';

/**
 * A chain of instances, each holding the next. Longer than the parser's path
 * cap, so the tail is only reachable if the walk keeps going past the cap.
 *
 * @param {number} length
 */
function chain(length) {
  const b = new HprofBuilder()
    .string(0x101, 'Link')
    .string(0x102, 'next')
    .loadClass(0x201, 0x101)
    .classDump({classId: 0x201, instanceSize: 4, fields: [{nameId: 0x102, type: TYPE.OBJECT}]});

  for (let i = 0; i < length; i++) {
    const next = i + 1 < length ? 0x1000 + i + 1 : 0;
    b.instance(0x1000 + i, 0x201, new Uint8Array([
      (next >>> 24) & 0xff, (next >>> 16) & 0xff, (next >>> 8) & 0xff, next & 0xff,
    ]));
  }
  return b.rootUnknown(0x1000).file('chain.hprof');
}

describe('deep chains', () => {
  it('reaches every link, past the path cap', async () => {
    const result = await parseHprof(chain(50));

    assert.equal(result.report.unreachableSize, 0);
    assert.equal(result.report.reachableSize, 50 * 16); // 8 of header, 4 of field, aligned
  });

  it('keeps the path cap, sliding the window instead of stopping', async () => {
    const result = await parseHprof(chain(50));

    assert.ok(result.report.maxDepthReached > 30);
    assert.ok(result.report.depthLimitHits > 0);
    // every path stays at the cap, so the keys do not grow with the chain
    for (const path of result.stacks.keys())
      assert.ok(path.split(';').length <= 31, path);
  });

  it('reads a chain longer than the stack is deep, as a linked list or a queue is', async () => {
    const result = await parseHprof(chain(200_000));

    assert.equal(result.report.unreachableSize, 0);
    assert.equal(result.report.reachableSize, 200_000 * 16);
    assert.equal(result.report.maxDepthReached, 200_001);
    // a root object is at depth 1: the links from the 31st on are past the cap
    assert.equal(result.report.depthLimitHits, 200_000 - 30);
  });

  it('files the links past the cap under one path, as they all end the same way', async () => {
    const result = await parseHprof(chain(200_000));

    const full = 'Unknown;' + Array(30).fill('Link').join(';');
    const window = Array(31).fill('Link').join(';');
    assert.deepEqual([...result.stacks.keys()].filter(k => k.split(';').length === 31).sort(), [full, window].sort());
    assert.equal(result.stacks.get(window), (200_000 - 30) * 16);
    assert.equal(result.objects.get(window), 200_000 - 30);
  });
});
