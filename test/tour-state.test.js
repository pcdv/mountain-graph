import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tourOf, keptTour, keepTour, onlyCamera, viewpointOf, captionParts, MOST, STAY, FLY} from '../web/js/tour-state.js';
import {setView, captureView} from '../web/js/view-state.js';

/** @returns {Storage} a storage in memory, with what it is given */
function storage(/** @type {Record<string, string>} */ initial = {}) {
  const map = new Map(Object.entries(initial));
  return /** @type {Storage} */ ({
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: k => void map.delete(k),
  });
}

/** @param {object} viewpoint @param {object} [more] what else is shown */
const shown = (viewpoint, more = {}) => JSON.stringify({chosen: '', ...more, viewpoint});

test('a tour read from a file keeps the settings of the view only, and captions and times of a sane size', () => {
  const tour = tourOf({stay: 1e6, fly: 'soon', slides: [
    {caption: 'The cache', settings: {'mountaingraph.peaks.view': '3d', 'mountaingraph.anonymize': '{"x":1}'}},
    {caption: 42, settings: {'mountaingraph.peaks.count': 5}},
    {caption: 'no settings'},
    'not a view',
    {caption: 'x'.repeat(5000), settings: {}},
  ]});
  assert.deepEqual(tour.slides.map(s => s.settings), [{'mountaingraph.peaks.view': '3d'}, {}, {}]);
  assert.deepEqual(tour.slides.map(s => s.caption.length), [9, 0, 1000]);
  assert.equal(tour.stay, STAY.most);
  assert.equal(tour.fly, FLY.usual);
  assert.equal(tourOf({slides: Array.from({length: 500}, () => ({settings: {}}))}).slides.length, MOST);
  assert.deepEqual(tourOf({tour: []}).slides, []);
  assert.equal(tourOf([{settings: {}}]).slides.length, 1, 'its views alone, as the first tours were saved');
});

test('a view keeps its moment: the interval and the operation in focus, the frame hovered, the pane of the peaks', () => {
  const [view, odd] = tourOf({slides: [
    {settings: {}, moment: {interval: {from: 1.5, to: 3}, operation: 'checkout', hover: ['Cache.get', 'Server.run'], peaks: false}},
    {settings: {}, moment: {interval: {from: 'start'}, operation: 7, hover: ['a', 1], peaks: 'open', extra: true}},
  ]}).slides;
  assert.deepEqual(view.moment, {interval: {from: 1.5, to: 3}, operation: 'checkout', hover: ['Cache.get', 'Server.run'], peaks: false});
  assert.deepEqual(odd.moment, {});
});

test('the tour kept is the one of the file of that name', () => {
  const s = storage();
  const tour = {slides: [{caption: 'One', settings: {'mountaingraph.peaks.view': 'map'}, moment: {}}], stay: 8, fly: 1};
  keepTour('app.fpk', tour, s);
  assert.deepEqual(keptTour('app.fpk', s), tour);
  assert.deepEqual(keptTour('other.fpk', s).slides, []);
  keepTour('app.fpk', {...tour, slides: []}, s);
  assert.deepEqual(keptTour('app.fpk', s).slides, [], 'forgotten with its last view');
  assert.deepEqual(keptTour('app.fpk', storage({'mountaingraph.tour': '{broken'})).slides, []);
});

test('two views that differ only by the camera and the frame hovered are flown between; anything else is drawn again', () => {
  /** @param {Record<string, string>} settings @param {object} [moment] */
  const view = (settings, moment = {}) => ({settings, moment});
  const a = view({'mountaingraph.peaks.view': '3d', 'mountaingraph.view': shown({position: [0, 1, 2], target: [0, 0, 0], relief: 0.2})},
                 {interval: {from: 1}, hover: ['a']});
  const b = {'mountaingraph.peaks.view': '3d', 'mountaingraph.view': shown({relief: 0.2, target: [1, 0, 0], position: [3, 1, 2]})};
  assert.ok(onlyCamera(a, view(b, {interval: {from: 1}, hover: ['b'], peaks: true})), 'the members of the viewpoint in another order');
  assert.ok(!onlyCamera(a, view(b)), 'another interval');
  assert.ok(!onlyCamera(a, view(b, {interval: {from: 1}, operation: 'checkout'})), 'another operation');
  assert.ok(!onlyCamera(a, view({...b, 'mountaingraph.peaks.count': '5'}, a.moment)), 'another setting');
  assert.ok(!onlyCamera(a, view({...b, 'mountaingraph.view': shown({position: [3, 1, 2], target: [0, 0, 0], relief: 0.3})},
                                a.moment)), 'another relief');
  assert.ok(!onlyCamera(a, view({...b, 'mountaingraph.view': shown({position: [0, 1, 2], target: [0, 0, 0], relief: 0.2},
                                                                    {chosen: 'Cache.get'})}, a.moment)), 'another peak chosen');
  assert.deepEqual(viewpointOf(b)?.position, [3, 1, 2]);
  assert.equal(viewpointOf({'mountaingraph.view': shown({map: {x: 1, y: 2, k: 1}})}), null, 'no camera in 2D');
});

test('a view of a tour sets back to their defaults the settings it does not hold', () => {
  const s = storage({'mountaingraph.peaks.count': '20', 'mountaingraph.peaks.view': 'map',
                     'mountaingraph.float.table': 'open'});
  setView({'mountaingraph.peaks.view': '3d'}, s);
  assert.deepEqual(captureView(s), {'mountaingraph.peaks.view': '3d'});
  assert.equal(s.getItem('mountaingraph.float.table'), 'open', 'a habit of the person stays');
});

test('the web addresses of a caption are links, without the punctuation after them', () => {
  assert.deepEqual(captionParts('No link here.'), ['No link here.']);
  assert.deepEqual(captionParts(''), []);
  assert.deepEqual(captionParts('See https://github.com/pcdv/jheap, which finds leaks (https://pcdv.github.io/mountain-graph/).'), [
    'See ', {href: 'https://github.com/pcdv/jheap', text: 'https://github.com/pcdv/jheap'},
    ', which finds leaks (', {href: 'https://pcdv.github.io/mountain-graph/', text: 'https://pcdv.github.io/mountain-graph/'}, ').']);
  assert.deepEqual(captionParts('Only http and https: ftp://a.b/c, javascript:alert(1), https://x'),
                   ['Only http and https: ftp://a.b/c, javascript:alert(1), https://x']);
});
