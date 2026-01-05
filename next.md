# Architectural Improvements

## 1. Add Modification Tracking TODO
* **Problem**: The current data model lacks a way to track when a record was last changed. This prevents features like "unsaved changes" indicators or intelligent conflict resolution in the future.
* **Solution**: Update the `add` and `update` methods in `db.js` (for both tasks and projects) to automatically inject a `modified: Date.now()` field into the object before saving it to IndexedDB.

## 2. Fix `getAll()` Bottleneck in List View TODO
* **Problem**: The `runList` function fetches every single task from the database (including completed and deleted ones) on every render. This creates an O(N) performance degradation as history grows.
* **Solution**: Utilize the existing `status` index in IndexedDB. Implement a `dbOps.getByStatus('pending')` method. Update `runList` to default to fetching only pending tasks, falling back to `getAll()` only when specific filters (like `status:completed` or global search) require it.

## 3. Reduce DOM Thrashing TODO
* **Problem**: `ui.js` rebuilds the entire table's HTML string and sets `innerHTML` on every update. This forces the browser to re-parse and re-layout the entire list, causing visual stuttering on larger lists or mobile devices.
* **Solution**: Refactor `renderTable` to use a more efficient rendering strategy. A simple improvement is to use `document.createElement` and `appendChild` fragments rather than a giant HTML string. For a robust fix, implement a simple "virtual list" that only renders the rows currently visible in the viewport.

## 4. Externalize Hardcoded Limits TODO
* **Problem**: Logic for urgency calculations (e.g., `ageDays > 100`) and view limits relies on hardcoded magic numbers scattered throughout `logic.js` and `list.js`. This makes the system brittle and difficult to tune as the dataset ages.
* **Solution**: Extract these constants into a centralized configuration object (e.g., extending the existing `C` object in `logic.js` or a dedicated `config.js`). Reference these named constants in the logic to allow for easier tuning and maintenance.