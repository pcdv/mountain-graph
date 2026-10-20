import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isCollapsed, readCollapsed} from '../../web/js/profile/collapsed.js';
import {tree, weightOf, mainType, COMPILED, INLINED, NATIVE} from '../../web/js/profile/profile.js';
import {amount} from '../../web/js/model/units.js';

const text = `# a comment
main;run;work 5
main;run;sort 3

main;run;work 2
main;poll_[k] 4
`;

test('one sample per line, each weighing its count', () => {
  const p = readCollapsed(text);
  assert.equal(p.unit, 'samples');
  assert.deepEqual([...p.stack.keys()].map(i => weightOf(p, i)), [5, 3, 2, 4]);
  assert.equal(p.stack[0] === p.stack[3], false);
  // the same path is one node, whatever the line
  assert.equal(p.stack[0], p.stack[2]);
});

test('the flame graph sums the counts', () => {
  const {root} = tree(readCollapsed(text), {all: true, merged: true});
  assert.equal(root.total, 14);
  // under the root of the samples with no operation, and that of their thread
  const top = root.children[0].children[0];
  const run = top.children.find(f => f.name === 'main').children.find(f => f.name === 'run');
  assert.equal(run.total, 10);
  assert.equal(run.children.find(f => f.name === 'work').self, 7);
});

test("perf's annotations give the type and leave the name", () => {
  const p = readCollapsed('a_[j];b_[i];c_[k];d 1\n');
  const types = [...p.frame].map(f => f & 7);
  assert.deepEqual(types, [COMPILED, INLINED, NATIVE, COMPILED]);
  assert.deepEqual([...p.frame].map(f => p.strings[f >>> 3]), ['a', 'b', 'c', 'd']);
});

test('frame names may hold spaces; counts may be fractions', () => {
  const p = readCollapsed('java;void Foo.bar(int, String) 1.5\n');
  assert.equal(p.strings[p.frame[1] >>> 3], 'void Foo.bar(int, String)');
  assert.equal(weightOf(p, 0), 1.5);
});

test('a line without a count is refused, with its number', () => {
  assert.throws(() => readCollapsed('a;b 1\nnonsense\n'), /Line 2 is not a collapsed stack/);
  assert.throws(() => readCollapsed('a;b -3\n'), /Line 1/);
});

test('told from other text by its first line', () => {
  assert.equal(isCollapsed(text), true);
  assert.equal(isCollapsed('hello world\n'), false);
  assert.equal(isCollapsed(''), false);
});

test('amounts in samples', () => {
  assert.equal(amount(1234.4, 'samples'), `${(1234).toLocaleString()} samples`);
  assert.equal(amount(1536, 'bytes'), '1.5 KiB');
});
