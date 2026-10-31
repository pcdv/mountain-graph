import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureView, applyView} from '../web/js/view-state.js';

/** @returns {Storage} a storage in memory, with what it is given */
function storage(/** @type {Record<string, string>} */ initial = {}) {
  const map = new Map(Object.entries(initial));
  return /** @type {Storage} */ ({
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
  });
}

test('the settings of the view are kept, and nothing else', () => {
  const s = storage({
    'mountaingraph.view': '{"viewpoint":{"yaw":1}}',
    'mountaingraph.peaks.view': '3d',
    'mountaingraph.heap.basis': 'shallow',
    'mountaingraph.tuning': '{"a":1}',
    'mountaingraph.timeline.hold': 'true',
    'mountaingraph.anonymize': '{"packages":["secret"]}',
    'mountaingraph.invertMouse': '1',
    'mountaingraph.float.settings': 'open',
    'mountaingraph.export.view': 'true',
    'other.view': 'x',
  });
  assert.deepEqual(captureView(s), {
    'mountaingraph.heap.basis': 'shallow',
    'mountaingraph.peaks.view': '3d',
    'mountaingraph.timeline.hold': 'true',
    'mountaingraph.tuning': '{"a":1}',
    'mountaingraph.view': '{"viewpoint":{"yaw":1}}',
  });
});

test('the signs of the peaks, kept with the camera, are in a saved file and come back from it', () => {
  const view = JSON.stringify({open: [], chosen: '', viewpoint: {position: [0, 1, 2], signColour: 'blue', signSize: 0.7}});
  assert.deepEqual(captureView(storage({'mountaingraph.view': view})), {'mountaingraph.view': view});
  const s = storage();
  assert.equal(applyView({'mountaingraph.view': view}, s), 1);
  assert.equal(JSON.parse(s.getItem('mountaingraph.view') ?? '{}').viewpoint.signColour, 'blue');
});

test('a file sets the settings of the view only', () => {
  const s = storage({'mountaingraph.anonymize': '{}'});
  const taken = applyView({
    'mountaingraph.peaks.view': '3d',
    'mountaingraph.anonymize': '{"packages":["x"]}',
    'mountaingraph.invertMouse': '1',
    'mountaingraph.peaks.count': 12,
    'mountaingraph.peaks.hide': 'x'.repeat(5000),
  }, s);
  assert.equal(taken, 1);
  assert.equal(s.getItem('mountaingraph.peaks.view'), '3d');
  assert.equal(s.getItem('mountaingraph.anonymize'), '{}');
  assert.equal(s.getItem('mountaingraph.invertMouse'), null);
});

test('what is not an object of settings is ignored', () => {
  const s = storage();
  for (const bad of [null, undefined, 'x', 3, ['mountaingraph.view']])
    assert.equal(applyView(bad, s), 0);
  assert.equal(s.length, 0);
});
