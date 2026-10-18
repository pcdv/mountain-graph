import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packageHues, packageOf} from '../../web/js/model/hues.js';

/** A terrain's nodes and a cell of each, all that packageHues reads. */
const nodes = (...names) => ({nodes: names.map(([name, depth]) => ({name, depth})), cells: names.map((_, i) => i)});

/** @returns {number} how far apart two hues are on the wheel, 0 to 0.5 */
const apart = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

test('the package of a frame, inner classes and lambdas in their outer class', () => {
  assert.equal(packageOf('a.b.C.m'), 'a.b');
  assert.equal(packageOf('a.b.C$D.m'), 'a.b');
  assert.equal(packageOf('a.b.C$$Lambda.0x12.test'), 'a.b');
  assert.equal(packageOf('C.m'), '');
  assert.equal(packageOf('[main]'), '');
});

test('sub-packages near their parent, unrelated packages apart; a chain one hue', () => {
  const hues = packageHues(nodes(['com.x.app.web.A.m', 0], ['com.x.app.db.B.m', 1], ['com.x.app.db.sql.C.m', 2],
                                 ['org.lib.D.m', 1], ['[main]', 3]), 'method').hues;
  const [web, db, sql, lib, thread] = hues;
  assert.ok(Number.isNaN(thread), 'no package, no hue');
  assert.ok(apart(web, lib) > 0.2, `two libraries apart: ${web} ${lib}`);
  assert.ok(apart(web, db) < apart(web, lib), 'siblings nearer than strangers');
  assert.ok(apart(db, sql) < apart(web, db), 'a sub-package nearest its parent');
  // com.x.app alone under com.x, alone under com: the three share a hue
  const chain = packageHues(nodes(['com.x.app.A.m', 0], ['org.lib.D.m', 1]), 'method').hues;
  assert.ok(apart(chain[0], chain[1]) > 0.3);
});

test('a peak gathering a class or a package: its own package', () => {
  const byClass = packageHues(nodes(['a.b.C', 0], ['a.b.C.m', 1]), 'class').hues;
  assert.equal(byClass[0], byClass[1]);
  const byPackage = packageHues(nodes(['a.b', 0], ['a.b.C.m', 1]), 'package').hues;
  assert.equal(byPackage[0], byPackage[1]);
});

test('the caption: the root packages that show, in the order of the wheel, with their share of the land', () => {
  const t = nodes(['com.x.web.A.m', 0], ['org.lib.D.m', 1], ['com.x.db.B.m', 1], ['flak.spi.E.m', 1],
                  ['flak.core.F.m', 1], ['[main]', 2]);
  t.cells = [0, 0, 1, 2, 3, 4, 5, -1];
  const {hues, legend} = packageHues(t, 'method');
  // past the domain and the organisation: com.x.db, com.x.web; where flak first branches; org.lib
  // has frames of its own
  assert.deepEqual(legend.map(e => e.name), ['com.x.db', 'com.x.web', 'flak', 'org.lib']);
  assert.deepEqual(legend.map(e => e.share), [1 / 6, 2 / 6, 2 / 6, 1 / 6]);
  assert.equal(legend[1].hue, hues[0]);
  const between = (h, a, b) => Math.min(a, b) <= h && h <= Math.max(a, b);
  assert.ok(between(legend[2].hue, hues[3], hues[4]), 'flak amid its sub-packages');
});
