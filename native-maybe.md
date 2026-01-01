# Native Mac/iOS App for Tasca

This document outlines a plan to create native Mac and iOS apps for Tasca using Capacitor, with iCloud sync replacing IndexedDB.

## Why Capacitor?

- Wraps existing web app with minimal changes
- Official iOS/macOS support
- JavaScript-to-native bridge built-in
- Community plugins for iCloud
- No Swift knowledge required for basics (though helpful for custom plugins)

## Architecture Overview

```
┌────────────────────────────────────────┐
│           Existing Tasca UI            │
│      (HTML, CSS, JS - unchanged)       │
├────────────────────────────────────────┤
│         Modified db.js layer           │
│   (calls Capacitor plugin instead of   │
│         IndexedDB directly)            │
├────────────────────────────────────────┤
│       Capacitor Bridge Layer           │
├────────────────────────────────────────┤
│    iCloud Storage Plugin (Native)      │
│  - iOS: CloudKit or iCloud Documents   │
│  - macOS: Same, via Catalyst or native │
└────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Basic Capacitor Setup

1. **Install Capacitor in the project**
   ```bash
   npm init -y  # if no package.json
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init Tasca com.yourdomain.tasca --web-dir=.
   ```

2. **Add iOS platform**
   ```bash
   npx cap add ios
   ```

3. **Test the wrapper** (still using IndexedDB at this point)
   ```bash
   npx cap open ios
   # Build and run in Xcode
   ```

### Phase 2: Storage Abstraction

Create a storage abstraction layer so we can swap IndexedDB for iCloud **while keeping the web app fully functional**.

**Goal:** Same codebase, different storage backends:
- **Web/PWA (Android, desktop browsers, restricted systems):** IndexedDB (unchanged)
- **Native iOS/macOS app:** iCloud Documents or CloudKit

1. **Create `src/js/storage.js`** - Abstract interface
   ```javascript
   // Storage backend factory
   // Detects environment and returns appropriate implementation

   export const createStorage = async () => {
     // Native app (Capacitor) → iCloud
     if (window.Capacitor?.isNativePlatform()) {
       const { ICloudStorage } = await import('./storage-icloud.js');
       return new ICloudStorage();
     }
     // Web/PWA → IndexedDB (existing behavior)
     const { IndexedDBStorage } = await import('./storage-indexeddb.js');
     return new IndexedDBStorage();
   };
   ```

2. **Extract current IndexedDB logic to `src/js/storage-indexeddb.js`**
   ```javascript
   // This is essentially the current db.js, wrapped in a class
   export class IndexedDBStorage {
     async init() { /* existing initDB */ }
     async getAll() { /* existing dbOps.getAll */ }
     async add(task) { /* existing dbOps.add */ }
     async update(task) { /* existing dbOps.update */ }
     async delete(uuid) { /* existing dbOps.delete */ }
     // ... etc
   }
   ```

3. **Create `src/js/storage-icloud.js`** (native only)
   ```javascript
   // Calls Capacitor plugin for iCloud storage
   export class ICloudStorage {
     async init() { /* init iCloud plugin */ }
     async getAll() { /* load from iCloud */ }
     async add(task) { /* save to iCloud */ }
     // ... same interface as IndexedDBStorage
   }
   ```

4. **Modify `db.js`** to use the abstraction
   ```javascript
   import { createStorage } from './storage.js';

   let storage = null;

   export const initDB = async () => {
     storage = await createStorage();
     return storage.init();
   };

   export const dbOps = {
     getAll: () => storage.getAll(),
     add: (task) => storage.add(task),
     // ... delegate all methods to storage backend
   };
   ```

**Result:**
- Web users see no change (IndexedDB still works)
- Native app users get iCloud sync
- Same UI, same commands, same experience
- No feature flags or build-time switches needed

### Phase 3: iCloud Plugin

**Option A: Use existing plugin**

There's `capacitor-icloud-documents` or similar community plugins:
```bash
npm install capacitor-icloud-documents
npx cap sync
```

**Option B: Create custom plugin** (if existing ones don't fit)

This requires some Swift, but it's mostly boilerplate. AI can help generate it.

Basic structure:
```
ios/App/App/plugins/
└── ICloudStoragePlugin/
    ├── ICloudStoragePlugin.swift
    └── ICloudStoragePlugin.m  (bridge header)
