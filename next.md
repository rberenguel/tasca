# Next Features

## ~~1. Contexts (GTD)~~ DONE (v0.0.26)

---

## 2. Undo

Transaction log for reversing operations.

- Store last N operations in IndexedDB (task snapshots before modification)
- `undo` command reverses the most recent operation
- Show what will be undone before doing it

---

## 3. Scheduled Date

`sched:YYYYMMDD` or `scheduled:YYYYMMDD`

Different from `due:` - this is "start working on this date" not "deadline".

- Tasks with `sched:` in the future are hidden from `list`/`next` (like `wait:`)
- When scheduled date arrives, task appears
- Could boost urgency when scheduled date passes (similar to due)

---

## 4. Recurrence Tests

**WARNING: No tests exist for recurrence logic.**

The recurrence code in app.js (done command) handles:
- daily, weekly, monthly, yearly
- Creating next instance with new UUID
- Copying wait offset relative to due

Needs test coverage before any changes. Classic nightmare territory.

---

## Notes

- Active task urgency boost: DONE (C.active = 4.0)
- Age-based urgency: Already existed (C.age = 2.0, scales over 100 days)
- Relative recurrence: Skipped (complexity vs value)
