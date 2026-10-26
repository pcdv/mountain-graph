// @ts-check
import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {sums, anchorOf, ownership, ownershipPeaks, mountainsOf, holdersOf, outermostOf, holdsOf} from '../../web/js/model/ownership.js';
import {stacksToProfile} from '../../web/js/profile/heap.js';
import {COMPILED, SYNTHETIC} from '../../web/js/profile/profile.js';

/**
 * A chain of containers, each holding the next, beside a holder whose weight
 * spreads over several children.
 */
function chain() {
  return stacksToProfile(new Map([
    // a chain that holds nearly all of its parent's weight
    ['Java Frame;Cache;Map;Node', 90],
    // the weight spreads below "Shared" over two branches; it owns some of its
    // own, or it would be a pass-through and not an owner at all
    ['System Class;Shared', 4],
    ['System Class;Shared;Left;Leaf', 30],
    ['System Class;Shared;Right;Leaf', 30],
    // a small branch, below the report's threshold
    ['System Class;Shared;Tiny', 1],
  ]));
}

/**
 * A cache holding a fold (a synthetic frame, as a truncated stack is too) of
 * objects too small to tell apart, two of them heavier than the cache itself.
 */
function folded() {
  return /** @type {any} */ ({
    strings: ['Java Frame', 'Cache', '(…)', 'Left', 'Right'],
    parent: Int32Array.from([-1, 0, 1, 2, 2]),
    frame: Int32Array.from([0 << 3 | COMPILED, 1 << 3 | COMPILED, 2 << 3 | SYNTHETIC, 3 << 3 | COMPILED, 4 << 3 | COMPILED]),
    stack: Int32Array.from([1, 3, 4]),
    weight: Float64Array.from([10, 45, 45]),
    weights: [1, 1],
  });
}

describe('sums', () => {
  it('counts the objects each node holds, when the profile counts them', () => {
    const p = stacksToProfile(new Map([['Java Frame;Map;Node', 90], ['Java Frame;Map', 10]]),
      new Map([['Java Frame;Map;Node', 9], ['Java Frame;Map', 1]]));
    const s = sums(p);
    const map = [...p.frame].findIndex(f => p.strings[f >>> 3] === 'Map');

    assert.equal(s.objects?.[map], 1);
    assert.equal(s.held?.[map], 10);
  });

  it('counts no objects for a profile that has none', () => {
    const s = sums(stacksToProfile(new Map([['Java Frame;Map', 10]])));

    assert.equal(s.objects, null);
    assert.equal(s.held, null);
  });

  it('adds a node own weight to its parents', () => {
    const p = chain();
    const s = sums(p);
    const node = (/** @type {string} */ name) => {
      for (let i = 0; i < p.frame.length; i++)
        if (p.strings[p.frame[i] >>> 3] === name)
          return i;
      throw new Error(name);
    };

    assert.equal(s.own[node('Node')], 90);
    assert.equal(s.total[node('Node')], 90);
    assert.equal(s.total[node('Map')], 90);
    assert.equal(s.total[node('Cache')], 90);
    assert.equal(s.total[node('Java Frame')], 90);
    assert.equal(s.total[node('System Class')], 65);
    assert.equal(s.total[node('Left')], 30);
  });
});

describe('anchorOf', () => {
  it('follows the heaviest child while it holds most of its parent', () => {
    const p = chain();
    const s = sums(p);
    let root = -1;
    for (let i = 0; i < p.parent.length; i++)
      if (p.parent[i] < 0 && p.strings[p.frame[i] >>> 3] === 'Java Frame')
        root = i;

    const anchor = anchorOf(root, s);
    assert.equal(p.strings[p.frame[anchor] >>> 3], 'Node');
  });

  it('stops where the weight spreads over several children', () => {
    const p = chain();
    const s = sums(p);
    let root = -1;
    for (let i = 0; i < p.parent.length; i++)
      if (p.parent[i] < 0 && p.strings[p.frame[i] >>> 3] === 'System Class')
        root = i;

    // Shared holds 65, its heaviest child 30: less than half, so it stops there
    const anchor = anchorOf(root, s);
    assert.equal(p.strings[p.frame[anchor] >>> 3], 'Shared');
  });
});