```

The plugin would expose methods like:
- `saveData(key: string, data: string)`
- `loadData(key: string) -> string`
- `deleteData(key: string)`
- `listKeys() -> string[]`

### Phase 4: iCloud Configuration

1. **Apple Developer Account** required ($99/year)

2. **Enable iCloud capability in Xcode**
   - Open `ios/App/App.xcworkspace`
   - Select App target → Signing & Capabilities
   - Add "iCloud" capability
   - Enable "CloudKit" or "iCloud Documents"

3. **Create iCloud container**
   - In Apple Developer portal
   - Or let Xcode create it automatically

### Phase 5: Data Sync Strategy

**Simple approach: JSON file in iCloud Documents**
```
iCloud Drive/
└── Tasca/
    ├── tasks.json      # All tasks
    └── projects.json   # Project metadata
```

Pros:
- Simple to implement
- Human-readable backup
- Works offline, syncs when online

Cons:
- Full file sync (not granular)
- Potential conflicts if editing on multiple devices simultaneously

**Conflict resolution:**
- Last-write-wins (simple)
- Or merge by UUID + modified timestamp (more robust)

### Phase 6: macOS App

Two options:

1. **Mac Catalyst** (easier)
   - Check "Mac" in Xcode deployment targets
   - iOS app runs on Mac with minimal changes

2. **Separate macOS target** (better native feel)
   ```bash
   npm install @nicholasday/capacitor-macos  # Community plugin
   # Or use Electron as alternative
   ```

## File Changes Summary

| File | Changes |
|------|---------|
| `db.js` | Add Capacitor detection, use plugin when native |
| `package.json` | New file, Capacitor dependencies |
| `capacitor.config.ts` | New file, Capacitor configuration |
| `ios/` | New directory, Xcode project |

## Alternative: Simpler iCloud Sync

If full native feels too complex, a simpler approach:

1. Keep it as a PWA
2. Add "Export to iCloud" / "Import from iCloud" buttons
3. Use the File System Access API (already used for `link`/`save`/`load`)
4. User manually selects a file in iCloud Drive

This already mostly works with the current `link`/`save`/`load` commands!

## Development Timeline Estimate

| Phase | Effort |
|-------|--------|
| Phase 1: Capacitor setup | 1-2 hours |
| Phase 2: Storage abstraction | 2-4 hours |
| Phase 3: iCloud plugin | 4-8 hours (depending on existing plugins) |
| Phase 4: iCloud configuration | 1-2 hours |
| Phase 5: Sync strategy | 2-4 hours |
| Phase 6: macOS | 2-4 hours |
| Testing & debugging | 4-8 hours |

**Total: 2-4 days of focused work**

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Capacitor iOS Guide](https://capacitorjs.com/docs/ios)
- [CloudKit Documentation](https://developer.apple.com/documentation/cloudkit)
- [iCloud Documents Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/iCloudDesignGuide/)

## Questions to Decide

1. **iCloud Documents vs CloudKit?**
   - Documents: Simpler, file-based, user-visible in iCloud Drive
   - CloudKit: More powerful, database-like, invisible to user

2. **Conflict resolution strategy?**
   - Last-write-wins (simple but can lose data)
   - Merge by task UUID (more complex but safer)

3. **Offline-first or sync-first?**
   - Offline-first: Always works, syncs in background (recommended)
   - Sync-first: Requires connectivity

4. **TestFlight/App Store distribution?**
   - Requires Apple Developer account
   - App Store review process
   - Or: Ad-hoc distribution for personal use only
