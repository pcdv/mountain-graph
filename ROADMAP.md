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
  - Gathered, over the CPU time reaching a method with the JDK hidden (not idle JDK threads), 15
    peaks cover: by method 51% of the server, 25 to 30% of the test runs; by class 71%, 36 to 49%;
    by package 92%, 53 to 65%. The grain of the peaks matters as much as hiding the JDK.
- [x] Peaks gathered by method, class or package, chosen in the page: a class's or package's
  mountain has its methods that ran as its first ring, their callers further down
- [ ] Collapsed stacks read too (`a;b;c 12` per line), into the same `Profile`. Open: their
  counts weigh samples, not ms (`weights` per kind today), and they have no time, thread or
  operation

## M2: 2D topographic map

- [x] Height field of the mountains (massif first), placed by the callers they share
- [x] Map on a canvas: contour lines (marching squares, no dependency), tinted by height, peaks
  named. Lines and tint by halvings of the highest peak, so that small peaks show
- [x] Hovering: the path from the peak down to the entry point, ms and share; the frame lit in every
  mountain it stands in
- [x] Clicking a peak: its callers in a side panel
- [x] Ridges, switchable with massif

## M3: 3D terrain

- [x] three.js, pinned, from a CDN through an import map: the only dependency, loaded when the 3D
  view is first shown
- [x] The same height field as a displaced plane, orbit controls, peaks named; smoothed over two
  cells, shape and tint, or cell-wide steps stripe the slopes
- [x] Hovering and clicking as on the map, sharing its picking: the mouse's ray marched over the
  heights to a cell, then the map's lookup
- The map and both shapes stay beside the 3D view, whatever M4 says of it: each may tell
  something the others don't

## M4: verdict

- [x] Side by side with jfr-web's reversed flame graph on the same profiles: which answers "how do
  we get here?" faster? Does the 3D add anything to the map?
- [x] Written down here, whatever the answer

First evidence (2026-10-18), on a server reloading its configuration, threads waiting left out,
peaks by class, ridges in 3D: a small text utility stood out as a peak of its own, 3.7% of the
CPU, eighth of the classes. In a flame graph its time is split among the many paths that call it,
none of them wide. Its mountain led through schema parsing to its callers, and the JDK frames under
it to regular expressions compiled on every call; rewritten without them, it ran 5 to 6 times
faster. The landscape shows secondary bottlenecks, gathered, that a flame graph scatters. In the
next profile of the same server, with the rewrite, the utility no longer appears at all.

Verdict (2026-10-18): the landscape is more useful than playing with a reversed flame graph to find
what is worth a look. It gathers a method's, class's or package's time in one place, where a flame
graph spreads it over many thin paths. The flame graph and the callers panel stay where a suspect is
checked: exact figures, one path followed precisely.

- The 2D map would have shown the same bottleneck: 3D adds no answer the map lacks. Both are kept,
  the 3D view having room to improve.
- One case behind it, on a server's profile, by class. On the test runs CPU self time was
  scattered: the landscape may help less there, by method above all.

## M5: after the verdict

- [x] 3D: the contour lines on the surface, its relief set by a slider, the labels of peaks out of
  sight hidden; a single path's spur pointing away from the middle, not always left
- [x] Coloured by package: a hue per root package (past the domain and the organisation), its
  sub-packages near it; the height still sets how light; a caption names the roots
- [x] Ranges: a caller that mountains side by side share drawn once, a saddle where their ridges
  meet, its callers following it; divides between mountains, broken at their saddles; hovering a
  saddle tells its time toward each peak. Not merged: callers most mountains share, nor those of
  mountains far apart (their ridges would cross the map), nor the paths within one mountain
- [x] Trails: a dashed path on the plain between mountains related through a caller (a quarter of
  the smaller one's time or more), however far apart, named after it; at most three per mountain.
  Pulling related mountains together in the layout does not do it: one related to several cannot
  stand beside them all
- [x] Islands: the plain a sea, its bed deeper away from the coasts; beaches, grass, forest, rock
  and snow up the mountains; the trails as sea lanes
- [x] For fun, the 3D land in blocks: grass, dirt, stone, snow, or wool of the packages' hues;
  the trails as paths of gravel, trees on the plain

## Later

- JFR files read in the page, no server to convert them: a reader of the chunks, their metadata
  (types described per chunk, so that JDK versions differ little) and constant pools, keeping the
  execution and native samples (time, thread, stack) as a `Profile`; in a Web Worker, gzipped or
  not. No official specification: tested on recordings of each JDK used (11, 17, 21). A module
  beside `load.js`, which jfr-web could share

- Time slider: `from` and `to` filter the samples already, the terrain redrawn as they move
- Ranges by package or by pattern
- The format named, and its specification taken out of jfr-web's docs
- A view in jfr-web, if it proves itself
