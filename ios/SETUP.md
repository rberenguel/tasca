# Tasca iOS — Xcode Setup

A WKWebView wrapper that bundles the Tasca PWA and syncs `tasca.json`
automatically via iCloud Drive on every modification.

## Prerequisites

- Xcode 15+
- Apple Developer account ($99/yr needed for iCloud entitlements and
  installing on device without 7-day re-signing)
- iCloud Drive enabled on your iPhone and Mac

---

## 1. Create the Xcode project

1. Open Xcode → **File → New → Project**
2. Choose **iOS → App**
3. Settings:
   - Product Name: `Tasca`
   - Bundle Identifier: `com.yourname.tasca` ← pick anything, just be consistent
   - Interface: **SwiftUI**
   - Language: **Swift**
4. Save the project **inside** `ios/` (e.g. `ios/TascaApp/`)

---

## 2. Add the Swift sources

Delete the generated `ContentView.swift` and `TascaAppApp.swift` that Xcode created.

Drag the four files from `ios/Sources/` into your Xcode project:

- `TascaApp.swift`
- `ContentView.swift`
- `TascaWebView.swift`
- `iCloudSync.swift`

Make sure they are added to the app target (checkbox ticked).

---

## 3. Bundle the web files

The app loads Tasca's HTML/JS/CSS directly from the app bundle.

In Xcode's project navigator:

1. **Right-click** the project group → **Add Files to "TascaApp"**
2. Navigate to the **repo root** (one level above `ios/`)
3. Hold **Option** if needed to see hidden files
4. Select **each of the following** (not the repo root itself):

   | What to add          | Add as              |
   |----------------------|---------------------|
   | `index.html`         | resource (default)  |
   | `src/`               | **Create folder references** ← critical |
   | `fonts/`             | **Create folder references**            |
   | `icon.png`           | resource            |
   | `pwa-manifest.json`  | resource            |
   | `sw.js`              | resource            |

   > **"Create folder references"** preserves the `src/js/`, `fonts/` directory
   > structure inside the bundle. If you accidentally choose "Create groups"
   > the paths will be wrong and the app will show a blank screen.

5. Uncheck **"Copy items if needed"** so Xcode reads from the repo directly
   (edits to JS files take effect on next build without re-adding).

6. Add `ios/bridge.js` as a resource too (same folder reference step, just
   select `ios/bridge.js` and add it — **not** inside the `ios/` subfolder).

---

## 4. Add the iCloud capability

1. Select your app target → **Signing & Capabilities**
2. Click **+ Capability** → add **iCloud**
3. Under iCloud, check **iCloud Documents** (NOT CloudKit)
4. Xcode will add a `.entitlements` file and set up the container
   (`iCloud.com.yourname.tasca` — it uses your bundle ID automatically)

Make sure your Apple Developer account is selected under **Signing**.

---

## 5. Set deployment target

Set minimum deployment target to **iOS 16.0** (Signing & Capabilities →
General → Minimum Deployments).

---

## 6. Build and run

Connect your iPhone, select it as the run destination, hit ▶.

On first launch the app will start with an empty DB (no iCloud file yet).
To bootstrap from your existing data:

**Option A — from your Mac's browser:**
```
save        ← saves to the linked file
```
Then move `tasca.json` into **iCloud Drive → Tasca → Documents** using Finder.
The iOS app will detect the file and load it next time it opens.

**Option B — export from the browser, share to Files:**
```
exp         ← triggers Share Sheet on iOS, save to iCloud Drive/Tasca/Documents/tasca.json
```

---

## How sync works after setup

| Event | What happens |
|---|---|
| You `add`/`done`/`mod` on iPhone | DB writes → 800 ms debounce → JSON pushed to iCloud |
| You open the app | Latest iCloud file pulled and merged into IndexedDB |
| Your phone comes back from sleep | Same as open |
| Mac saves (`save` command) | Mac writes to the same iCloud file → iOS detects change → auto-merges |
| Concurrent edits on both devices | Newer `modified` timestamp wins per task UUID |

### Pointing your Mac at the same file

In the browser on your Mac:
```
link        ← pick iCloud Drive → Tasca → Documents → tasca.json
save        ← write to it
load        ← read from it
```

After that, `save` on Mac → iOS auto-syncs. No more manual import/export.

---

## Troubleshooting

**Blank screen on launch**
→ The web files were added as groups instead of folder references. Remove them,
re-add with "Create folder references".

**iCloud not syncing**
→ Check Settings → [your name] → iCloud → iCloud Drive is on. Also check the
Files app — you should see an "Tasca" folder under iCloud Drive.

**"iCloud not available" (app works but never syncs)**
→ `iCloudSync.documentURL` returned nil. This happens if iCloud entitlements
aren't set up or the Developer account isn't signed in on the device.

**Keyboard pops open immediately**
→ The HTML has `autofocus` on the input. To suppress this on iOS, add
`webView.configuration.preferences.isElementFullscreenEnabled = false`
or remove `autofocus` from `index.html` (it only affects mobile).
