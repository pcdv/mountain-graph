import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrain} from '../../web/js/model/terrain.js';
import {layout, similarity} from '../../web/js/model/layout.js';

/** A frame of a mountain: name, ms, callers. */
const fr = (name, total, ...children) => ({name, total, self: total - children.reduce((s, c) => s + c.total, 0),
                                           types: [total, 0, 0, 0, 0], children});

// A ran 40 ms: 30 called by B (itself by the thread), 10 by C
const a = fr('A', 40, fr('B', 30, fr('[t]', 30)), fr('C', 10));
// D ran 10 ms, called by B too
const d = fr('D', 10, fr('B', 10, fr('[t]', 10)));
// E ran 10 ms, called by nothing A or D has
const e = fr('E', 10, fr('F', 10));

test('the peak at the centre, highest; the slopes going down; the plain around', () => {
  const t = terrain([a], {size: 101});
  const m = t.mountains[0];
  const at = (x, y) => t.heights[Math.floor(y) * t.width + Math.floor(x)];
  assert.equal(t.top, 40);
  assert.equal(at(m.x, m.y), 40, 'the peak');
  assert.equal(t.nodes[t.cells[Math.floor(m.y) * t.width + Math.floor(m.x)]].name, 'A');
  assert.equal(at(0, 0), 0, 'the plain');
  assert.equal(t.cells[0], -1);
  // rings of r/3: the peak, its callers, theirs
  const ring = m.r / 3;
  // B spans 3/4 of the turn from angle 0 (to the right, then down), C the rest
  assert.equal(at(m.x + 1.5 * ring, m.y + 1), 30, 'B, to the right');
  assert.equal(at(m.x + 1, m.y - 1.5 * ring), 10, 'C, above');
  assert.equal(at(m.x + 2.5 * ring, m.y + 1), 30, 'the thread, past B');
  assert.equal(at(m.x + 1, m.y - 2.5 * ring), 0, 'past C, where execution entered: the plain');
  for (let i = 0; i < t.heights.length; i++) {
    const n = t.cells[i];
    assert.equal(t.heights[i], n < 0 ? 0 : t.nodes[n].total);
    if (n >= 0 && t.nodes[n].parent >= 0)
      assert.ok(t.nodes[n].total <= t.nodes[t.nodes[n].parent].total, 'down from the peak');
  }
});

test('mountains sized by their time, apart, those sharing callers nearer', () => {
  const circles = layout([a, e, d], 40);
  assert.equal(circles[0].r, 1);
  assert.equal(circles[1].r, 0.5);
  const dist = (i, j) => Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]])
    assert.ok(dist(i, j) >= circles[i].r + circles[j].r, `${i} and ${j} apart`);
  assert.ok(Math.abs(dist(0, 2) - (1 + 0.5 + 0.12)) < 1e-9, 'D against A, which shares B');
  assert.equal(similarity(new Map([['B', 30], ['[t]', 30]]), new Map([['B', 10]]), 40, 10), 1);
  assert.equal(similarity(new Map([['F', 10]]), new Map([['B', 10]]), 10, 10), 0);
});

test('no mountain: an empty plain', () => {
  const t = terrain([], {size: 10});
  assert.equal(t.mountains.length, 0);
  assert.ok(t.heights.every(h => h === 0));
});

test('ridges: the peak highest, a ridge out to each caller, lower as it goes; the plain between', () => {
  const t = terrain([a], {shape: 'ridges', size: 101});
  const m = t.mountains[0];
  const at = (x, y) => t.heights[Math.floor(y) * t.width + Math.floor(x)];
  const node = (x, y) => t.nodes[t.cells[Math.floor(y) * t.width + Math.floor(x)]]?.name;
  // 3 depths: rings of r/3; B's sector is 3/4 of the turn from angle 0, its middle at 3π/4
  const ring = m.r / 3;
  const along = (d, angle) => [m.x + d * Math.cos(angle), m.y + d * Math.sin(angle)];
  assert.ok(Math.abs(at(m.x, m.y) - 40) < 2, 'the peak, near its height');
  assert.equal(node(m.x, m.y), 'A');
  const [bx, by] = along(ring, 3 * Math.PI / 4);
  assert.equal(node(bx, by), 'B', 'on its ridge');
  // B stands at depth 1 of 3: 30 ms * 2/3
  assert.ok(Math.abs(at(bx, by) - 20) < 2, `B at ${at(bx, by)}`);
  const [tx, ty] = along(2 * ring, 3 * Math.PI / 4);
  assert.equal(node(tx, ty), '[t]', 'then the thread');
  assert.ok(at(tx, ty) < at(bx, by), 'lower');
  // C's sector is the last quarter, its middle at 7π/4
  const [cx, cy] = along(ring, 7 * Math.PI / 4);
  assert.equal(node(cx, cy), 'C');
  assert.equal(at(...along(2 * ring, Math.PI / 4)), 0, 'between the ridges, far enough out: the plain');
  for (let i = 0; i < t.heights.length; i++)
    assert.equal(t.cells[i] < 0, t.heights[i] === 0);
});

test('ridges: a single path points away from the middle of the mountains', () => {
  const t = terrain([a, e], {shape: 'ridges', size: 201});
  const [ma, me] = t.mountains;
  const node = (x, y) => t.nodes[t.cells[Math.floor(y) * t.width + Math.floor(x)]]?.name;
  // E's caller F at depth 1 of 2: half its radius out, on the side away from A
  const away = Math.atan2(me.y - ma.y, me.x - ma.x), d = me.r / 2;
  assert.equal(node(me.x + d * Math.cos(away), me.y + d * Math.sin(away)), 'F');
  assert.notEqual(node(me.x - d * Math.cos(away), me.y - d * Math.sin(away)), 'F', 'not towards A');
});
