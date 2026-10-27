import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {loadFile} from '../web/js/load.js';

const dir = new URL('../web/gallery/', import.meta.url);
const {profiles} = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));

test('the gallery lists each file it holds, once', () => {
  const files = readdirSync(dir).filter(f => f !== 'index.json').sort();
  assert.deepEqual(profiles.map(p => p.file).sort(), files);
});

for (const entry of profiles)
  test(`${entry.file} opens, and is of the kind the gallery says`, async () => {
    assert.ok(entry.title && entry.description);
    const loaded = await loadFile(new File([readFileSync(new URL(entry.file, dir))], entry.file));
    assert.equal(loaded.kind, entry.kind === 'memory' ? 'heap' : 'samples');
  });
