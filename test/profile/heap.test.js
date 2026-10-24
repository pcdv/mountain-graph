// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {encode, decodeHeap, stacksToProfile, stacksOf} from '../../web/js/profile/heap.js';
import {decode, VERSION} from '../../web/js/profile/profile.js';

/** @returns {Map<string, number>} */
function stacks() {
  return new Map([
    ['Java Frame;MessageBus;Store;SynchronizedMap', 60],
    ['Java Frame;MessageBus;Store;SynchronizedMap;HashMap$Node', 30],
    ['System Class;Holder;String', 10],
  ]);
}

describe('encode', () => {
  it('writes the version and the unit', () => {
    const doc = encode(stacksToProfile(stacks()));

    assert.equal(doc.version, VERSION);
    assert.equal(doc.unit, 'bytes');
    assert.deepEqual(doc.weights, [1, 1]);
  });

  it('round-trips through the page decoder', () => {
    const before = stacksToProfile(stacks());
    const after = decode(JSON.parse(JSON.stringify(encode(before))));

    assert.deepEqual([...frameNames(after)].sort(), [...frameNames(before)].sort());
    assert.deepEqual([...after.weight ?? []], [...before.weight ?? []]);
    assert.equal(after.stack.length, before.stack.length);
    assert.equal(after.threads[0].name, 'all');
  });

  it('keeps the paths and their weights', () => {
    const before = stacksToProfile(stacks());
    const after = decode(JSON.parse(JSON.stringify(encode(before))));

    assert.deepEqual(collapsed(after), collapsed(before));
  });

  it('keeps the objects of each path, when the profile counts them', () => {
    const counts = new Map([...stacks().keys()].map((k, i) => [k, i + 1]));
    const before = stacksToProfile(stacks(), counts);
    const after = decodeHeap(JSON.parse(JSON.stringify(encode(before))));

    assert.deepEqual([...after.objects ?? []], [...before.objects ?? []]);
    assert.deepEqual([...after.objects ?? []].sort(), [1, 2, 3]);
  });

  it('writes no objects for a profile that does not count them, and reads none back', () => {
    const doc = /** @type {any} */ (encode(stacksToProfile(stacks())));

    assert.equal(doc.samples.objects, undefined);
    assert.equal(decodeHeap(doc).objects, null);
  });

  it("is read by jfr-web's decoder, which knows nothing of the objects", () => {
    const counts = new Map([...stacks().keys()].map(k => [k, 1]));
    const after = decode(JSON.parse(JSON.stringify(encode(stacksToProfile(stacks(), counts)))));

    assert.deepEqual(collapsed(after), collapsed(stacksToProfile(stacks())));
  });

  it('front-codes the strings the way the decoder reads them', () => {
    const doc = encode(stacksToProfile(stacks()));

    // the first character of each string is the length of the prefix shared
    // with the previous one, plus 32
    let previous = '';
    for (const s of doc.strings) {
      const shared = s.charCodeAt(0) - 32;
      const name = previous.substring(0, shared) + s.substring(1);
      assert.ok(shared <= previous.length, s);
      previous = name;
    }
  });
});

/**
 * The names of the frames a profile uses.
 *
 * @param {import('../../web/js/profile/profile.js').Profile} p
 * @returns {Set<string>}
 */
function frameNames(p) {
  return new Set(Array.from(p.frame, f => p.strings[f >>> 3]));
}

/**
 * The profile as path → weight, the way the parser emits it.
 *
 * @param {import('../../web/js/profile/profile.js').Profile} p
 * @returns {Map<string, number>}
 */
function collapsed(p) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (let i = 0; i < p.stack.length; i++) {
    /** @type {string[]} */
    const frames = [];
    for (let node = p.stack[i]; node >= 0; node = p.parent[node])
      frames.unshift(p.strings[p.frame[node] >>> 3]);
    const key = frames.join(';');
    out.set(key, (out.get(key) ?? 0) + (p.weight ? p.weight[i] : 1));
  }
  return out;
}

describe('the stacks of a profile, which the browser keeps as its document', () => {
  it('gives the same stacks back, from the document it stores', () => {
    const before = stacks();
    const kept = JSON.parse(JSON.stringify(encode(stacksToProfile(before))));
    const after = stacksOf(decode(kept));

    assert.deepEqual([...after], [...before]);
  });

  it('keeps the paths and their weights through a structured clone', () => {
    const before = stacks();
    const doc = structuredClone(encode(stacksToProfile(before)));

    assert.deepEqual([...stacksOf(decode(doc))], [...before]);
  });

  it('is much smaller than the paths, once there are many', () => {
    // a real dump has tens of thousands of paths, sharing long prefixes
    /** @type {Map<string, number>} */
    const many = new Map();
    for (let i = 0; i < 500; i++) {
      many.set(`Java Frame;com.example.bus.Bus;com.example.Options;`
        + `com.example.store.Disk;java.util.Collections$SynchronizedMap;Holder${i % 40}`, 1000 + i);
    }
    const doc = JSON.stringify(encode(stacksToProfile(many)));
    const paths = JSON.stringify([...many]);

    // 3.7x on this set; 11x on a real dump, where the prefixes are longer
    assert.ok(doc.length * 2 < paths.length, `${doc.length} vs ${paths.length}`);
    // the profile is built from sorted paths, so compare by key
    const sorted = (/** @type {Map<string, number>} */ m) => [...m].sort((a, b) => a[0] < b[0] ? -1 : 1);
    assert.deepEqual(sorted(stacksOf(decode(JSON.parse(doc)))), sorted(many));
  });
});
