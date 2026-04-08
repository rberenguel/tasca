# Session Compaction Summary

## User Intent

- Implement a "streams" concept: parallel open-ended workstreams that live outside the urgency/next process
- Add a `zip` inline annotation expander for quick peeking at task notes
- Bump PWA and Chrome extension to v0.21.0

## Contextual Work Summary

### Streams Data Model

- A stream is a regular task with the `stream` tag — no new DB fields
- Urgency is hardcoded to `-1000.0` (constant `C.stream`), immune to age/priority/due bumping
- `!stream` virtual tag added to `logic.js` with shorthand `!str` (avoiding `!s` = `!scheduled` conflict)
- `isVirtualTag` and `hasVirtualTag` updated accordingly

### Stream Commands

- `stream <desc> [opts]` / `s <desc>` — adds a task with `!stream` appended, then auto-sets `start` (new streams land in "active" section immediately)
- Auto-start implemented by snapshotting UUIDs before `handleAdd`, then finding the new task and setting `start` after
- `s` and `stream` registered in `commands-registry.js`; `stream`, `s`, `ss`, `zip` added to `VALID_COMMANDS`

### Stream View (`ss`)

- Uses the **real context system** (localStorage, same as `today`/`day`) — `ss` sets context to `!stream` via `handleContext`, so the view survives tab switches and autosave refreshes
- `runList` detects `isStreamView` from `!stream` in effectiveArgs and delegates to `handleStreams` (early return after `setLastFilterArgs`, so args are persisted first)
- `handleStreams` in `commands-streams.js`: two sections — **active** (started) and **yielding** (not started), sorted by `order:` then entry
- Yielding rows styled with `filter: saturate(0.4) brightness(0.7)`; active rows are plain (no `row-active` class)
- `list` excludes streams by default (like `!someday`); `next` includes them at bottom via -1000 urgency

### Zip Command

- `zip <ID>` / `z <ID>` — toggles inline annotation expansion below a task row; `z` resolves to `zip` automatically (only command starting with `z`)
- `z *` — opens all annotated visible tasks if any are closed; closes all if all are open
- `zippedUuids` Set in `state.js` (session-only, not persisted)
- `renderZipExpansion` added to `ui.js` (before `renderTable`), inserted after each task row in the render loop
- `handleStreams` also checks `zippedUuids` and renders `renderZipRow` — zip works in both list and stream view

### Bug Fixes

- Fixed `isStreamView` TDZ error: redirect moved to after the pre-scan block where the variable is declared
- Fixed stream view not persisting across tab switches: replaced `SS_SENTINEL`/`lastViewFn` hacks with real context (the correct approach matching `today`)
- Fixed `zip` doing nothing in stream view: `handleStreams` was unaware of `zippedUuids`

### Documentation & Versioning

- `STREAM_TODO.md` created: full spec for Go CLI implementer covering tag semantics, urgency, commands, view layout, zip behaviour
- `README.md`: Streams section added, command table updated, virtual tags updated
- `CLAUDE.md`: Streams section added, architecture file list updated
- `tests/test_streams.js` + registered in `tests/index.html`
- Version bumped `0.20.0` → `0.21.0` in `pwa-manifest.json`, `manifest.json`, `sw.js`

## Files Touched

### Core Logic

- **src/js/logic.js**: `C.stream = -1000`, stream urgency early return, `!stream` virtual tag + `!str` shorthand, `zip`/`s`/`ss`/`stream` in `VALID_COMMANDS`
- **src/js/list.js**: `isStreamView` detection, early redirect to `handleStreams`, stream exclusion from default list, streams kept in `next` negative-urgency filter; imports `handleStreams`
- **src/js/state.js**: `zippedUuids` Set added

### New Files

- **src/js/commands-streams.js**: `handleStreams` — stream view renderer with active/yielding sections, zip expansion support

### Commands

- **src/js/commands-registry.js**: `stream`, `s`, `ss`, `zip` registered; `ss` delegates to `handleContext(["!stream"])`
- **src/js/commands-tasks.js**: `handleZip` with single-ID toggle and `*` bulk toggle; imports `zippedUuids`
- **src/js/commands-misc.js**: `zip`, `stream`, `ss` added to help index and `help [cmd]` entries
- **src/js/commands.js**: `ss` added to passthrough list

### UI

- **src/js/ui.js**: `renderZipExpansion` helper; zip expansion inserted in `renderTable` render loop; imports `zippedUuids` from state

### Tests & Docs

- **tests/test_streams.js**: urgency, virtual tag, shorthand, E2E add, list exclusion, ss section ordering
- **tests/index.html**: test_streams.js registered
- **STREAM_TODO.md**: Go CLI implementation spec
- **README.md**, **CLAUDE.md**: streams and zip documented
- **pwa-manifest.json**, **manifest.json**, **sw.js**: v0.21.0
