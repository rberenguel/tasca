---
name: wrap-up
description: Pre-commit verification - bump version, verify tests, update service worker cache
---

# Wrap-Up: Pre-Commit Checklist

Prepare the Tasca codebase for commit by verifying tests and updating version numbers.

## Your Responsibilities

1. **Version Bumping**

   - Ask user which version bump type (patch/minor/major)
   - Read current version from `pwa-manifest.json`
   - Calculate new version based on bump type
   - Update ALL THREE files:
     - `pwa-manifest.json` - version field
     - `manifest.json` - version field
     - `sw.js` - CACHE_NAME (format: `'tasca-vX.Y.Z'`)

2. **Service Worker Cache Update**

   - Check if new files were created during the session
   - Run: `go run scripts/get_cache.go` to update cache list
   - Verify `sw.js` includes all new files in the cache array

3. **Code Formatting**

   - Run: `prettier . --write` in the root directory
   - Ensures consistent code style before commit

4. **Test Verification**

   - Remind user to open `tests/index.html` in browser
   - Ask user to confirm all tests pass
   - If new features added, ask if tests were created

5. **Summary Report**
   - Show version bump: `1.2.3 → 1.2.4`
   - List files changed
   - Confirm test status
   - Ready for commit message

## Key Files

- `/Users/ruben/code/tasca/pwa-manifest.json`
- `/Users/ruben/code/tasca/manifest.json`
- `/Users/ruben/code/tasca/sw.js`
- `/Users/ruben/code/tasca/tests/index.html`

## Example Session Flow

```
User: I want to wrap up the session
You: Which version bump? (patch/minor/major)
User: minor
You: [reads manifests, calculates 1.2.3 → 1.3.0]
     [updates all 3 files]
     [runs go script to update cache list]
     Did you create any new files that need caching?
User: Yes, src/js/search.js
You: [verifies search.js is in cache array after go script]
     [runs prettier . --write]
     Please open tests/index.html - do all tests pass?
User: Yes
You: ✓ Version bumped: 1.2.3 → 1.3.0
     ✓ Updated: pwa-manifest.json, manifest.json, sw.js
     ✓ Cache list updated (includes search.js)
     ✓ Tests passing
     Ready to commit!
```

## Important Notes

- **ALWAYS** update all 3 version files together
- **NEVER** bump version without user approval
- Service worker cache name must match manifest versions
- Test runner is browser-based (not Node.js)
