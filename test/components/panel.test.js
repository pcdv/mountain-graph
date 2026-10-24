// @ts-check
import {describe, it, before, after} from 'node:test';
import {strict as assert} from 'node:assert';
import {installFakeDom, byText} from '../lib/fake-dom.js';
import {stacksToProfile} from '../../web/js/profile/heap.js';
import {ownershipPeaks, mountainsOf, holdsOf, holdersOf} from '../../web/js/model/ownership.js';
import {terrain} from '../../web/js/model/terrain.js';

/**
 * Root → Cache → Map → Node, and Root → Sibling: a peak with something to hold
 * and something holding it.
 *
 * @returns {import('../../web/js/profile/profile.js').Profile}
 */
function profile() {
  return stacksToProfile(new Map([
    ['Java Frame;Cache;Map;Node', 60],
    ['Java Frame;Sibling', 40],
  ]));
}

/** @param {any} p */
function panel(p) {
  const r = ownershipPeaks(p, {count: 10});
  const m = mountainsOf(p, r.peaks);
  const trees = r.peaks.flatMap(k => m.get(k.name) ?? []);
  const t = terrain(trees, {shape: 'massif', aspect: 1.8, tuning: {}});
  /** @type {any} */
  const selection = {
    chosen: '', unit: 'bytes',
    nodes: r.peaks.map(k => k.node),
    holdsAt: (/** @type {number} */ n) => holdsOf(p, n),
    heldByAt: (/** @type {number} */ n) => holdersOf(p, n),
  };
  return {t, trees, selection, r};
}

describe('the panel of a heap dump', () => {
  /** @type {() => void} */
  let uninstall;
  before(() => {
    uninstall = installFakeDom();
  });
  after(() => uninstall());

  it('shows the two tabs once a peak is clicked', async () => {
    const {terrainFrame} = await import('../../web/js/components/terrain-frame.js');
    const p = profile();
    const {t, trees, selection} = panel(p);
    const frame = terrainFrame(t, trees, selection, 'hint', () => {});

    frame.click(0);

    const tabs = frame.section.all().map((/** @type {any} */ e) => e.text.trim());
    assert.ok(tabs.includes('Holds'), tabs.join(' | '));
    assert.ok(tabs.includes('Held by'), tabs.join(' | '));
  });

  it('makes every name in the Held by tab clickable', async () => {
    const {terrainFrame} = await import('../../web/js/components/terrain-frame.js');
    const p = profile();
    const {t, trees, selection} = panel(p);
    const frame = terrainFrame(t, trees, selection, 'hint', () => {});
    frame.click(0);

    byText(frame.section, 'Held by').click();

    const picks = frame.section.all().filter((/** @type {any} */ e) => e.classList.contains('pick'));
    assert.ok(picks.length > 0, 'nothing in the Held by tab can be clicked');
    assert.ok(picks.some((/** @type {any} */ e) => e.text.trim() === 'Cache'), picks.map((/** @type {any} */ e) => e.text).join(', '));
  });

  it('re-roots on the object clicked, and goes back to the peak', async () => {
    const {terrainFrame} = await import('../../web/js/components/terrain-frame.js');
    const p = profile();
    const {t, trees, selection, r} = panel(p);
    const frame = terrainFrame(t, trees, selection, 'hint', () => {});
    frame.click(0);
    byText(frame.section, 'Held by').click();

    byText(frame.section, 'Cache').click();

    assert.equal(selection.subject, r.peaks[0].node === undefined ? undefined : selection.subject);
    assert.equal(frame.section.all().map((/** @type {any} */ e) => e.text.trim()).includes('← peak'), true);
    // the panel now describes Cache, not the peak
    const head = frame.section.all().find((/** @type {any} */ e) => e.tagName === 'B');
    assert.equal(head?.text.trim(), 'Cache');

    byText(frame.section, '← peak').click();
    const back = frame.section.all().find((/** @type {any} */ e) => e.tagName === 'B');
    assert.ok(back?.text.includes('←'), back?.text);
  });

  it('makes the names in the Holds tab clickable too', async () => {
    const {terrainFrame} = await import('../../web/js/components/terrain-frame.js');
    const p = profile();
    const {t, trees, selection} = panel(p);
    const frame = terrainFrame(t, trees, selection, 'hint', () => {});
    frame.click(0);
    // walk up to Map, which holds Node: its Holds tab has something to click
    byText(frame.section, 'Held by').click();
    byText(frame.section, 'Map').click();
    byText(frame.section, 'Holds').click();

    const picks = frame.section.all().filter((/** @type {any} */ e) => e.classList.contains('pick'));
    assert.ok(picks.some((/** @type {any} */ e) => e.text.trim() === 'Node'),
      picks.map((/** @type {any} */ e) => e.text).join(', '));
  });
});
