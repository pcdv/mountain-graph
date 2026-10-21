import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alias, anonymizer, KEPT} from '../../web/js/model/anonymize.js';

const profile = strings => ({strings, threads: [{name: 'main', id: 1}, {name: 'com.foo.Pool', id: 2}]});
const rules = (more = {}) => ({packages: true, depth: 2, keep: KEPT, replace: [], ...more});

test('aliases: the dictionary first, then a, b, c… and aa, ab…', () => {
  assert.deepEqual([0, 1, 2].map(alias), ['bart', 'lisa', 'homer']);
  const letters = [...Array(200).keys()].map(alias).slice(40);
  assert.deepEqual(letters.slice(0, 3), ['a', 'b', 'c']);
  assert.equal(letters[25], 'z');
  assert.equal(letters[26], 'aa');
  assert.equal(new Set(letters).size, letters.length);
});

test('each package gets one alias wherever it stands; domains, the JDK, classes and methods stay', () => {
  const p = anonymizer(rules())(profile([
    'com.foo.Order.total', 'com.bar.Order.total', 'com.foo.bar.util.Dates.parse', 'java.util.HashMap.get',
    'com.foo.Order.<init>', 'byte[]', 'com.foo.Order[]', 'GET /api/v1.2/foo', 'Work.spin',
  ]));
  assert.deepEqual(p.strings, [
    'com.bart.Order.total', 'com.lisa.Order.total', 'com.bart.lisa.util.Dates.parse', 'java.util.HashMap.get',
    'com.bart.Order.<init>', 'byte[]', 'com.bart.Order[]', 'GET /api/v1.2/foo', 'Work.spin',
  ]);
  assert.deepEqual(p.threads.map(t => t.name), ['main', 'com.bart.Pool']);
});

test('the depth: the packages below keep their names; the domain does not count', () => {
  const names = ['com.foo.bar.baz.Run.go', 'fr.foo.bar.baz.Run.go', 'foo.bar.baz.Run.go'];
  assert.deepEqual(anonymizer(rules({depth: 1}))(profile(names)).strings,
                   ['com.bart.bar.baz.Run.go', 'fr.bart.bar.baz.Run.go', 'bart.bar.baz.Run.go']);
  assert.deepEqual(anonymizer(rules({depth: 3}))(profile(['com.foo.bar.baz.q.Run.go'])).strings,
                   ['com.bart.lisa.homer.q.Run.go']);
});

test('an alias is never a name the profile has', () => {
  const p = anonymizer(rules())(profile(['com.foo.A.run', 'com.bart.B.run', 'com.lisa.C.run']));
  const aliased = p.strings.map(s => s.split('.')[1]);
  assert.equal(new Set(aliased).size, 3);
  assert.deepEqual(p.strings.map(s => s.split('.')[1]).filter(a => ['bart', 'lisa'].includes(a)), []);
});

test('the strings the user lists are replaced, and left alone by the aliases', () => {
  const p = anonymizer(rules({replace: [{from: 'com.foo', to: 'com.x'}, {from: 'Invoice', to: 'Bill'}]}))(
    profile(['com.foo.billing.Invoice.total', 'com.bar.Invoice.total']));
  assert.deepEqual(p.strings, ['com.x.bart.Bill.total', 'com.lisa.Bill.total']);
});

test('only the strings to replace, no aliases', () => {
  const p = anonymizer(rules({packages: false, replace: [{from: 'secret', to: 'plain'}]}))(
    profile(['com.secret.Run.go', 'secret-op']));
  assert.deepEqual(p.strings, ['com.plain.Run.go', 'plain-op']);
});

test('nothing to do gives the profile itself; the aliases agree from one profile to the next', () => {
  const same = profile(['com.foo.A.run']);
  assert.equal(anonymizer(rules({packages: false}))(same), same);
  const anonymize = anonymizer(rules());
  const first = anonymize(profile(['com.foo.A.run', 'com.bar.B.run']));
  const second = anonymize(profile(['com.bar.B.run']));
  assert.equal(second.strings[0], first.strings[1]);
});
