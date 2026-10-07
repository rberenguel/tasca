# Session Compaction Summary

## User Intent
- Investigate whether task creation time is stored and why `info` doesn't show it
- Add creation time to the `info` command output
- Fix tab-switching triggering unintended `next` command
- Bump patch version

## Contextual Work Summary

### Bug Investigation: `info` missing creation date
- `entry` field (a `uniqueTimestamp()`) is set on every task at creation time
- `handleInfo` in `commands-tasks.js` rendered all other fields but omitted `entry`
- Simple omission — no architectural issue

### Feature: Show creation date in `info`
- Added `Created:` line to `handleInfo` output using existing `formatDate` helper
- Inserted after the `Status:` line for logical ordering

### Bug Fix: Tab visibility triggering `next`
- `visibilitychange` handler in `app.js` called `execute("next")` after auto-loading sync file
- This reset the user's current view whenever switching back to the tab
- Changed to `runList(lastFilterArgs, lastLimit)` to refresh the current view instead
- `next` after the file picker import is intentional and left unchanged
- Added `lastLimit` to the `state.js` import in `app.js`

### Version Bump
- `manifest.json` and `sw.js` were at `0.21.3`; `pwa-manifest.json` was lagging at `0.21.2`
- All three files bumped to `0.21.4` to re-sync and apply patch bump

## Files Touched

### Core Logic
- **src/js/commands-tasks.js**: Added `Created:` field to `handleInfo` output

### App Initialization
- **src/js/app.js**: Fixed `visibilitychange` handler to use `runList` instead of `execute("next")`; added `lastLimit` import from `state.js`

### Version Files
- **pwa-manifest.json**: Bumped `0.21.2` → `0.21.4`
- **manifest.json**: Bumped `0.21.3` → `0.21.4`
- **sw.js**: Bumped `CACHE_NAME` to `tasca-cache-v0.21.4`
