import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terrain} from '../../web/js/model/terrain.js';
import {layout, similarity} from '../../web/js/model/layout.js';
import {divides} from '../../web/js/model/divides.js';

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

test('ranges: a caller two mountains share drawn once, a saddle between them as high as its heavier side', () => {
  // A and D both called by B, itself by the thread: B a saddle between them, the thread with it
  const t = terrain([a, d], {shape: 'ranges', size: 201});
  assert.deepEqual(t.saddles.map(x => x.name), ['B', '[t]']);
  assert.deepEqual(t.saddles.map(x => x.join), [true, false], 'the paths join at B, then share the thread');
  const [s] = t.saddles;
  assert.deepEqual(s.nodes.map(n => t.nodes[n].total), [30, 10], 'the heaviest first');
  const [ma, md] = t.mountains;
  const along = (x, y) => (x - ma.x) * (md.x - ma.x) + (y - ma.y) * (md.y - ma.y);
  const ab = along(md.x, md.y);
  assert.ok(along(s.x, s.y) > 0 && along(s.x, s.y) < ab, 'between the peaks');
  const i = Math.floor(s.y) * t.width + Math.floor(s.x);
  assert.equal(t.nodes[t.cells[i]].name, 'B');
  // B in A: 30 ms at depth 1 of 3
  assert.ok(Math.abs(t.heights[i] - 20) < 2, `the saddle at ${t.heights[i]}`);
  assert.ok(t.heights[i] < 40 && t.heights[i] > 0);
});

test('ranges: a caller most mountains share is not merged, nor one of mountains far apart', () => {
  const x = (name, ms) => fr(name, ms, fr('run', ms));
  const t = terrain([x('P', 40), x('Q', 30), x('R', 20), x('S', 10)], {shape: 'ranges', size: 101});
  assert.equal(t.saddles.length, 0);
  // B shared by A and D, but E set between them: the layout puts A and D side by side, so stretch
  // the check through the rule itself: every saddle's mountains stand near the heaviest's
  const r = terrain([a, e, d], {shape: 'ranges', size: 201});
  for (const s of r.saddles) {
    const [m0, ...ms] = s.nodes.map(n => r.mountains[r.nodes[n].mountain]);
    for (const m of ms)
      assert.ok(Math.hypot(m.x - m0.x, m.y - m0.y) <= 1.5 * (m.r + m0.r));
  }
});

test('divides: where two mountains meet, broken at the saddle joining them', () => {
  const ranged = terrain([a, d], {shape: 'ranges', size: 201});
  const [s] = ranged.saddles;
  const segments = divides(ranged);
  for (let i = 0; i < segments.length; i += 4) {
    const mx = (segments[i] + segments[i + 2]) / 2, my = (segments[i + 1] + segments[i + 3]) / 2;
    assert.ok(Math.hypot(mx - s.x, my - s.y) >= s.reach, 'none at the saddle');
  }
  // ridges, not merged, and touching nowhere: no divide; a grid of two mountains side by side: one
  const two = {width: 4, height: 1, cells: Int32Array.from([0, 0, 1, -1]), saddles: [],
               nodes: [{mountain: 0}, {mountain: 1}], mountains: [{}, {}]};
  assert.deepEqual(divides(two), [2, 0, 2, 1]);
});
