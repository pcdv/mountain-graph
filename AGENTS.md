# MountainGraph

A profile drawn as a landscape: the methods where the time goes are mountain peaks, and the call
paths that lead to them are the slopes around each one. A static page with no build step and no
server behind it. It answers "why do we keep ending up here?", where a flame graph answers "where
is the time spent?".

Created 2026-10-18 out of jfr-web, and follows jfr-web's rules (which follow flak's). The plan and
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

Node 21 or later, nothing to install. Run the tests and the type check before claiming a change
works; both are expected to be green. There is no build step, no linter and no formatter.

## Layout

- `web/index.html`, `web/css/app.css` — the page. three.js 0.160.0 is pinned in its import map:
  the only dependency, loaded when the 3D view is first shown.
- `web/js/main.js` — wiring only: opening a file, the top bar, the floating panels, the settings.
- `web/js/load.js` — a picked or dropped file to a `Profile`: jfr-web's format (version 4, or 3),
  collapsed stacks, or a JFR recording, gzipped or not.
- `web/js/profile/` — the format readers (`profile.js`, `collapsed.js`, `jfr.js`). No DOM.
- `web/js/model/` — the analysis: peaks, callers, terrain, contours, divides, hues, timeline,
  anonymizing. No DOM, tested with Node.
- `web/js/views/` — what draws: the 2D map, the 3D terrain, the peaks table. `palette.js` is the
  neutral module for constants that several views share.
- `web/js/components/` — the panels and controls floating over the view.
- `web/js/lib/` — `dom.js`, `dialog.js`, `settings.js` are copies of jfr-web's; `format.js` is this
  project's own.
- `test/` mirrors `web/js/`; `test/fixtures/` holds a small real recording and the program that
  made it. Tests use `node:test` and `node:assert/strict`.
- `samples/` — profiles tried locally, gitignored, never committed.

Settings are kept in `localStorage` under `mountaingraph.*` (`view`, `sampling`, `tuning`,
`anonymize`, `peaks.*`, `timeline.hold`, `panel.width`); give a new one the same prefix.

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

### Copies shared with jfr-web

`web/js/lib/{dom,dialog,settings}.js` and `web/js/profile/profile.js` are byte-identical copies of
jfr-web's (`src/main/resources/jfrweb/ui/js/`), and their tests differ only in import paths. Diff
against jfr-web before touching one, keep the copies identical, and port a change to jfr-web
rather than letting them drift. A change to `profile.js` or to the profile format is a jfr-web
change first.