describe('ownership', () => {
  it('reports one anchor per chain, not every node on it', () => {
    const chains = ownership(chain()).map(o => o.name);

    assert.deepEqual(chains.sort(), ['Node', 'Shared']);
  });

  it('gives the weight each anchor holds and its own', () => {
    const node = ownership(chain()).find(o => o.name === 'Node');

    assert.equal(node?.total, 90);
    assert.equal(node?.own, 90);
    assert.deepEqual(node?.path, ['Java Frame', 'Cache', 'Map', 'Node']);
  });

  it('leaves out the anchors below the weight asked for', () => {
    // Shared holds 65 bytes: above 50, below 70
    assert.deepEqual(ownership(chain(), 50).map(o => o.name).sort(), ['Node', 'Shared']);
    assert.deepEqual(ownership(chain(), 70).map(o => o.name), ['Node']);
  });

  it('does not walk into a fold: what it holds is its holder\'s', () => {
    const owned = ownership(folded());

    assert.deepEqual(owned.map(o => o.name), ['Cache']);
    assert.equal(owned[0].total, 100);
  });
});

describe('ownership accounting', () => {
  it('adds up to the weight of the whole tree', () => {
    const p = chain();
    const s = sums(p);
    const heap = s.roots.reduce((sum, r) => sum + s.total[r], 0);
    const covered = ownership(p).reduce((sum, o) => sum + o.total, 0);

    assert.equal(covered, heap);
  });

  it('counts the holders own objects, not only what the anchor holds', () => {
    // Java Frame(90 own) → Cache → Map → Node(90): the chain holds all 90
    const node = ownership(chain()).find(o => o.name === 'Node');

    assert.equal(node?.total, 90);
    assert.equal(node?.own, 90);
  });
});

describe('ownershipPeaks', () => {
  it('ranks the chains by what they hold, and they add up to the heap', () => {
    const p = chain();
    const r = ownershipPeaks(p, {count: 10});

    assert.equal(r.total, 155);
    assert.equal(r.peaks[0].total, 90);
    assert.equal(r.coverage, 1);
    assert.equal(r.plain, 0);
  });

  it('names a peak after its holder, and numbers the ones that repeat', () => {
    const p = chain();
    const names = ownershipPeaks(p, {count: 10}).peaks.map(k => k.name);

    assert.ok(names.includes('Node ← Map'), names.join(', '));
  });

  it('takes no more peaks once the coverage is reached', () => {
    const r = ownershipPeaks(chain(), {count: 10, coverage: 0.5});

    assert.equal(r.peaks.length, 1);
    assert.equal(r.plain, 65);
  });
});

describe('mountainsOf', () => {
  it('builds what a peak holds, its total the chain total', () => {
    const p = chain();
    const r = ownershipPeaks(p, {count: 1});
    const m = mountainsOf(p, r.peaks);
    const mountain = m.get(r.peaks[0].name);

    assert.equal(mountain?.total, 90);
    assert.equal(mountain?.self, 90);
    assert.deepEqual(mountain?.children, []);
  });

  it('nests the objects under the one holding them', () => {
    const p = chain();
    const r = ownershipPeaks(p, {count: 10});
    const shared = r.peaks.find(k => k.name.startsWith('Shared'));
    const mountain = shared ? mountainsOf(p, [shared]).get(shared.name) : undefined;

    // named as the peak: the anchor and what holds it
    assert.equal(mountain?.name, 'Shared ← System Class');
    assert.equal(mountain?.total, 65);
    assert.deepEqual(mountain?.children.map(c => c.name).sort(), ['Left', 'Right', 'Tiny']);
    // the children add up to what the peak holds, minus its own objects
    assert.equal(mountain?.children.reduce((sum, c) => sum + c.total, 0), 61);
    assert.equal(mountain?.self, 4);
  });
});

