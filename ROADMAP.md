# Roadmap

Milestones in order. A proof of concept first: the question is whether a landscape tells how
execution reaches its hot methods faster than a reversed flame graph does.

## The idea, made precise

**A mountain is a reversed flame graph.** In jfr-web's `tree(p, {reversed: true})`, each root is a
method where samples ran (the top of their stack), weighing its self time; its subtree is the
callers that led there, down to the operations and threads where execution entered. A mountain
draws one such root: its peak at the centre, its callers in rings further out and lower, its
foot labelled with the entry points.

**Peaks are chosen by self time, so mountains don't overlap.** A sample has one top frame: it
belongs to exactly one mountain, or to the plain when its top is not a peak. Mountains and plain
add up to 100% of the samples, and the share of the peaks (the coverage) tells how much of the
profile the landscape shows. Peaks chosen by inclusive time would nest (A calls B: B's mountain
inside A's); left out.

**`hide` sets the grain of the peaks.** Self time is scattered over small library methods
(`HashMap.get`, `String.equals`). With `^(java|jdk|sun)\.` hidden, a sample's time goes to the
first frame of the application under them. The filter exists in `profile.js`.

**Shared callers are drawn once per mountain.** `Thread.run` or a request handler sits in the
foothills of many mountains. In the proof of concept each mountain keeps its own tree; mountains
sharing callers are placed close together (ranges), and hovering a frame lights it in every
mountain. Merging the shared callers into one terrain (saddles, watersheds) is decided after.

**Two ways to raise a mountain from its callers tree**, to compare:

- *Massif*: a sunburst seen as relief. Each node a sector whose angle is its share, whose height
  is its weight: weights only shrink going out (a caller never weighs more than the frame it
  called), so the slopes go down. Exact and simple, but a single path makes a mesa.
- *Ridges*: the callers tree as a radial node-link tree, each edge a ridge whose width and height
  follow its weight, its height falling with depth too. One way in makes a single spur, many make
  a star of ridges: narrow mountain, few paths; wide mountain, many.

Both are a height field: a grid of heights and, for picking, of the node under each cell, built by
a module with no DOM and tested with Node.

Not taken from the first notes: an importance score made of call counts (sampling has none) and
"architectural significance" (undefined).

## M0: skeleton

- [x] Static page with no build step, `npm run serve`, `npm test`
- [x] `profile.js` and `lib/` copied from jfr-web, with their tests
- [x] A profile of jfr-web (version 3) picked or dropped, gzipped or not, and summed up

## M1: peaks, no graphics

Where the idea holds or fails, cheap to check.

- [x] The peaks of a profile: self time, total time, share; the plain; the coverage
- [x] Their number, a coverage to reach, and `hide` changeable in the page
- [x] Each peak's callers listed, down to the entry points
- [ ] Tried on several real profiles: do 5 to 15 peaks cover most of the time?
  - First seven (six test runs under Gradle, a server reloading its configuration): yes, 85 to 94%,
    but only counting the native samples, whose threads are blocked waiting (a poll, an accept, a
    socket read): those peaks are idle time.
  - With the Java samples only (CPU), no: 15 peaks cover 41% of the server's time (49% with the
    JDK hidden). In the test runs most CPU is a JDK thread generating random seeds, and with the JDK
    hidden 15 peaks cover 10 to 16%: CPU self time is scattered. Peaks may have to gather methods
    (by class or package, see Later), or a profile need more of them. A CPU-bound profile still to try.
- [ ] Collapsed stacks read too (`a;b;c 12` per line), into the same `Profile`. Open: their
  counts weigh samples, not ms (`weights` per kind today), and they have no time, thread or
  operation

## M2: 2D topographic map

- [ ] Height field of the mountains (massif first), placed by the callers they share
- [ ] Map on a canvas: contour lines (marching squares, no dependency), tinted by height, peaks
  named
- [ ] Hovering: the path from the peak down to the entry point, ms and share
- [ ] Clicking a peak: its callers in a side panel
- [ ] Ridges, switchable with massif

## M3: 3D terrain

- [ ] three.js, pinned, from a CDN through an import map: the only dependency
- [ ] The same height field as a displaced plane, orbit controls, peaks named
- [ ] Hovering and clicking as on the map, sharing its picking

## M4: verdict

- [ ] Side by side with jfr-web's reversed flame graph on the same profiles: which answers "how do
  we get here?" faster? Does the 3D add anything to the map?
- [ ] Written down here, whatever the answer

## Later

- Time slider: `from` and `to` filter the samples already, the terrain redrawn as they move
- Ranges by package or by pattern
- Shared callers merged into one terrain: saddles, watersheds
- The format named, and its specification taken out of jfr-web's docs
- A view in jfr-web, if it proves itself
