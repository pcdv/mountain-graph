// @ts-check
import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {gunzipSync} from 'node:zlib';
import {installFakeDom} from '../lib/fake-dom.js';
import {stacksToProfile, decodeHeap} from '../../web/js/profile/heap.js';
import {LEVELS, LEVEL_TEXT} from '../../web/js/model/reduce.js';
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

/**
 * @param {any} menu
 * @returns {any[]} its checkboxes: only what is shown when there is the choice, the settings of the view, gzipped
 */
const boxes = menu => all(menu, 'input').filter(i => i.attributes.type === 'checkbox');

/**
 * @param {Blob} blob a document saved, gzipped or not
 * @returns {Promise<any>}
 */
async function read(blob) {
  const b = Buffer.from(await blob.arrayBuffer());
  return JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString('utf8'));
}

/**
 * @param {any} node
 * @param {string} type
 */
function fire(node, type) {
  for (const fn of node.listeners[type] ?? [])
    fn();
}

/**
 * @param {any} menu
 * @param {string} value the choice of loss: `none` or a level
 */
function choose(menu, value) {
  const select = all(menu, 'select')[0];
  select.value = value;
  fire(select, 'input');
}

/**
 * Clicks Save and gives what is downloaded.
 *
 * @param {any} save
 * @returns {Promise<{name: string, blob: Blob}>}
 */
async function saved(save) {
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
    await until(() => blob !== null);
  }
  finally {
    URL.createObjectURL = created;
    document.body.append = append;
  }
  return {name: anchors[0].attributes.download, blob: /** @type {Blob} */ (blob)};
}

const noSettings = () => ({});

