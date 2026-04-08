# Stream & Zip — Go CLI Implementation Notes

Everything here was added to the JS PWA and needs parity in the Go TUI.

---

## 1. `!stream` Virtual Tag

### Data model

A stream is a regular task with the tag `stream`. No new fields. Stored in `tasca.json` like any other task.

### Urgency

Stream tasks return a hardcoded urgency of **-1000.0**, regardless of age, priority, due date, or any other factor. No age bumping, no due-date scaling. The constant is intentionally absurd to keep streams permanently below all real tasks.

### Virtual tag

- Full name: `!stream`
- Shorthand: `!str` (note: `!s` is already taken by `!scheduled`)
- `hasVirtualTag(t, "stream")` → `t.tags contains "stream"` (case-insensitive)

### Effect on `list`

`list` (no limit) excludes stream tasks by default, the same way it excludes `!someday` tasks. They only appear when explicitly filtered with `list !stream`.

### Effect on `next`

`next` (limited list) **includes** stream tasks. Their -1000 urgency means they always appear at the very bottom. This is intentional — a quick reminder they exist without polluting the actionable list.

---

## 2. `stream` / `s` Commands

### Syntax

```
stream <description> [options]
s <description> [options]
```

Accepts all the same options as `add` (project, tags, due, wait, priority, etc.). The implementation simply appends `!stream` to the args and delegates to `add`.

### Auto-start

New streams are **automatically started** (i.e., `start` timestamp is set at creation time). This puts them in the "active" section of the stream view immediately. The rationale: a stream is something currently in flight, not a backlog item.

### Example

```
stream investigate backpressure in autoraters pro:Infra
s ping Salim
```

---

## 3. `ss` — Stream View

### Behaviour

`ss` sets the real persistent context to `!stream` (same localStorage/config mechanism as `today` sets `!today`), then renders the stream view. This means:

- The view survives tab switches, auto-reloads, and autosave refreshes
- `c` (clear context) exits the stream view and returns to normal
- Any mutation (`start`, `stop`, `annotate`, `done`, etc.) re-renders the stream view in place

### Layout

Two sections, in order:

**active** — streams with `start` set
**yielding** — streams without `start`

Within each section, tasks are sorted by `order:N` ascending (nulls last), then by `entry` ascending (older first).

Columns shown: **ID · description · project · visible tags**
Columns omitted: urgency, priority (irrelevant for streams)

The `stream` tag itself is hidden from the tag display (it's implied).

### Visual treatment

- Active rows: normal text, no special styling
- Yielding rows: `filter: saturate(0.4) brightness(0.7)` — slightly desaturated and darkened to convey "waiting / not currently moving"

### Moving between sections

```
start <ID>   — moves stream to active
stop <ID>    — moves stream to yielding
```

Standard commands, no new mechanics.

### Footer

```
N streams (X active, Y yielding).
```

### Annotations count

If a stream has annotations, a `msg:N` badge is shown in the description cell (same as regular list).

---

## 4. `zip` / `z` — Inline Annotation Expander

### Syntax

```
zip <ID>    — toggle annotation expansion for one task
z <ID>      — shorthand (z is the only command starting with z)
z *         — toggle all visible tasks that have annotations
```

### Behaviour

- `zip <ID>`: if task is collapsed → expand; if already expanded → collapse
- `zip <ID>` on a task with no annotations → silent no-op (or brief info message)
- `z *`: if **all** annotated visible tasks are expanded → collapse all; otherwise expand all

### Rendering

When a task is expanded, an expansion row is inserted **immediately below its task row** in the table. The expansion row spans the description + urgency columns and lists all annotations:

```
[blank id cell] | YYYY-MM-DD   annotation text
                | YYYY-MM-DD   another annotation
```

Date is dimmed (50% opacity). Text supports inline code formatting (backtick spans).

### State

Expanded UUIDs are held in a **session-only in-memory set** — not persisted to disk. They survive list refreshes (because the set is module-level state), but reset on process restart. This is intentional.

### Scope

Works in both the regular list view and the stream view (`ss`).

---

## 5. Summary of New Commands

| Command                | Alias | Description                                    |
| ---------------------- | ----- | ---------------------------------------------- |
| `stream <desc> [opts]` | `s`   | Add a stream task (auto-started)               |
| `ss`                   | —     | Stream view (persistent context, like `today`) |
| `zip <ID>`             | `z`   | Toggle inline annotation expansion             |
| `z *`                  | —     | Toggle all annotated visible tasks             |

## 6. Summary of New Virtual Tag

| Tag       | Shorthand | Matches                 |
| --------- | --------- | ----------------------- |
| `!stream` | `!str`    | Tasks with tag `stream` |

Urgency constant: **-1000.0** (hardcoded, no contributions from any other factor).
