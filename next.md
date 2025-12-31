# Next Features

## ~~1. Contexts (GTD)~~ DONE (v0.0.26)

---

## ~~2. Scheduled Date~~ DONE (v0.0.27)

`sched:DATE` or `scheduled:DATE` - "start working on this date" (not deadline).

- Tasks with future `sched:` hidden from `list`/`next` (like `wait:`)
- `!scheduled` virtual tag to view them
- Preserved in recurrence (offset from due)

---

## ~~3. Recurrence Tests~~ DONE (v0.0.27)

Extracted `calculateNextRecurrence()` to utils.js for testability. Tests cover:

- daily, weekly, monthly, yearly periods
- Abbreviated patterns (dai, wee, mon, yea)
- wait/sched offset preservation
- Edge cases

---

## ~~4. Calendar View~~ DONE (v0.0.27)

`cal` / `calendar` command - agenda view of dated tasks.

- Shows `[due]`, `[sched]`, `[wait]` labels grouped by date
- Supports filters: `cal pro:Project !tag search`
- `cal lim:N` sets days to show (persisted)
- Past 7 days of overdue shown
- `!done` shows completed tasks by end date

---

## ~~5. Relative Dates~~ DONE (v0.0.27)

Date fields (`due:`, `wait:`, `sched:`) now accept:

- `today` / `tod`, `tomorrow` / `tom`, `yesterday`
- `Nd` (days), `Nw` (weeks), `Nm` (months)
- Still supports `YYYYMMDD`

---

## ~~6. Unified Recurrence Syntax~~ DONE (v0.0.28)

Recurrence now uses same syntax as relative dates:

- `recur:1d` (daily), `recur:3d` (every 3 days)
- `recur:1w` (weekly), `recur:2w` (biweekly)
- `recur:1m` (monthly), `recur:1y` (yearly)
- Legacy `daily`, `weekly`, `monthly`, `yearly` still work

---

## ~~7. Skip Command~~ DONE (v0.0.28)

`skip <ID>` for recurring tasks:

- Marks current occurrence as "skipped" (not "completed")
- Creates next occurrence
- Keeps history of skipped occurrences

---

## 8. Undo

Transaction log for reversing operations.

- Store last N operations in IndexedDB (task snapshots before modification)
- `undo` command reverses the most recent operation
- Show what will be undone before doing it

---

## Notes

- Active task urgency boost: DONE (C.active = 4.0)
- Age-based urgency: Already existed (C.age = 2.0, scales over 100 days)
- Relative recurrence: Skipped (complexity vs value)
