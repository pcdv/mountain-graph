import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layout, range, pick, pathOf, follow, matched} from '../../web/js/model/flame.js';

/**
 * @param {string} name
 * @param {number} self
 * @param {any[]} children
 */
const frame = (name, self, children = []) =>
  ({name, self, total: self + children.reduce((s, c) => s + c.total, 0), types: [], children});

// root 10: a 6 (self 3, a.x 2, a.y 1), b 4
const root = frame('root', 0, [frame('a', 3, [frame('a.x', 2), frame('a.y', 1)]), frame('b', 4)]);
const flame = layout(root);

test('a frame stands over its caller, its callees side by side in its width', () => {
  assert.deepEqual(flame.levels.map(l => l.map(b => [b.frame.name, b.left])),
                   [[['root', 0]], [['a', 0], ['b', 6]], [['a.x', 0], ['a.y', 2]]]);
});

test('the range is the root, or the frame zoomed on', () => {
  assert.deepEqual(range(flame, null), {from: 0, span: 10});
  assert.deepEqual(range(flame, flame.levels[1][1]), {from: 6, span: 4});
});

test('a point of a level is on the frame whose time it is in', () => {
  assert.equal(pick(flame, null, 0.1, 1)?.frame.name, 'a');
  assert.equal(pick(flame, null, 0.9, 1)?.frame.name, 'b');
  assert.equal(pick(flame, null, 0.9, 2), null);
  assert.equal(pick(flame, null, 1, 1), null);
  assert.equal(pick(flame, null, 0.5, 5), null);
});

test('zoomed, the point is in the range shown', () => {
  const a = flame.levels[1][0];
  assert.equal(pick(flame, a, 0.4, 2)?.frame.name, 'a.y');
  assert.equal(pick(flame, a, 0.1, 2)?.frame.name, 'a.x');
});

test('the path of a frame is found again in a tree that has it', () => {
  const y = flame.levels[2][1];
  assert.deepEqual(pathOf(y), ['a', 'a.y']);
  assert.equal(follow(layout(root), ['a', 'a.y'])?.frame.name, 'a.y');
  assert.equal(follow(layout(root), ['a', 'zz']), null);
  assert.equal(follow(layout(root), [])?.frame.name, 'root');
});

test('a match counts once, not again under a match', () => {
  assert.equal(matched(flame, /^a/), 6);
  assert.equal(matched(flame, /^a$/), 6);
  assert.equal(matched(flame, /nothing/), 0);
});
