import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinch} from '../../web/js/views/pinch.js';

/** an element that only has listeners, and sits 10 px right and 20 px down */
function element() {
  /** @type {Record<string, Function>} */
  const on = {};
  const el = {
    addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => on[type] = fn,
    getBoundingClientRect: () => ({left: 10, top: 20}),
  };
  const fire = (/** @type {string} */ type, /** @type {number} */ pointerId, x = 0, y = 0) =>
    on[type]({pointerId, clientX: x, clientY: y});
  return {el: /** @type {any} */ (el), fire};
}

test('two fingers moving apart are a ratio above 1 about their middle', () => {
  const {el, fire} = element();
  const seen = [];
  pinch(el, (ratio, x, y) => seen.push({ratio, x, y}));
  fire('pointerdown', 1, 100, 100);
  fire('pointerdown', 2, 200, 100);
  fire('pointermove', 2, 300, 100);
  assert.deepEqual(seen, [{ratio: 2, x: 190, y: 80}]);
});

test('each event gives the ratio since the one before, and closing in is below 1', () => {
  const {el, fire} = element();
  const ratios = [];
  pinch(el, ratio => ratios.push(ratio));
  fire('pointerdown', 1, 0, 0);
  fire('pointerdown', 2, 100, 0);
  fire('pointermove', 2, 50, 0);
  fire('pointermove', 2, 25, 0);
  assert.deepEqual(ratios, [0.5, 0.5]);
});

test('one finger is no pinch, and lifting one ends it', () => {
  const {el, fire} = element();
  const ratios = [];
  const state = pinch(el, ratio => ratios.push(ratio));
  fire('pointerdown', 1, 0, 0);
  fire('pointermove', 1, 50, 0);
  assert.equal(state.pinching(), false);
  fire('pointerdown', 2, 100, 0);
  assert.equal(state.pinching(), true);
  assert.equal(state.touches(), 2);
  fire('pointerup', 2);
  assert.equal(state.pinching(), false);
  fire('pointermove', 1, 80, 0);
  assert.deepEqual(ratios, []);
});

test('a finger put down again starts from the new distance', () => {
  const {el, fire} = element();
  const ratios = [];
  pinch(el, ratio => ratios.push(ratio));
  fire('pointerdown', 1, 0, 0);
  fire('pointerdown', 2, 100, 0);
  fire('pointerup', 2);
  fire('pointerdown', 3, 400, 0);
  fire('pointermove', 3, 800, 0);
  assert.deepEqual(ratios, [2]);
});
