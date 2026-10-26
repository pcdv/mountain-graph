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
- [x] Collapsed stacks read too (`a;b;c 12` per line), into the same `Profile` (`profile/collapsed.js`).
  Each line is a sample weighing its count, in a unit `samples` that jfr-web's format has no room
  for, so `model/units.js` formats it. No time, a single thread, no operation. perf's `_[k]`,
  `_[j]`, `_[i]` give the frame type. Tried on the 78 collapsed files of FlameGraph's `test/results`

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
  and snow up the mountains, bumped, rocky where steep; a sky at sunset, hazy at the horizon; the
  trails as sea lanes
- [x] For fun, the 3D land in blocks: grass, dirt, stone, snow, or wool of the packages' hues;
  the trails as paths of gravel, trees on the plain

- [x] Weight shown in every shape: ridges and ranges stand on a low cone as wide as the mountain;
  the 3D heights' curve set from the square root (small peaks show) to linear (the costliest the
  highest)
- [x] Advanced settings, remembered, nudged a step with − and + or dragged: the foot, the ridges' width, the saddles' reach, the trails'
  threshold and number, the 3D height curve, the islands' bumps and rock

## Later

- [x] JFR files read in the page, no server to convert them (`profile/jfr.js`): the chunks, their
  metadata (types described per chunk) and constant pools, keeping the execution, native and
  allocation samples as two `Profile`s from a single pass (wall clock in ms, allocations in
  bytes), a *Samples* choice in the top bar. Weights of the wall clock as jfr-web's: the period
  asked, or the one observed. Checked against `jfr print` on 3-chunk recordings of JDK 21, and
  on `test/fixtures/work.jfr.gz`.
  - [ ] Tried on recordings of JDK 11 and 17, and of async-profiler (its events differ:
    `jdk.ObjectAllocationInNewTLAB`, `profiler.WallClockSample`)
  - [ ] In a Web Worker: a recording of hundreds of MB blocks the page while it is read
  - [x] Operations, as jfr-web builds them (`profile/jfr.js`): flak's requests (`flak.Request`) and those of its
    API (`jfrweb.Operation`, with `jfrweb.OperationSegment` for the threads of an asynchronous one); a sample
    is in the innermost operation its thread was in. Checked against jfr-web's export of
    `test/fixtures/ops.jfr.gz` (made by `OpsWork.java`): the same operations, the same samples in each. Not
    the events an application maps to operations by configuration (jfr-web's `EventMapping`)
  - [ ] Shared with jfr-web, which reads recordings on the server

- [x] A timeline under the top bar (`components/timeline.js`, `model/timeline.js`): the weight of the
  samples over the recording, on which an interval is dragged, its edges adjusted, to focus the
  landscape on it (`from` and `to` of `profile.js`' filter); a click or *Clear* gives the whole
  recording back. The terrain is built again as the pointer moves (at most every 150 ms) and when it
  is released; the 3D view fades in over the one it replaces (`components/crossfade.js`) instead of
  flashing. None for collapsed stacks, which have no time.
  - [x] Slid as a window along the recording: dragged from inside, its width kept; the landscape follows
    the drag, at most every 150 ms
  - [x] Stacked by operation when the samples are in operations (jfr-web's profiles; none in a recording
    read in the page): the eight heaviest by name in jfr-web's colours, the others together, what ran
    outside any; each a button in a legend under the strip, which sets the landscape on that operation
    alone (`Filter.name`); with an interval selected, only the operations that ran in it, in their colours
    of the whole recording. The weight of the samples by operation, what the landscape sums, not the
    operations in flight that jfr-web counts
  - [x] The interval kept with the file (`last-file.js`): back when the page is reloaded, and across a switch of
    sampling; forgotten when another file is opened
  - [x] Peaks that stay put while the interval moves (*Keep the peaks of the whole recording*, kept in the
    browser): the peaks, their places and their scale are those of the whole recording, so that each
    mountain shrinks or grows where it stands, and two intervals compare by eye. A peak that did not
    run in the interval is left out of the map and shown with 0 in the table
- Ranges by package or by pattern
- The format named, and its specification taken out of jfr-web's docs
- A view in jfr-web, if it proves itself

## Heap dumps

Taken in from heap-landscape (2026-10-24), which drew heaps with a copy of this page's terrain,
the copies drifting apart. Its parser and its command line became jheap's; the page reads files of
either kind, told by their content, and shows the view of that kind (`kinds/`).

- [x] A `.hprof` parsed in the page by jheap's parser, compiled to WebAssembly, in a Web Worker that
  reads the `File` through `FileReaderSync`, a slice at a time. A 216 MiB dump opens in 2 s, one of
  4.6 GB and 46M objects in 18 s against jheap's 4 s: the reads and their copy into the module's
  memory are most of the difference. A file opened while a dump parses stops the parse
- [x] A heap's profile opened as a dump is, without parsing: the parse jheap keeps beside a dump
  (`.jheap.json`), with its report, for a heap past the page's 4 GiB or gzipped; an export of the page
- [x] Peaks ranked by what they hold, the deepest chain of holders still retaining most of the
  weight (`model/ownership.js`, the same chains as jheap's), or by shallow size, gathered with
  their holders (*context*)
- [x] The panel's two directions, *Holds* and *Held by*, every name clicked showing that object
- [x] The parse's report in a pane, copied as `key: value` text
- [x] Kept for a reload as its parse, not the dump; anonymized as samples are
- [ ] A gzipped dump in the page: unzipped through `DecompressionStream` into a file of the origin
  private file system, whose synchronous handles exist in workers, and parsed from there. Refused
  today, with a message naming jheap and the `.jheap.json` it keeps. Done when a test drops a
  gzipped `File` through `loadFile`
- [ ] A class object named `class com.Foo`: its static fields hang under the plain class name,
  which reads as an instance of it. A change to the parse, in jheap first
- [ ] Said on the page, not only in the README, what is approximate: the holder of a shared object
  (a breadth-first spanning tree, not a dominator tree), the thin wrappers skipped
- [ ] The shape, view and colour are remembered apart for samples and heaps: whether they should
  follow each other is open
- Later: a dominator tree, and field names in the paths, both in jheap's parse first

### Reduced for a gallery

A heap's profile cut to what the page draws, for a gallery of real heaps opened in a demo page
(`model/reduce.js`, `node tools/reduce.js [--level 0-2] [--check] <in> <out>`). Each view reads a
path from one end: the owned view from the root, the shallow view from the object. A path keeps
its start and its end as far as a view could draw them, the rest folded into a synthetic `(…)`.

- [x] Two application servers' heaps, 2.3 and 3.1 MB of profile (69k and 68k nodes): 4k and 14k
  nodes, 27 and 51 KB gzipped once in Flamepack 5 (Flamepack 5 alone: 193 and 188 KB), every
  view with its same 10 peaks. `--check` compares the eight views the settings give
- [x] Drawing the same to the pixel, for any setting, is possible and worthless: the file gets
  no smaller. Almost every object holds others, so almost every node ends a path, and a fold
  breaks the paths they share. What pays is folding together the siblings too light to draw, and
  folding away the objects whose class, package and last frames cannot be a peak
- [x] A fold is no object: the owned view does not walk into it, its bytes are its holder's;
  the shallow view counts it as no class at the top, in a context too
- [ ] The page says when a file is reduced (its `reduced` member): the totals of the table may
  be low, folds show as ridges, an object unfolded in the panel lists a fold
- [x] Reduced in the page too: "Save with loss…" in a heap's file menu, a level to choose, the
  size said before the file is saved (not for a profile of duplicate Strings)
- [ ] Profiles of samples: a reduction of their own, as the timeline and the filters read every
  sample
