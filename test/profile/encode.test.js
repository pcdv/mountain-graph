// @ts-check
// A profile of samples written as a Flamepack reads back as it was: its samples, threads and operations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {readJfr} from '../../web/js/profile/jfr.js';
import {readCollapsed} from '../../web/js/profile/collapsed.js';
import {decode, tree, weightOf} from '../../web/js/profile/profile.js';
import {encodeSamples} from '../../web/js/profile/encode.js';

/** @typedef {import('../../web/js/profile/profile.js').Profile} Profile */

/** @param {string} name of a fixture */
const recording = name => readJfr(gunzipSync(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))));

/** @param {Profile} p @returns {Profile} written, as text, and read again */
const again = p => decode(JSON.parse(JSON.stringify(encodeSamples(p, {kind: 'wall'}))));

/**
 * @param {Profile} p
 * @returns {object} what the page draws and lists of it, with the strings themselves rather than indexes
 */
function seen(p) {
  const o = p.operations;
  /** @param {number} s */
  const string = s => s < 0 ? null : p.strings[s];
  return {
    byOperation: tree(p, {}).root,
    merged: tree(p, {all: true, merged: true}).root,
    time: [...p.time],
    weight: Array.from(p.stack, (_, i) => weightOf(p, i)),
    thread: Array.from(p.thread, t => p.threads[t]),
    operation: [...p.operation],
    unit: p.unit, start: p.start, end: p.end,
    operations: Array.from({length: o.count}, (_, i) => [
      string(o.name[i]), o.start[i], o.duration[i], string(o.thread[i]), string(o.detail[i]), string(o.error[i]),
      o.failed[i], o.async[i], o.status[i], o.bytesIn[i], o.bytesOut[i]]),
  };
}

test('a recording with operations reads back as it was', () => {
  const {wall} = recording('ops.jfr.gz');
  assert.ok(wall && wall.operations.count > 0);
  assert.deepEqual(seen(again(wall)), seen(wall));
});

test('allocation samples, each its own weight, read back as they were', () => {
  const {alloc} = recording('work.jfr.gz');
  assert.ok(alloc);
  assert.deepEqual(seen(again(alloc)), seen(alloc));
});

test('collapsed stacks, with no time, are written by stack, counting samples as a count', () => {
  const p = readCollapsed('main;run;b 3\nmain;run;a 2\nmain 1\n');
  const doc = /** @type {any} */ (encodeSamples(p));
  assert.equal(doc.unit, 'count');
  assert.equal(doc.samples.time, undefined);
  assert.ok(doc.samples.stack.every((/** @type {number} */ d) => d >= 0));
  const q = decode(doc);
  assert.deepEqual(tree(q, {all: true}).root.total, tree(p, {all: true}).root.total);
});

test('only the nodes the samples are on are written, and the names they use', () => {
  const p = readCollapsed('main;run;a 2\nmain;gone 1\n');
  const kept = {...p, stack: Int32Array.from(p.stack, s => p.strings[p.frame[s] >>> 3] === 'gone' ? p.parent[s] : s)};
  const doc = /** @type {any} */ (encodeSamples(kept));
  assert.equal(doc.stacks.depth.length, 3);
  assert.ok(!doc.strings.some((/** @type {string} */ s) => s.includes('gone')));
});
