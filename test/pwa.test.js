import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const web = new URL('../web/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', web), 'utf8'));

test('the page names its manifest and its worker', () => {
  assert.match(readFileSync(new URL('index.html', web), 'utf8'), /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(readFileSync(new URL('js/main.js', web), 'utf8'), /register\('sw.js'\)/);
  assert.ok(existsSync(new URL('sw.js', web)));
});

test('the manifest installs the page: a name, standalone, and icons as large as they say', () => {
  assert.equal(manifest.name, 'MountainGraph');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const file = readFileSync(new URL(icon.src, web));
    if (icon.type !== 'image/png')
      continue;
    // a PNG's width and height, in its header
    const [w, h] = [file.readUInt32BE(16), file.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512'));
});

test('the installed app opens the files the page reads', () => {
  const extensions = manifest.file_handlers.flatMap(h => Object.values(h.accept).flat());
  for (const e of ['.jfr', '.hprof', '.fpk', '.gz', '.collapsed'])
    assert.ok(extensions.includes(e), e);
});
