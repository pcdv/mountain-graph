# MountainGraph

A profile drawn as a landscape: the methods where the time goes are mountain peaks, and the call
paths that lead to them are the slopes around each one. A static page with no build step and no
server behind it. It answers "why do we keep ending up here?", where a flame graph answers "where
is the time spent?". A heap dump is drawn the same way: the objects that hold the memory are the
peaks, the references to them the slopes.

Created 2026-10-18 out of jfr-web, and follows jfr-web's rules (which follow flak's). The heap
dumps came from heap-landscape on 2026-10-24 (its commit `bbda976`, a private repository now
retired), whose parser had become [jheap](../jheap)'s. The plan and
the findings so far live in `ROADMAP.md` — keep them there rather than in commit messages.

The user's cross-project rules are in `~/.pi/agent/AGENTS.md`; they apply here too. This file adds
the project specifics. Repository hygiene — what a public repo may not contain, line endings,
`samples/`, visibility and pushing — is in that personal file as well.

## Commands

| What | Command |
|---|---|
| Serve the page | `npm run serve` → http://localhost:8091/ (`node serve.js <port>` for another port) |
| Tests | `npm test` (`node --test "test/**/*.test.js"`) |
| Type check | `npx -p typescript tsc -p jsconfig.json` |
| Update the heap parser | `node crates/jheap-wasm/install.mjs` in a jheap checkout beside this one, then `npm test` |
| Reduce a heap's profile | `node tools/reduce.js [--level 0-2] [--check] <in> <out>` (`.gz` out gzips) |

Node 21 or later, nothing to install. Run the tests and the type check before claiming a change
works; both are expected to be green. There is no build step and no linter. `.prettierrc.json` sets Prettier as close
to the house style as it goes, for an editor's reformat; nothing runs it, and it cannot keep `else`
on its own line, so reformat only the file being edited.

## Layout

- `web/index.html`, `web/css/app.css` — the page. three.js 0.160.0 is pinned in its import map:
  the only dependency, loaded when the 3D view is first shown.
- `web/js/main.js` — wiring only: opening a file, its progress, the view of its kind, the file
  kept for a reload.
- `web/js/load.js` — a picked or dropped file, told by its content, to what it holds: samples
  (Flamepack, version 5, 4 or 3; collapsed stacks; a JFR recording) or a heap (a dump, or the
  Flamepack jheap keeps of one), gzipped or not.
- `web/js/kinds/` — the view of each kind of file: `samples.js`, `heap.js`, and `page.js` for what
  they share. A new kind of file is a reader, a case in `load.js` and a module here.
- `web/js/hprof/` — a heap dump to a profile: `jheap.wasm` (jheap's parser, built in jheap),
  `jheap.js` (its wrapper), `worker.js` (the Web Worker that reads the file for it), `dump.js`.
- `web/js/profile/` — the format readers (`profile.js`, `collapsed.js`, `jfr.js`; `heap.js` for a
  heap's profile, with its objects). No DOM.
- `web/js/model/` — the analysis: peaks, callers, terrain, contours, divides, hues, timeline,
  anonymizing; for a heap, ownership (the chains of holders), context, and the reduction of a
  profile to what is drawn (`reduce.js`). No DOM, tested with Node.
- `tools/` — command lines over the modules: `reduce.js`.
- `web/js/views/` — what draws: the 2D map, the 3D terrain, the flame graph (`flame.js`, over the
  layout in `model/flame.js`), the peaks table. `palette.js` is the
  neutral module for constants that several views share.
- `web/js/components/` — the panels floating over the view, the header's file menu, and the settings
  pane with the controls in it (`form.js` holds the pieces they are built of).
- `web/js/lib/` — `dom.js`, `dialog.js`, `settings.js` (with their `.d.ts` and `web-lib.json`) are copies
  from `../web-lib`; `format.js` is this project's own.
- `test/` mirrors `web/js/`; `test/fixtures/` holds a small real recording and the program that
  made it. Tests use `node:test` and `node:assert/strict`. The heap's tests build their dumps byte
  by byte (`test/hprof/hprof-builder.js`) and parse them with `jheap.wasm` in Node
  (`test/hprof/jheap-parse.js`).
- `samples/` — profiles and dumps tried locally, gitignored, never committed: a heap dump holds
  whatever the process had in memory.

Settings are kept in `localStorage` under `mountaingraph.*` (`view`, `sampling`, `tuning`,
`anonymize`, `peaks.*` for samples, `heap.*` for a heap, `float.*` for the panes, the settings
pane included, `timeline.hold`, `panel.width`); give a new one the same prefix.

## Rules

### Commits

- Commit after each finished unit of work, without asking; amend a later fix into that commit
  rather than adding a fixup. Only amend commits that are not pushed.
- Pushing always needs asking first.
- The message is a sentence or two saying what changed and why, in the style of the history: no
  ticket prefix, no conventional-commit prefix.

### Code

- Plain ES modules and `h()`, no framework, no build step. JSDoc on every module and `// @ts-check`
  at the top; strict tsc must pass.
- One module per view, component or feature, so another project can import just what it needs
  (the terrain, a JFR reader, the peaks). Do not grow a catch-all: split a file past a few hundred
  lines, or one that mixes model and DOM.
- Views must not import constants from other views; shared ones go in `views/palette.js`.
- `model/` and `profile/` stay DOM-free and are tested with Node. A feature that can be tested
  without a browser gets a test under `test/`.

### Copies shared with other projects

`web/js/lib/{dom,dialog,settings}.js` come from `../web-lib` (`web-lib.json` in that directory
lists the modules and the commit copied). Never edit them here: fix web-lib, then run
`npm run sync -- ../mountain-graph/web/js/lib` from `../web-lib` (`--check` tells whether they are
behind). The lib has its own tests; this project has none of them.

`web/js/profile/profile.js` is a byte-identical copy of jfr-web's
(`src/main/resources/jfrweb/ui/js/`), and its test differs only in import paths. Diff against
jfr-web before touching it, and keep the copies identical. A change to `profile.js` or to the
profile format is a jfr-web change first. The format is Flamepack, specified in
[flamepack](https://github.com/pcdv/flamepack) (`../flamepack`): a change to it updates the spec too.

`web/js/hprof/jheap.wasm` is jheap's parser, built and copied here by jheap's
`crates/jheap-wasm/install.mjs`; `jheap.js` follows its exports. A change to the parse (what a
path is, a class object's name) is a jheap change first.
