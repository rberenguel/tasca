# Session Compaction Summary

## User Intent

- Add Chrome extension sidebar support so Tasca can be used alongside any webpage
- Provide keyboard shortcuts to open the sidebar and jump to the Tasca tab
- Bump minor version to 0.18.0 and document the new extension features

## Contextual Work Summary

### Sidebar Architecture

- Chrome's `sidePanel` API (`chrome.sidePanel`) was added alongside the existing popup/tab extension
- After significant debugging, established that custom `onCommand` handlers cannot reliably call `chrome.sidePanel.open()` — the user gesture context is apparently lost or the API fails silently
- Solution: use `_execute_action` + `setPanelBehavior({ openPanelOnActionClick: true })`, the same pattern used by the lloro project — Chrome handles the sidebar open natively, bypassing the service worker entirely

### Keyboard Shortcut Debugging

- User tried 5+ different shortcuts for a custom `toggle-sidebar` command with no success
- Ruled out shortcut conflicts (all 5 failed)
- Compared against working lloro extension which uses `_execute_action` not custom commands
- `_execute_action` fires `onClicked` OR Chrome handles natively depending on `setPanelBehavior`
- Key constraint: `_execute_action` cannot differentiate keyboard vs. mouse click, making it impossible to have action button → tab AND keyboard → sidebar using the same command

### Final Keyboard Shortcut Design

- `Ctrl+Shift+Y` → sidebar via `_execute_action` + `setPanelBehavior(true)` (Chrome-native, reliable)
- `Ctrl+Shift+U` → open Tasca tab via new `open-tab` custom `onCommand` handler (no user gesture restriction on `openTascaTab()`)
- `Ctrl+Shift+T` → add from current tab (unchanged)
- Action button click also opens sidebar (side effect of `setPanelBehavior(true)`)

### Regressions Introduced and Fixed

- Accidentally removed `openTascaTab` from `onClicked` while changing action button behavior — restored
- `setPanelBehavior({ openPanelOnActionClick: false })` fully broke the sidebar — removed (default is already false, explicit call was harmful)
- Briefly used `_execute_side_panel` as a built-in command — not a real Chrome API, removed

### Version Bump and Docs

- Bumped 0.17.2 → 0.18.0 across all three required files
- Added Chrome Extension section to README covering sidebar, shortcuts table, and add-from-tab

## Files Touched

### Chrome Extension

- **manifest.json**: Added `sidePanel` permission, `side_panel.default_path`, new `open-tab` command (`Ctrl+Shift+U`), changed `_execute_action` to `Ctrl+Shift+Y` for sidebar; version 0.18.0
- **background.js**: Added `setPanelBehavior({ openPanelOnActionClick: true })`, removed `onClicked` → `openTascaTab` (action button now opens sidebar), added `open-tab` handler in `onCommand`

### Version Files

- **pwa-manifest.json**: 0.17.2 → 0.18.0
- **sw.js**: Cache name updated to `tasca-cache-v0.18.0`

### Documentation

- **README.md**: New "Chrome Extension" section with shortcuts table, sidebar description, and add-from-tab description
