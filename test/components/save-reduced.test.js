// @ts-check
import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {gunzipSync} from 'node:zlib';
import {installFakeDom} from '../lib/fake-dom.js';
import {stacksToProfile, decodeHeap} from '../../web/js/profile/heap.js';
import {LEVELS, LEVEL_TEXT, DEFAULT_LEVEL} from '../../web/js/model/reduce.js';
import * as thinning from '../../web/js/model/thin.js';
import {WAITS} from '../../web/js/model/samples.js';
import {readCollapsed} from '../../web/js/profile/collapsed.js';
import {decode, tree} from '../../web/js/profile/profile.js';

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

    assert.equal(anchors[0].attributes.download, 'heap-reduced.fpk.gz');
    const doc = JSON.parse(gunzipSync(Buffer.from(await /** @type {Blob} */ (blob).arrayBuffer())).toString('utf8'));
    assert.equal(doc.version, 5);
    assert.deepEqual(doc.reduced, LEVELS[DEFAULT_LEVEL]);
    const q = decodeHeap(doc);
    assert.ok(q.parent.length < p.parent.length);
    assert.equal(q.weight?.reduce((x, y) => x + y, 0), p.weight?.reduce((x, y) => x + y, 0));
  });

  it('reduces samples by their thin stacks, with the levels of that', async () => {
    const {saveReduced, samplesReduction} = await import('../../web/js/components/save-reduced.js');
    const lines = ['main;hot 500'];
    for (let i = 0; i < 300; i++)
      lines.push(`main;caller${i};cold${i} 1`);
    const p = readCollapsed(lines.join('\n'));
    const how = samplesReduction(p, {kind: 'cpu'});
    const menu = saveReduced('app-cpu.fpk', p, {}, how);
    assert.deepEqual(all(menu, 'option').map(o => o.text.trim()), thinning.LEVEL_TEXT.map(t => t.name));
    const save = all(menu, 'button')[0];
    all(menu, 'select')[0].value = String(thinning.DEFAULT_LEVEL);
    open(menu);
    await until(() => save.disabled === false);
    assert.match(all(menu, 'p')[0].text, /nodes become .* gzipped.*\(thin stacks\)/);

    const doc = /** @type {any} */ (how.reduced(thinning.DEFAULT_LEVEL));
    assert.deepEqual(doc.reduced, thinning.LEVELS[thinning.DEFAULT_LEVEL]);
    assert.equal(doc.meta.kind, 'cpu');
    const q = decode(doc);
    assert.ok(q.parent.length < p.parent.length);
    assert.equal(tree(q, {all: true}).root.total, tree(p, {all: true}).root.total);
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

  it('has no choice of what is shown for a heap, which has no view of samples', async () => {
    const {saveReduced} = await import('../../web/js/components/save-reduced.js');
    assert.equal(all(saveReduced('heap.jheap.json', profile()), 'input').length, 0);
  });

  it('saves only what is shown when asked, with the settings as they are when it is', async () => {
    const {saveReduced, samplesReduction} = await import('../../web/js/components/save-reduced.js');
    const lines = ['main;hot 500', 'main;sun.nio.ch.WEPoll.wait 900'];
    for (let i = 0; i < 300; i++)
      lines.push(`main;caller${i};cold${i} 1`);
    const p = readCollapsed(lines.join('\n'));
    let settings = {waits: WAITS, hide: '', java: false};
    const how = samplesReduction(p, {kind: 'wall'}, () => settings);
    const menu = saveReduced('app-wall.fpk', p, {}, how);
    const save = all(menu, 'button')[0];
    const [tick] = all(menu, 'input');
    all(menu, 'select')[0].value = String(thinning.DEFAULT_LEVEL);
    const said = () => all(menu, 'p')[0].text;
    /** @param {any} node */
    const fire = node => {
      for (const fn of node.listeners.change ?? [])
        fn();
    };

    assert.ok(tick, 'a choice of it');
    assert.ok(!tick.checked, 'off at first: a reduced file is the whole profile, thinned');
    open(menu);
    await until(() => save.disabled === false);
    assert.doesNotMatch(said(), /Without/);

    tick.checked = true;
    fire(tick);
    await until(() => /^Without the waits\. .*nodes become/.test(said()));

    // the settings change while the menu is closed: it says what they leave out when it is opened again
    menu.open = false;
    settings = {waits: '', hide: '', java: false};
    open(menu);
    await until(() => /^The settings leave nothing out\./.test(said()));

    settings = {waits: WAITS, hide: '', java: false};
    open(menu);
    await until(() => /^Without the waits\./.test(said()));
    const level = thinning.DEFAULT_LEVEL;
    assert.ok(!JSON.stringify(how.reduced(level, true)).includes('WEPoll'), 'the wait is not in what is shown');
    assert.ok(JSON.stringify(how.reduced(level)).includes('WEPoll'), 'it is in the whole profile');
    assert.ok(JSON.stringify(how.reduced(level, true)).includes('hot'), 'the rest is');
  });
});
