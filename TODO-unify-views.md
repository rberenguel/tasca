# Unify Today and Streams Views

## Problem

`commands-streams.js` has its own hand-rolled `renderRow` function that duplicates
logic already in `ui.js`'s `renderTaskRow`. Every time a new feature lands in
`renderTaskRow` (track markers, blocker counts, checklist icons, URL fix we just
made, etc.) the streams view silently falls behind.

Same issue will affect any future custom view (report sections, chain view, etc.).

## Goal

Extract a shared, parameterised row-renderer from `ui.js` that both the today/list
view **and** the streams view call. Config objects control what gets shown or
overridden rather than copy-pasting DOM construction.

---

## Plan

### 1. Export a `renderTaskRow` factory from `ui.js`

Move the inner `renderTaskRow` closure out into an exported function with a config
object as its last argument:

```js
// ui.js
export const renderTaskRow = (t, index, allTasks, projects, config = {}) => { … }
```

Config shape (all optional, defaults shown):

```js
{
  showUrgency:     true,    // false → empty urgency cell (streams, checklist members)
  showOrder:       false,   // true in today view
  showDue:         true,    // false hides due-date pill
  showProject:     true,
  showTags:        true,    // streams filters "stream" tag — pass filteredTags instead
  filteredTags:    null,    // if set, used instead of t.tags (for tag suppression)
  rowFilter:       null,    // CSS filter string, e.g. "saturate(0.4) brightness(0.7)"
  isTodayView:     false,   // suppresses "0d" due pill
}
```

The function already has most of this logic; the internal `isTodayView` flag just
becomes `config.isTodayView`.

### 2. Export `renderZipRow` (annotation expansion) from `ui.js`

The streams view has its own `renderZipRow`. `ui.js` doesn't expose one yet
(zipped rows may live in the list rendering loop). Extract and export it so streams
can share it too.

### 3. Rewrite `commands-streams.js::renderRow` to call the shared renderer

```js
import { renderTaskRow, renderZipRow } from "./ui.js";

const renderRow = (t, idx, isYielding) =>
  renderTaskRow(t, idx, allTasks, projects, {
    showUrgency: false,
    showOrder: true,
    filteredTags: (t.tags || []).filter((tg) => tg.toLowerCase() !== "stream"),
    rowFilter: isYielding ? "saturate(0.4) brightness(0.7)" : null,
  });
```

All the duplicated icon/URL/annotation/tag/project DOM code in `commands-streams.js`
goes away.

### 4. Clean up internal `isTodayView` usage in `ui.js`

Currently `isTodayView` is captured from the outer `renderTasks` closure. After the
refactor it becomes a config field, so the inner function is no longer a closure
over it. This also makes `renderTaskRow` unit-testable in isolation.

### 5. (Optional) Same treatment for `renderChecklistMemberRow`

That function also duplicates icon, URL, recur and wait rendering. It could accept
the same config and share the icon/URL/recur block with `renderTaskRow`. Lower
priority since it's within `ui.js` already.

---

## Files to change

| File                         | Change                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `src/js/ui.js`               | Export `renderTaskRow` and `renderZipRow`; convert `isTodayView` closure var to config field |
| `src/js/commands-streams.js` | Delete `renderRow` / `renderZipRow`; import and call shared versions with streams config     |

## What stays in `commands-streams.js`

- Data fetching and filtering (stream tag filter, active/yielding split)
- Section header rendering (`renderSection`)
- Sort logic (`sortStreams`)
- Footer stats
- `displayMapRef` wiring

## Testing checklist after refactor

- [ ] `ss` shows active/yielding sections correctly
- [ ] URL link icon appears on streams with `url:`
- [ ] Icon + color renders on streams
- [ ] Tags shown (minus the "stream" tag)
- [ ] Annotations expand on zip
- [ ] Today view unaffected (order badge, 0d suppression, checklist expansion)
- [ ] Next view unaffected (checklist summary counts)
