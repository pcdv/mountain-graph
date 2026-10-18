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

For now, the profile format of [jfr-web](https://github.com/pcdv/jfr-web) (version 3), as
`GET /api/sessions/:id/profile` sends it, gzipped or not: front-coded strings, the tree of stacks,
the samples as columns. A static export of jfr-web (`jfr-web export <file.jfr> -o <dir>`) holds
one per recording under `data/`: `static.json` maps `api/sessions/<id>/profile` to its file.

Collapsed stacks, the text format of [FlameGraph](https://github.com/brendangregg/FlameGraph)'s
`stackcollapse` scripts, are to be read too (see the [roadmap](ROADMAP.md)): any profiler can
produce them.

Profiles tried locally go in `samples/`, which git ignores.

## Code

`web/js/profile/profile.js` and `web/js/lib/` are copies of jfr-web's, kept identical, with their
tests under `test/`: a change to them is made in both projects.