describe('Save', () => {
  /** @type {() => void} */
  let uninstall;
  before(() => {
    uninstall = installFakeDom();
  });
  after(() => uninstall());

  it('has a text for each level of loss', () => {
    assert.equal(LEVEL_TEXT.length, LEVELS.length);
  });

  it('loses nothing at first, and offers every level by its name', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('heap.jheap.json', p, heapReduction(p), noSettings);
    const options = all(menu, 'option');

    assert.deepEqual(options.map(o => o.text.trim()), ['All data', ...LEVEL_TEXT.map(t => t.name)]);
    assert.equal(options.findIndex(o => 'selected' in o.attributes), 0);
    assert.equal(all(menu, 'button').length, 1, 'one button');
    assert.equal(all(menu, 'button')[0].text.trim(), 'Save');
  });

  it('saves the whole profile, gzipped, when nothing is lost', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('heap.jheap.json.gz', p, heapReduction(p), noSettings);
    const save = all(menu, 'button')[0];
    assert.equal(save.disabled, false);
    assert.match(all(menu, 'p')[0].text, /^The whole profile/);

    const {name, blob} = await saved(save);
    assert.equal(name, 'heap.fpk.gz');
    const doc = await read(blob);
    assert.equal(doc.version, 5);
    assert.equal(doc.reduced, undefined);
    assert.equal(doc.mountaingraph, undefined);
    assert.equal(decodeHeap(doc).parent.length, p.parent.length);
  });

  it('saves a plain .fpk when gzip is unchecked, under the name typed, its ending following the choices', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('heap.jheap.json', p, heapReduction(p), noSettings);
    const save = all(menu, 'button')[0];
    const [name] = all(menu, 'input').filter(i => i.attributes.type === 'text');
    const gzipped = boxes(menu).at(-1);
    assert.equal(name.value, 'heap.fpk.gz');
    name.value = 'mine.fpk.gz';
    gzipped.checked = false;
    fire(gzipped, 'change');
    assert.equal(name.value, 'mine.fpk');

    const plain = await saved(save);
    assert.equal(plain.name, 'mine.fpk');
    assert.equal(JSON.parse(await plain.blob.text()).version, 5);

    choose(menu, '0');
    assert.equal(name.value, 'mine-reduced.fpk');
    await until(() => save.disabled === false);
    const reduced = await saved(save);
    assert.equal(reduced.name, 'mine-reduced.fpk');
    assert.deepEqual(JSON.parse(await reduced.blob.text()).reduced, LEVELS[0]);
    gzipped.checked = true;
    fire(gzipped, 'change');
  });

  it('keeps the settings of the view in the file when asked, whole or reduced', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const settings = () => ({'mountaingraph.peaks.view': '3d', 'mountaingraph.peaks.hide': 'jdk'});
    const menu = saveSection('heap.jheap.json', p, heapReduction(p), settings);
    const save = all(menu, 'button')[0];
    const [keep] = boxes(menu);
    keep.checked = true;

    const whole = await read((await saved(save)).blob);
    assert.deepEqual(whole.mountaingraph, settings());

    choose(menu, '0');
    await until(() => save.disabled === false);
    const {name, blob} = await saved(save);
    assert.equal(name, 'heap-reduced.fpk.gz');
    const doc = JSON.parse(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
    assert.deepEqual(doc.mountaingraph, settings());
  });

  it('says what the file weighs, then saves it: gzipped, reduced, and a profile the page reads', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('heap.jheap.json.gz', p, heapReduction(p), noSettings);
    const save = all(menu, 'button')[0];
    choose(menu, '1');
    assert.equal(save.disabled, true, 'nothing to save before the reduction is made');
    await until(() => save.disabled === false);

    assert.match(all(menu, 'p')[0].text, /nodes become .* gzipped, against .* for the whole profile/);

    const {name, blob} = await saved(save);
    assert.equal(name, 'heap-reduced.fpk.gz');
    const doc = JSON.parse(gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
    assert.equal(doc.version, 5);
    assert.deepEqual(doc.reduced, LEVELS[1]);
    const q = decodeHeap(doc);
    assert.ok(q.parent.length < p.parent.length);
    assert.equal(q.weight?.reduce((x, y) => x + y, 0), p.weight?.reduce((x, y) => x + y, 0));
  });

  it('reduces samples by their thin stacks, with the levels of that', async () => {
    const {saveSection, samplesReduction} = await import('../../web/js/components/save-section.js');
    const lines = ['main;hot 500'];
    for (let i = 0; i < 300; i++)
      lines.push(`main;caller${i};cold${i} 1`);
    const p = readCollapsed(lines.join('\n'));
    const how = samplesReduction(p, {kind: 'cpu'});
    const menu = saveSection('app-cpu.fpk', p, how, noSettings);
    assert.deepEqual(all(menu, 'option').map(o => o.text.trim()), ['All data', ...thinning.LEVEL_TEXT.map(t => t.name)]);
    const save = all(menu, 'button')[0];
    choose(menu, String(thinning.DEFAULT_LEVEL));
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
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('heap.jheap.json', p, heapReduction(p), noSettings);
    const save = all(menu, 'button')[0];
    choose(menu, '0');
    await until(() => save.disabled === false);
    const first = all(menu, 'p')[0].text;

    choose(menu, '2');
    assert.equal(save.disabled, true);
    await until(() => save.disabled === false);

    assert.notEqual(all(menu, 'p')[0].text, first);
    assert.match(all(menu, 'p')[0].text, /Only the ridges 3 pixels wide or more/);
  });

  it('has no level to choose for a profile that cannot be reduced', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    const menu = saveSection('dups.fpk', p, {...heapReduction(p, {duplicates: {count: 1}}), levels: []}, noSettings);
    assert.deepEqual(all(menu, 'option').map(o => o.text.trim()), ['All data']);
    const doc = await read((await saved(all(menu, 'button')[0])).blob);
    assert.deepEqual(doc.duplicates, {count: 1});
  });

  it('has no choice of what is shown for a heap, which has no view of samples', async () => {
    const {saveSection, heapReduction} = await import('../../web/js/components/save-section.js');
    const p = profile();
    // the boxes are the settings of the view and the gzip
    assert.equal(boxes(saveSection('heap.jheap.json', p, heapReduction(p), noSettings)).length, 2);
  });

  it('saves only what is shown when asked, with the settings as they are when it is', async () => {
    const {saveSection, samplesReduction} = await import('../../web/js/components/save-section.js');
    const lines = ['main;hot 500', 'main;sun.nio.ch.WEPoll.wait 900'];
    for (let i = 0; i < 300; i++)
      lines.push(`main;caller${i};cold${i} 1`);
    const p = readCollapsed(lines.join('\n'));
    let settings = {waits: WAITS, hide: '', java: false};
    const how = samplesReduction(p, {kind: 'wall'}, () => settings);
    const menu = saveSection('app-wall.fpk', p, how, noSettings);
    const save = all(menu, 'button')[0];
    const [tick] = boxes(menu);
    const said = () => all(menu, 'p')[0].text;

    assert.ok(tick, 'a choice of it');
    assert.ok(!tick.checked, 'off at first: a reduced file is the whole profile, thinned');
    assert.ok(tick.disabled, 'and none while nothing is lost');
    choose(menu, String(thinning.DEFAULT_LEVEL));
    assert.ok(!tick.disabled);
    await until(() => save.disabled === false);
    assert.doesNotMatch(said(), /Without/);

    tick.checked = true;
    fire(tick, 'change');
    await until(() => /^Without the waits\. .*nodes become/.test(said()));

    // the settings change while the menu is closed: it says what they leave out when it is opened again
    settings = {waits: '', hide: '', java: false};
    fire(menu, 'menuopen');
    await until(() => /^The settings leave nothing out\./.test(said()));

    settings = {waits: WAITS, hide: '', java: false};
    fire(menu, 'menuopen');
    await until(() => /^Without the waits\./.test(said()));
    const level = thinning.DEFAULT_LEVEL;
    assert.ok(!JSON.stringify(how.reduced(level, true)).includes('WEPoll'), 'the wait is not in what is shown');
    assert.ok(JSON.stringify(how.reduced(level)).includes('WEPoll'), 'it is in the whole profile');
    assert.ok(JSON.stringify(how.reduced(level, true)).includes('hot'), 'the rest is');
  });

  it('leaves the filters out of the settings kept with only what is shown, which has applied them', async () => {
    const {saveSection, samplesReduction} = await import('../../web/js/components/save-section.js');
    const lines = ['main;hot 500', 'main;sun.nio.ch.WEPoll.wait 900'];
    for (let i = 0; i < 300; i++)
      lines.push(`main;caller${i};cold${i} 1`);
    const p = readCollapsed(lines.join('\n'));
    const how = samplesReduction(p, {kind: 'wall'}, () => ({waits: WAITS, hide: 'jdk', java: false}));
    const settings = () => ({'mountaingraph.peaks.view': '3d', 'mountaingraph.peaks.hide': 'jdk',
                             'mountaingraph.peaks.waits': WAITS, 'mountaingraph.peaks.java': 'false'});
    const menu = saveSection('app-wall.fpk', p, how, settings);
    const save = all(menu, 'button')[0];
    const [tick, keep] = boxes(menu);
    keep.checked = true;
    choose(menu, String(thinning.DEFAULT_LEVEL));
    await until(() => save.disabled === false);

    const doc = async () => JSON.parse(gunzipSync(Buffer.from(await (await saved(save)).blob.arrayBuffer())).toString('utf8'));
    assert.deepEqual((await doc()).mountaingraph, settings(), 'all of it when the file keeps everything');

    tick.checked = true;
    fire(tick, 'change');
    await until(() => save.disabled === false && /^Without/.test(all(menu, 'p')[0].text));
    assert.deepEqual((await doc()).mountaingraph, {'mountaingraph.peaks.view': '3d'});
  });
});
