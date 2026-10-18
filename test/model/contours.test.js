import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contour, levels} from '../../web/js/model/contours.js';

/** The segments as strings "x1,y1 x2,y2", in order. */
function segments(out) {
  const list = [];
  for (let i = 0; i < out.length; i += 4)
    list.push(`${out[i]},${out[i + 1]} ${out[i + 2]},${out[i + 3]}`);
  return list;
}

test('a single cell above the level: a closed diamond around its centre', () => {
  const heights = [0, 0, 0,
                   0, 2, 0,
                   0, 0, 0];
  const s = segments(contour(heights, 3, 3, 1));
  assert.equal(s.length, 4);
  // each crossing halfway between the centre (1.5, 1.5) and its neighbours
  for (const point of ['1.5,1', '2,1.5', '1.5,2', '1,1.5'])
    assert.equal(s.filter(x => x.includes(point)).length, 2, point);
});

test('interpolated between the corners', () => {
  const s = segments(contour([0, 4], 2, 1, 1));
  assert.deepEqual(s, [], 'one row: no square');
  assert.deepEqual(segments(contour([0, 4, 0, 4], 2, 2, 1)), ['0.75,0.5 0.75,1.5']);
});

test('a saddle: joined by the mean', () => {
  // b and d above, the mean too: the line cuts off a and c
  assert.deepEqual(segments(contour([0, 3, 3, 0], 2, 2, 1)).length, 2);
  const joined = segments(contour([0, 3, 3, 0], 2, 2, 1));
  assert.ok(joined[0].startsWith('0.5,') && joined[0].endsWith(',0.5'), 'around the top left corner');
});

test('levels halve from the top', () => {
  assert.deepEqual(levels(100, 3), [90, 45, 22.5]);
  assert.deepEqual(levels(100, 10, 20), [90, 45, 22.5]);
});
