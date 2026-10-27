// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {gunzipSync} from 'node:zlib';
import {savedName} from '../web/js/save-file.js';
import {gzip} from '../web/js/gzip.js';

describe('savedName', () => {
  it('drops what says what the file was', () => {
    assert.equal(savedName('heap.hprof', '.fpk'), 'heap.fpk');
    assert.equal(savedName('heap.jheap.json', '.fpk'), 'heap.fpk');
    assert.equal(savedName('heap.fpk.gz', '-reduced.fpk.gz'), 'heap-reduced.fpk.gz');
    assert.equal(savedName('heap.flamepack.json.gz', '-reduced.fpk.gz'), 'heap-reduced.fpk.gz');
    assert.equal(savedName('Heap.HPROF', '.fpk'), 'Heap.fpk');
  });

  it('leaves another name as it is', () => {
    assert.equal(savedName('dump', '.fpk'), 'dump.fpk');
  });
});

describe('gzip', () => {
  it('gives what gunzip reads back', async () => {
    const text = JSON.stringify({a: 'x'.repeat(1000), b: [1, 2, 3]});
    const packed = await gzip(text);

    assert.ok(packed.length < text.length / 4);
    assert.equal(gunzipSync(packed).toString('utf8'), text);
  });
});
