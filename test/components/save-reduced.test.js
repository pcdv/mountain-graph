// @ts-check
import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {gunzipSync} from 'node:zlib';
import {installFakeDom} from '../lib/fake-dom.js';
import {stacksToProfile, decodeHeap} from '../../web/js/profile/heap.js';
import {LEVELS, LEVEL_TEXT, DEFAULT_LEVEL} from '../../web/js/model/reduce.js';

/** A heap with enough paths for a reduction to have something to fold. */
function profile() {
  /** @type {Map<string, number>} */
  const bytes = new Map(), objects = new Map();
  for (let i = 0; i < 300; i++) {
    const path = `Java Frame;com.example.Server;com.example.Cache;com.example.Entry${i % 30};byte[]${i}`;
    bytes.set(path, 100 + i);
    objects.set(path, 1);
  }
  bytes.set('Java Frame;com.example.Server', 5000);
  objects.set('Java Frame;com.example.Server', 3);
  // more owners than peaks to show, the small ones lost beside them
  for (let i = 0; i < 12; i++) {
    bytes.set(`Java Frame;com.example.Owner${i};byte[]`, 1e6 * (i + 1));
    objects.set(`Java Frame;com.example.Owner${i};byte[]`, 1);
  }
  return stacksToProfile(bytes, objects);
}

/** @param {() => boolean} done @returns {Promise<void>} */
async function until(done) {
  for (let i = 0; i < 400 && !done(); i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(done(), 'it never happened');
}

/**
 * @param {any} menu
 * @param {string} tag
 * @returns {any[]}
 */
const all = (menu, tag) => menu.all().filter((/** @type {any} */ e) => e.tagName === tag.toUpperCase());

/** @param {any} menu opens it, as a click on its summary does */
function open(menu) {
  menu.open = true;
  for (const fn of menu.listeners.toggle ?? [])
    fn();
}

describe('Save with loss', () => {
  /** @type {() => void} */
  let uninstall;
  before(() => {
    uninstall = installFakeDom();
  });
  after(() => uninstall());

  it('has a text for each level, and proposes one of them', () => {
    assert.equal(LEVEL_TEXT.length, LEVELS.length);
    assert.ok(DEFAULT_LEVEL >= 0 && DEFAULT_LEVEL < LEVELS.length);
  });

  it('offers every level by its name, the proposed one chosen', async () => {
    const {saveReduced} = await import('../../web/js/components/save-reduced.js');
    const menu = saveReduced('heap.jheap.json', profile());
    const options = all(menu, 'option');

    assert.deepEqual(options.map(o => o.text.trim()), LEVEL_TEXT.map(t => t.name));
    assert.equal(options.findIndex(o => 'selected' in o.attributes), DEFAULT_LEVEL);
    assert.equal(all(menu, 'summary')[0].text.trim(), 'Save with loss…');
  });

  it('says what the file weighs, then saves it: gzipped, reduced, and a profile the page reads', async () => {
    const {saveReduced} = await import('../../web/js/components/save-reduced.js');
    const p = profile();
    const menu = saveReduced('heap.jheap.json.gz', p);
    const save = all(menu, 'button')[0];
    const select = all(menu, 'select')[0];
    select.value = String(DEFAULT_LEVEL);
    // nothing to save before the menu is opened (the fake DOM keeps the attribute apart from the property)
    assert.ok(save.disabled || 'disabled' in save.attributes);

    open(menu);
    await until(() => save.disabled === false);

    const said = all(menu, 'p')[0].text;
    assert.match(said, /nodes become .* gzipped, against .* for the whole profile/);

    /** @type {Blob | null} */
    let blob = null;
    const created = URL.createObjectURL;
    URL.createObjectURL = b => {
      blob = /** @type {Blob} */ (b);
      return 'blob:test';
    };
    /** @type {any[]} */
    const anchors = [];
    const append = document.body.append.bind(document.body);
    document.body.append = (/** @type {any} */ ...nodes) => {
      anchors.push(...nodes);
      append(...nodes);
    };
    try {
      save.click();
    }
    finally {
      URL.createObjectURL = created;
    }

    assert.equal(anchors[0].attributes.download, 'heap-reduced.flamepack.json.gz');
    const doc = JSON.parse(gunzipSync(Buffer.from(await /** @type {Blob} */ (blob).arrayBuffer())).toString('utf8'));
    assert.equal(doc.version, 5);
    assert.deepEqual(doc.reduced, LEVELS[DEFAULT_LEVEL]);
    const q = decodeHeap(doc);
    assert.ok(q.parent.length < p.parent.length);
    assert.equal(q.weight?.reduce((x, y) => x + y, 0), p.weight?.reduce((x, y) => x + y, 0));
  });

  it('follows the level chosen', async () => {
    const {saveReduced} = await import('../../web/js/components/save-reduced.js');
    const menu = saveReduced('heap.jheap.json', profile());
    const save = all(menu, 'button')[0];
    const select = all(menu, 'select')[0];
    select.value = '0';
    open(menu);
    await until(() => save.disabled === false);
    const first = all(menu, 'p')[0].text;

    select.value = '2';
    for (const fn of select.listeners.input ?? [])
      fn();
    assert.equal(save.disabled, true);
    await until(() => save.disabled === false);

    assert.notEqual(all(menu, 'p')[0].text, first);
    assert.match(all(menu, 'p')[0].text, /Only the ridges 3 pixels wide or more/);
  });
});
