# MountainGraph

An experiment: a profile drawn as a landscape instead of a flame graph. The methods where the
time goes are mountain peaks, and the call paths that lead to them are the slopes around each
one, down to the entry points (a request, a thread) at its foot. A flame graph answers "where
is the time spent?"; this tries to answer "why do we keep ending up here?".

A plain web page, with no build step and no server behind it: it reads a profile picked or
dropped on it. A 2D topographic map comes first, then the same terrain in 3D.

## Trying it

Node 21 or later, with no dependency to install:

```sh
npm run serve   # http://localhost:8091/ (browsers refuse modules opened from file://)
npm test        # the tests of the modules without DOM
```

## Input

A file picked or dropped, gzipped or not, in one of three formats, told by its first bytes:

- **JFR recordings** (`.jfr`, JDK 11 and later), read in the page. They hold two kinds of samples,
  which weigh different things, so both are read and a *Samples* choice in the top bar switches
  between the wall clock (Java and native samples, weighing time) and the allocations (weighing
  bytes). There are no operations in a recording read this way.
- **The profile format of [jfr-web](https://github.com/pcdv/jfr-web)** (version 4, or 3), as
  `GET /api/sessions/:id/profile` sends it: front-coded strings, the tree of stacks, the samples as
  columns. A static export of jfr-web (`jfr-web export <file.jfr> -o <dir>`) holds one per
  recording under `data/`: `static.json` maps `api/sessions/<id>/profile` to its file.
- **Collapsed stacks**, the text format of [FlameGraph](https://github.com/brendangregg/FlameGraph)'s
  `stackcollapse` scripts (`a;b;c 12` per line), which any profiler can produce. Their counts
  are samples, with no time, thread or operation.

Profiles tried locally go in `samples/`, which git ignores. `test/fixtures/` holds a small real
recording, with the program it was made from.

## Code

`web/js/profile/profile.js` is a copy of jfr-web's, kept identical: a change to it is made in
jfr-web. `dom.js`, `dialog.js` and `settings.js` in `web/js/lib/` are copied from
[web-lib](https://github.com/pcdv/web-lib) (`web-lib.json` there tells which), with a `.d.ts` beside
each: they are fixed in web-lib, then synced.
