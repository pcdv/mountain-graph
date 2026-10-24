// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseHprof} from './jheap-parse.js';
import {stacksToProfile} from '../../web/js/profile/heap.js';
import {peaks, mountains} from '../../web/js/model/peaks.js';
import {contextStacks} from '../../web/js/model/context.js';
import {HprofBuilder, TYPE} from './hprof-builder.js';

/**
 * A root holding a Cache, which holds a Map. The map is the object with the
 * memory; the root is where the walk started.
 */
function cache() {
  return new HprofBuilder()
    .string(0x101, 'Root')
    .string(0x102, 'Cache')
    .string(0x103, 'Map')
    .string(0x104, 'map')
    .loadClass(0x201, 0x101)
    .loadClass(0x202, 0x102)
    .loadClass(0x203, 0x103)
    .classDump({classId: 0x201, instanceSize: 4, fields: [{nameId: 0x104, type: TYPE.OBJECT}]})
    .classDump({classId: 0x202, instanceSize: 4, fields: [{nameId: 0x104, type: TYPE.OBJECT}]})
    .classDump({classId: 0x203})
    .instance(0x300, 0x201, new Uint8Array([0, 0, 0x03, 0x01])) // Root → Cache
    .instance(0x301, 0x202, new Uint8Array([0, 0, 0x03, 0x02])) // Cache → Map
    .instance(0x302, 0x203)
    .rootJavaFrame(0x300)
    .file('cache.hprof');
}

describe('peaks from a heap dump', () => {
  it('names a peak after the object class, not the root', async () => {
    const result = await parseHprof(cache());
    const profile = stacksToProfile(result.stacks);
    const r = peaks(profile, {all: true}, {count: 10, grain: 'method'});

    const names = r.peaks.map(p => p.name);
    assert.ok(names.includes('Map'), names.join(', '));
    assert.ok(!names.includes('Java Frame'), names.join(', '));
  });

  it('shows the holders as the callers of the peak', async () => {
    const result = await parseHprof(cache());
    const profile = stacksToProfile(result.stacks);
    const r = peaks(profile, {all: true}, {count: 10, grain: 'method'});
    const m = mountains(profile, {all: true}, r.peaks, 'method');

    const map = m.get('Map');
    assert.ok(map);
    assert.deepEqual(map.children.map(c => c.name), ['Cache']);
    assert.deepEqual(map.children[0].children.map(c => c.name), ['Root']);
  });

  it('gathers a class and its holder into one peak when asked for context', async () => {
    const result = await parseHprof(cache());
    const profile = stacksToProfile(contextStacks(result.stacks, 2));
    const r = peaks(profile, {all: true}, {count: 10, grain: 'method'});
    const m = mountains(profile, {all: true}, r.peaks, 'method');

    // every object is a context of its own; the map is named with its holder
    assert.ok(r.peaks.some(p => p.name === 'Map ← Cache'), r.peaks.map(p => p.name).join(', '));
    assert.deepEqual(m.get('Map ← Cache')?.children.map(c => c.name), ['Root']);
  });
});

describe('the profile of a dump', () => {
  it('does not depend on the order the walk found its paths in', async () => {
    const forward = stacksToProfile(new Map([['A;B', 1], ['A;C', 2], ['D;E', 3]]));
    const backward = stacksToProfile(new Map([['D;E', 3], ['A;C', 2], ['A;B', 1]]));

    const {encode} = await import('../../web/js/profile/heap.js');
    assert.equal(JSON.stringify(encode(forward)), JSON.stringify(encode(backward)));
  });
});
