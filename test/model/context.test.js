// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {contextStacks} from '../../web/js/model/context.js';

/** @returns {Map<string, number>} */
function stacks() {
  return new Map([
    ['Java Frame;MessageBus;Options;Store;SynchronizedMap', 80],
    ['Java Frame;MessageBus;Other;Store;SynchronizedMap', 20],
    ['System Class;Holder;String', 5],
  ]);
}

describe('contextStacks', () => {
  it('leaves the stacks alone for a context of one frame', () => {
    const kept = stacks();
    assert.equal(contextStacks(kept, 1), kept);
    assert.equal(contextStacks(kept, 0), kept);
  });

  it('gathers the object and its holder into one frame', () => {
    const out = contextStacks(stacks(), 2);

    assert.deepEqual([...out.keys()].sort(), [
      'Java Frame;MessageBus;Options;SynchronizedMap ← Store',
      'Java Frame;MessageBus;Other;SynchronizedMap ← Store',
      'System Class;String ← Holder',
    ]);
    assert.equal(out.get('Java Frame;MessageBus;Options;SynchronizedMap ← Store'), 80);
  });

  it('keeps the holders beyond the context as callers', () => {
    const out = contextStacks(stacks(), 3);

    assert.deepEqual([...out.keys()].sort(), [
      'Java Frame;MessageBus;SynchronizedMap ← Store ← Options',
      'Java Frame;MessageBus;SynchronizedMap ← Store ← Other',
      'String ← Holder ← System Class',
    ]);
  });

  it('never takes more frames than the path has', () => {
    const out = contextStacks(new Map([['Root;Object', 7]]), 5);

    assert.deepEqual([...out.keys()], ['Object ← Root']);
    assert.equal(out.get('Object ← Root'), 7);
  });
});
