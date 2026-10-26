# MountainGraph

An experiment: a profile drawn as a landscape instead of a flame graph. The methods where the
time goes are mountain peaks, and the call paths that lead to them are the slopes around each
one, down to the entry points (a request, a thread) at its foot. A flame graph answers "where
is the time spent?"; this tries to answer "why do we keep ending up here?".

A heap dump is drawn the same way: the objects that hold the most memory are the peaks, and the
references that lead to them the slopes, out to the roots that hold them.

A plain web page, with no build step and no server behind it: it reads a file picked or dropped
on it, and tells by its content what it is. A 2D topographic map comes first, then the same
terrain in 3D.

## Trying it

Node 21 or later, with no dependency to install:

```sh
npm run serve   # http://localhost:8091/ (browsers refuse modules opened from file://)
npm test        # the tests of the modules without DOM
```

## Input

A file picked or dropped, gzipped or not, told by its first bytes. Samples, of time or of
allocations:

- **JFR recordings** (`.jfr`, JDK 11 and later), read in the page. They hold two kinds of samples,
  which weigh different things, so both are read and a *Samples* choice in the top bar switches
  between the wall clock (Java and native samples, weighing time) and the allocations (weighing
  bytes). There are no operations in a recording read this way.
- **[Flamepack](https://github.com/pcdv/flamepack)** (`.flamepack.json`, version 4, or 3):
  collapsed stacks packed with a string dictionary and enriched with each sample's time, thread and
  operation. [jfr-web](https://github.com/pcdv/jfr-web) writes it from its recordings, time or
  allocations (`GET /api/sessions/:id/profile`; a static export, `jfr-web export <file.jfr> -o <dir>`,
  holds one per recording under `data/`, `static.json` mapping `api/sessions/<id>/profile` to its
  file), jheap from a heap dump (below), and any other tool can.
- **Collapsed stacks**, the text format of [FlameGraph](https://github.com/brendangregg/FlameGraph)'s
  `stackcollapse` scripts (`a;b;c 12` per line), which any profiler can produce. Their counts
  are samples, with no time, thread or operation.

And the memory of a JVM:

- **Heap dumps** (`.hprof`, as jmap and jcmd write them), parsed in the page by
  [jheap](https://github.com/pcdv/jheap)'s parser compiled to WebAssembly, in a Web Worker that
  reads the file a slice at a time: a dump of 4.6 GB and 46 million objects opens in under 20
  seconds, the page responsive throughout. WebAssembly addresses 4 GiB, so the page reads heaps up
  to roughly 100 million objects. Beyond, or for a gzipped dump, the `jheap` command parses it
  and keeps its parse beside it, `<name>.jheap.json`, a Flamepack the page opens as it opens the
  dump. So does a heap the page exported, `<name>.flamepack.json`.
- **Duplicate Strings**, from `jheap <dump> dups --save <name>.flamepack.json`: a peak is a value
  held in several copies, as high as what keeping one copy would save, and its slopes are the
  objects that hold the copies, out to the root. The page recognises the file by its `duplicates`
  member and draws it as *Own size* with the class alone, so the settings that choose how peaks are
  ranked and gathered are not shown. The file holds the Strings' text, the application's data, as a
  heap dump does: it is no more shareable than the dump.

A heap's peaks are ranked by what they hold, as the deepest chain of holders that still retains
most of the weight. Clicking one opens a panel with what it **holds** and who it is **held by**:
every name there is clickable and shows that object instead, so that a map can be followed out to
the cache holding it and in to its entries. The page draws a heap approximately in two ways, as
jheap's command does:

- **The holder tree is a breadth-first spanning tree, not a dominator tree.** Totals are exact,
  but an object held by several others shows one of them, whichever the walk reached it from first.
- **Thin wrappers are skipped by heuristic.** An object that owns under 1% of what it holds and
  spreads it over several children is taken for where the walk entered the graph, not an owner.
  The setting *thin wrappers* shows them again.

The last file opened is kept in the browser, and shown again when the page is reloaded: a heap
dump as its parse, a few MB, so that a reload does not parse it again.

Profiles tried locally go in `samples/`, which git ignores. `test/fixtures/` holds a small real
recording, with the program it was made from.

## Code

`web/js/profile/profile.js` is a copy of jfr-web's, kept identical: a change to it is made in
jfr-web. `web/js/hprof/jheap.wasm` is built in [jheap](https://github.com/pcdv/jheap), whose
`node crates/jheap-wasm/install.mjs` copies it here; the parse tests run it. `dom.js`, `dialog.js` and `settings.js` in `web/js/lib/` are copied from
[web-lib](https://github.com/pcdv/web-lib) (`web-lib.json` there tells which), with a `.d.ts` beside
each: they are fixed in web-lib, then synced.
