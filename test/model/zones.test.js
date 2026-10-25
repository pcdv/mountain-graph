import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zones, zoneCells} from '../../web/js/model/zones.js';

// one mountain of a peak (node 0, 100) and two frames: a heavy one (1, 60), a light one (2, 1)
const grid = {width: 5, height: 1, cells: Int32Array.from([0, 1, 1, 2, -1]), saddles: [],
              nodes: [{mountain: 0, total: 100}, {mountain: 0, total: 60}, {mountain: 0, total: 1}],
              mountains: [{node: 0}]};

test('zones: a line where the frames of a mountain meet, none around one that holds next to nothing', () => {
  // between the peak and the heavy frame; the light frame meets the heavy one, which is enough
  assert.deepEqual(zones(grid), [1, 0, 1, 1, 3, 0, 3, 1]);
  assert.deepEqual([...zoneCells(grid)], [1, 0, 1, 0, 0]);
  // two frames both too light for a line
  const light = {...grid, nodes: [{mountain: 0, total: 100}, {mountain: 0, total: 0.1}, {mountain: 0, total: 0.1}]};
  assert.deepEqual(zones({...light, cells: Int32Array.from([1, 2, 1, 2, -1])}), []);
});

test('zones: none between mountains (divides) or onto the plain', () => {
  const two = {width: 3, height: 1, cells: Int32Array.from([0, 1, -1]), saddles: [],
               nodes: [{mountain: 0, total: 10}, {mountain: 1, total: 10}], mountains: [{node: 0}, {node: 1}]};
  assert.deepEqual(zones(two), []);
});