describe('holders', () => {
  it('says who holds a peak, the nearest first', () => {
    const p = chain();
    const node = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Node'));

    assert.deepEqual(node?.holders, ['Map', 'Cache', 'Java Frame']);
  });

  it('gives the mountain the same chain, for the panel', () => {
    const p = chain();
    const peak = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Node'));
    const mountain = peak ? mountainsOf(p, [peak]).get(peak.name) : undefined;

    assert.deepEqual(/** @type {any} */ (mountain)?.holders, ['Map', 'Cache', 'Java Frame']);
  });
});

describe('holdersOf', () => {
  it('lists the object, then who holds it, out to the root', () => {
    const p = chain();
    const peak = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Node'));
    const names = [];
    for (let f = peak ? holdersOf(p, peak.node) : undefined; f; f = f.children[0])
      names.push(f.name);

    assert.deepEqual(names, ['Node', 'Map', 'Cache', 'Java Frame']);
  });

  it('agrees with the holds tab at the top, when told what the chain has of its own', () => {
    const p = chain();
    const peak = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Node'));
    const held = peak ? holdersOf(p, peak.node, peak.total - peak.subtree) : undefined;

    assert.equal(held?.total, peak?.total);
  });

  it('is undefined for a node that is not in the profile', () => {
    assert.equal(holdersOf(chain(), -1), undefined);
    assert.equal(holdersOf(chain(), 9999), undefined);
  });
});

describe('the peak the panel looks up', () => {
  it('is found by the name the mountain carries', () => {
    const p = chain();
    const r = ownershipPeaks(p, {count: 10});
    const byName = new Map(r.peaks.map(k => [k.name, k]));

    // the panel asks selection.holders(tree.name), tree being the mountain
    for (const [name, mountain] of mountainsOf(p, r.peaks)) {
      assert.ok(byName.has(mountain.name), `no peak named ${mountain.name} (keyed ${name})`);
    }
  });
});

describe('outermostOf', () => {
  it('is the weight the last holder holds, which the shares are taken of', () => {
    const p = chain();
    const peak = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Node'));
    const held = peak ? holdersOf(p, peak.node, peak.total - peak.subtree) : undefined;

    // Node 90 -> Map 90 -> Cache 90 -> Java Frame 90: the same weight all the way
    assert.equal(held ? outermostOf(held) : 0, 90);
  });

  it('grows outward, so no share of it is above 100%', () => {
    const p = chain();
    const peak = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Shared'));
    const held = peak ? holdersOf(p, peak.node, peak.total - peak.subtree) : undefined;
    const top = held ? outermostOf(held) : 1;

    for (let f = held; f; f = f.children[0])
      assert.ok(f.total <= top, `${f.name} ${f.total} > ${top}`);
  });
});

describe('holdsOf', () => {
  it('gives what one object holds, and the node it is', () => {
    const p = chain();
    const shared = ownershipPeaks(p, {count: 10}).peaks.find(k => k.name.startsWith('Shared'));
    const held = shared ? holdsOf(p, shared.node) : undefined;

    assert.equal(held?.name, 'Shared');
    assert.equal(held?.node, shared?.node);
    assert.equal(held?.total, 65);
    assert.deepEqual(held?.children.map(c => c.name), ['Left', 'Right', 'Tiny']);
  });

  it('carries the node of every object, so the panel can walk on', () => {
    const p = chain();
    const held = holdsOf(p, 0);
    const nodes = [];
    const walk = (/** @type {any} */ f) => {
      nodes.push(f.node);
      f.children.forEach(walk);
    };
    if (held)
      walk(held);

    assert.ok(nodes.length > 0);
    assert.ok(nodes.every(n => typeof n === 'number' && n >= 0));
  });

  it('is undefined for a node that is not in the profile', () => {
    assert.equal(holdsOf(chain(), -1), undefined);
    assert.equal(holdsOf(chain(), 9999), undefined);
  });
});
