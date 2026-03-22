# Session Compaction Summary

## User Intent
- Wrap the Tasca PWA in a native iOS app (SwiftUI/WKWebView) for iPhone use
- Eliminate manual iCloud import/export by auto-syncing on every modification
- Clean up the repo for public visibility after the feature was working

## Contextual Work Summary

### iOS App Scaffold
- Created Xcode project at `ios/Tasca/` with SwiftUI entry point
- WKWebView loads bundled web assets via a custom `tasca://` URL scheme handler (`TascaSchemeHandler`) to avoid iOS sandbox restrictions with `file://`
- Web files are copied into the app bundle at build time via a Run Script phase (`ios/copy-web.sh`) that uses `rsync` — avoids all Xcode folder reference issues

### JS ↔ Swift Bridge
- `ios/bridge.js` injected at `documentStart`: sets `window.__TASCA_NATIVE__`, defines debounced `__tascaScheduleSave`, and `window.tascaLoad` entry point
- `db.js`: `add`, `update` (touch=true only), `updateProject` (touch=true only) call `__tascaScheduleSave` after writes — `touch:false` (imports) deliberately excluded to break feedback loops
- `app.js`: exposes `__tascaSerialize` and `__tascaImport` (merge by `modified` timestamp, newer wins per UUID) for both native and browser contexts; signals Swift via `messageHandlers.ready`; defines browser `__tascaScheduleSave` (auto-save to linked file via File System Access API) and `visibilitychange` auto-load

### iCloud Sync — Final Architecture
- Switched from hidden iCloud container (`url(forUbiquityContainerIdentifier:)`) to user-picked file via `UIDocumentPickerViewController`
- `iCloudSync.swift`: stores a security-scoped bookmark in `UserDefaults`; `link(to:)` saves bookmark, `read()`/`write()` resolve it with `startAccessingSecurityScopedResource`
- `link` command on iOS posts to native `link` message handler → shows document picker; after pick, loads existing file content then immediately saves current DB
- Feedback loop fix: write cooldown (`lastWriteTime`) + `touch:false` suppression

### Browser Auto-Sync (Chrome Extension)
- `app.js` defines `__tascaScheduleSave` for non-native context: debounced 1s, checks `queryPermission` before writing to linked file
- `visibilitychange` listener auto-loads from linked file when tab becomes visible (covers "switched back after using extension" case)

### Cleanup & Versioning
- Bumped all versions `0.19.0` → `0.20.0`: `pwa-manifest.json`, `manifest.json`, `sw.js` cache name, iOS `MARKETING_VERSION` in `project.pbxproj`
- `.gitignore`: added `xcuserdata/`, `*.xcuserstate`, `DerivedData/`, `*.entitlements`
- Untracked `xcuserdata/` dirs, `Tasca.entitlements` (contains personal Apple Developer ID)
- README: added iOS App section with setup summary, `link` workflow, annual rebuild note

## Files Touched

### iOS — Swift
- **ios/Tasca/Tasca/TascaWebView.swift**: Custom scheme handler, WKWebView setup, document picker delegate, message handlers (ready/autoSave/link/log)
- **ios/Tasca/Tasca/iCloudSync.swift**: Full rewrite — security-scoped bookmark approach replacing iCloud container
- **ios/Tasca/Tasca/TascaApp.swift**: App entry point (unchanged from scaffold)
- **ios/Tasca/Tasca/ContentView.swift**: Root SwiftUI view (unchanged from scaffold)
- **ios/Tasca/Tasca.xcodeproj/project.pbxproj**: Version bump, build settings

### iOS — Support
- **ios/bridge.js**: Native bridge injected at documentStart
- **ios/copy-web.sh**: Build script that copies web assets into bundle `Web/` directory
- **ios/SETUP.md**: Step-by-step Xcode setup guide

### PWA — Core
- **src/js/db.js**: `__tascaScheduleSave` hook on write operations (touch=true only)
- **src/js/app.js**: `__tascaSerialize`, `__tascaImport`, native ready signal, browser auto-sync setup
- **src/js/commands-data.js**: `handleLink` intercepts to native picker on iOS
- **index.html**: Service worker registration guarded by `!window.__TASCA_NATIVE__`

### Config & Docs
- **.gitignore**: Xcode artifacts and entitlements excluded
- **README.md**: iOS App section added
- **manifest.json**, **pwa-manifest.json**, **sw.js**: Version `0.20.0`
