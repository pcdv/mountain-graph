// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {loadFile} from '../web/js/load.js';
import {encode, stacksToProfile, stacksOf} from '../web/js/profile/heap.js';
import {peaks, mountains} from '../web/js/model/peaks.js';
import {contextStacks} from '../web/js/model/context.js';
import {asDuplicates} from '../web/js/components/heap-controls.js';

/**
 * A profile of duplicate Strings as jheap's `dups --save` writes it: each path from a root to a String
 * ends at the value, and weighs the copy's share of what keeping one copy of the value would save.
 * "hello" is held by two classes, "dedup" by one.
 *
 * @param {boolean} [duplicates] with the member that says so
 */
function document(duplicates = true) {
  /** @param {string} holder @param {string} value */
  const path = (holder, value) => `Java Frame;${holder};java.lang.Object[];java.lang.String;${value}`;
  const stacks = new Map([
    [path('com.example.A', '"hello"'), 64],
    [path('com.example.B', '"hello"'), 32],
    [path('com.example.B', '"dedup"'), 72],
  ]);
  const objects = new Map([
    [path('com.example.A', '"hello"'), 2],
    [path('com.example.B', '"hello"'), 1],
    [path('com.example.B', '"dedup"'), 4],
  ]);
  return {
    ...encode(stacksToProfile(stacks, objects)),
    ...duplicates ? {duplicates: {count: 2, copies: 7, bytes: 264, saving: 168, named: 2}} : {},
  };
}

/** @param {object} doc */
const file = doc => new File([JSON.stringify(doc)], 'dups.fpk');

describe('a profile of duplicate Strings', () => {
  it('opens as a heap that says it holds duplicates', async () => {
    const loaded = await loadFile(file(document()));
    assert.equal(loaded.kind, 'heap');
    assert.deepEqual(loaded.kind === 'heap' && loaded.heap.duplicates,
                     {count: 2, copies: 7, bytes: 264, saving: 168, named: 2});
  });

  it('is a plain heap without the member', async () => {
    const loaded = await loadFile(file(document(false)));
    assert.equal(loaded.kind, 'heap');
    assert.equal(loaded.kind === 'heap' && loaded.heap.duplicates, null);
  });

  it('keeps what it says through the settings of a heap', async () => {
    const loaded = await loadFile(file(document()));
    const heap = loaded.kind === 'heap' ? loaded.heap : assert.fail('not a heap');
    assert.deepEqual(heap.duplicates?.saving, 168);
    assert.equal(heap.profile.objects?.reduce((sum, n) => sum + n, 0), 7);
  });

  it('is drawn a mountain per value, held from where its copies are', async () => {
    const loaded = await loadFile(file(document()));
    const {profile} = loaded.kind === 'heap' ? loaded.heap : assert.fail('not a heap');
    // what the page does with the settings of a duplicates profile: the objects at the top of the
    // paths, the class alone
    const s = asDuplicates({basis: 'owned', wrappers: 'skip', grain: 'package', context: 3, count: 10,
                            coverage: 1, shape: 'massif', view: 'map', colour: 'package'});
    assert.deepEqual([s.basis, s.grain, s.context, s.colour], ['shallow', 'method', 1, 'height']);
    const gathered = stacksToProfile(contextStacks(stacksOf(profile), s.context));
    const r = peaks(gathered, {all: true}, {count: s.count, coverage: s.coverage, grain: s.grain});
    assert.deepEqual(r.peaks.map(p => [p.name, p.self]), [['"hello"', 96], ['"dedup"', 72]]);

    const hello = mountains(gathered, {all: true}, r.peaks, s.grain).get('"hello"');
    // the slopes: the String, the array, then the two classes that hold the copies
    assert.deepEqual(hello?.children.map(f => f.name), ['java.lang.String']);
    const array = hello?.children[0].children[0];
    assert.equal(array?.name, 'java.lang.Object[]');
    assert.deepEqual(array?.children.map(f => [f.name, f.total]).sort(),
                     [['com.example.A', 64], ['com.example.B', 32]]);
  });

  it('is drawn as chosen apart from what ranks and gathers the peaks', () => {
    const chosen = /** @type {const} */ ({basis: 'owned', wrappers: 'show', grain: 'package', context: 4, count: 7,
                                          coverage: 0.5, shape: 'ridges', view: '3d', colour: 'package'});
    assert.deepEqual(asDuplicates(chosen),
                     {...chosen, basis: 'shallow', grain: 'method', context: 1, colour: 'height'});
  });
});
