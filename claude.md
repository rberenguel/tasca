# Tasca - Project Context for Claude

## Overview

Tasca is a local-first Progressive Web App (PWA) task manager inspired by Taskwarrior. It runs entirely in the browser using IndexedDB for storage with no server backend. The interface is terminal-like, accepting text commands.

## Tech Stack

- **Pure vanilla JavaScript** (ES6 modules, no framework)
- **IndexedDB** for task storage, **localStorage** for settings
- **Service Worker** for offline PWA functionality
- **No build system** - static files served directly
- **Mocha/Chai** for testing (browser-based)

## Architecture

```
src/js/
├── app.js                # Entry point & initialization
├── commands.js           # Command parsing & handlers (largest file)
├── commands-checklist.js # Checklist feature (grouping tasks)
├── commands-ref.js       # Reference search (fuzzy trigram-based)
├── context.js            # GTD context feature (persistent filters)
├── db.js                 # IndexedDB abstraction layer
├── input.js              # Input handling, autocomplete, history
├── list.js               # Task filtering, sorting, display logic
├── logic.js              # Business logic (urgency calc, filtering)
├── state.js              # Shared application state
├── today.js              # Today view sections (started, overdue, ready)
├── ui.js                 # UI rendering (tables, formatting)
└── utils.js              # Utilities (date parsing, UUIDs, recurrence)
```

## Key Files

- `commands.js` - All command implementations (`add`, `done`, `list`, `modify`, etc.)
- `logic.js` - Urgency algorithm, virtual tags (`!overdue`, `!today`, etc.)
- `today.js` - Today view section collection (started, overdue, ready)
- `db.js` - Database schema (tasks, projects, settings stores)
- `utils.js` - Date parsing (`Nd`, `Nw`, `today`), recurrence logic

## Commands Reference

Task commands: `add`, `delete`, `done`, `start`, `stop`, `modify`, `edit/ed`, `annotate`, `info`, `skip`, `open/o`, `checklist/cl`, `unchecklist/ucl`
Views: `list`, `next`, `calendar/cal`, `projects`, `chain`
Data: `export/exp`, `import/imp`, `link`, `load`, `save`, `unlink`, `status/stat`
Context: `context/ctx/c` (GTD persistent filters), `day`/`today` (shortcut for `context !today`)
Reports: `report/rep` with subcommands (for GTD weekly reviews)
Search: `ref` (fuzzy search for reference project tasks)

## Edit Command

`edit` (or `ed`) populates the input field with a `mod` command containing all task properties:

```
edit 1    → Input becomes: mod 1 Task description pro:Project pri:10 !tag due:20250120 ...
```

This allows quick inline editing of any property - modify what you need and press Enter.

## Skip Command

`skip` has dual behavior:

- **Recurring tasks**: Marks as skipped, creates next occurrence
- **Non-recurring tasks**: Cancels the task (status becomes "skipped")

This provides a sync-friendly alternative to `delete` - cancelled tasks are preserved with `status: "skipped"` rather than being permanently removed. The `report audit` only considers recurring tasks, so cancelled non-recurring tasks won't affect skip rate metrics.

### Skip Ahead with until:

Skip multiple recurring occurrences at once without creating intermediate tasks:

```
skip 1 until:today    # Skip all past occurrences, get today's task (common OOO case)
skip 2 u:2w           # Skip ahead, get the task 2 weeks from now (u: is shorthand)
skip 3 until:fri      # Skip ahead, get Friday's task
```

**How it works:**

- Skips all occurrences before the target date
- Creates the first occurrence at or after the target date
- No intermediate tasks are created or stored
- Shows message: "Skipped N occurrences. Next: YYYY-MM-DD"
- Supports all date formats: `today`, `Nd`, `Nw`, `fri`, `YYYYMMDD`, etc.

**Common use case:** When returning from vacation, run `skip ID until:today` on each daily recurring task to clear the backlog and get only today's instance.

## List Search

When using `list` with a search term, waiting and scheduled tasks are included in results:

```
list groceries     → finds "buy groceries" even if it has wait:7d
list !waiting      → explicit filter also shows waiting tasks
```

This allows finding specific tasks regardless of their wait/scheduled status. Context search terms do NOT trigger this behavior - only direct command searches.

## Today View

The `day` or `today` commands set context to `!today` with special behavior:

- Shows all tasks due today, **including waiting tasks** (e.g., routines with `wait:`)
- Tasks are sorted by `order:N` (ascending, lower first), then by urgency
- The order value is displayed as a small number before the task description

```
add Morning routine due:today order:1 wait:6h recur:1d
add Check email due:today order:2
day                     # shows both, sorted by order
```

The `order` property can be set with `order:N`, `ord:N`, or `o:N`. Use `order:` (empty) on `mod` to clear it.

## Status Command

`status` (or `stat`) shows sync status, similar to `git status`. It displays header info (linked file, last save time, modified projects) then runs `list !modified` to show changed tasks in the normal table format.

Can also use `list !modified` (or `list !m`) directly to see modified tasks.

## Report Command

`report` (or `rep`) provides GTD weekly review reports:

- **`report stale`** - Projects sorted by staleness (days since last activity: task added, completed, or started). Reference projects excluded. Color-coded: >30d red, >14d yellow.

- **`report rot [N]`** - Top N oldest pending tasks (default 10). Shows age distribution summary. Color-coded: >90d red, >30d yellow.

- **`report done [period] [by:project|tag]`** - Completed tasks grouped by project (default) or tag. Period default `1w`. Tasks with multiple tags appear in each group when using `by:tag`.

- **`report cfd [pro:X] [period] [by:project|tag]`** - Cumulative flow diagram. Default shows time series of done vs pending. With `by:project` or `by:tag`, shows snapshot comparison across groups sorted by most backlog. Reference projects shown dimmed at end.

- **`report cycle [pro:X] [period] [by:project|tag]`** - Cycle time analysis (latency from entry to completion). Shows percentiles (p50, p85, p95) and distribution histogram. With `by:project` or `by:tag`, shows table of each group's p50/p85 sorted by worst first. Reference projects shown dimmed at end. Alias: `slo`.

## Ref Command

The `ref` command performs fuzzy search on tasks within reference projects (projects tagged with `!reference` or `!ref`).

```
ref python          # find reference tasks matching "python"
ref machine learn   # fuzzy match "machine learning"
ref api             # search descriptions, annotations, and URLs
```

**Search Algorithm:**

- Uses trigram-based fuzzy matching for queries ≥3 characters (tolerant to minor typos)
- Substring matching for queries <3 characters
- Weighted scoring:
  - Description matches: 10x weight
  - Annotation matches: 5x weight
  - URL matches: 2x weight
  - Exact substring matches get +50 bonus
- Results sorted by score (highest first)

**Scope:**

Searches tasks in reference projects, identified by either:

1. Projects ending with `.ref` (e.g., `games.gb.ref`)
2. Projects tagged with `!reference` or `!ref`

To mark a project as reference using tags:

```
mod pro:Books !ref         # tag project as reference
annotate pro:Docs !reference icon:book
```

Or simply use the `.ref` naming convention:

```
add GB Studio guide pro:games.gb.ref
```

**Implementation:** `commands-ref.js` contains the search logic.

## Open Command

`open` (or `o`) opens the task's URL in a new browser tab:

```
open 1        # opens URL of task 1
1 o           # same, reversed syntax
open x:docs   # open by target reference
open 1,3,5    # open multiple tasks
open 1-3      # open range of tasks
```

Shows an error if any task has no URL.

## Multi-ID Commands

Commands `done`, `delete`, `skip`, `modify`, and `open` support multiple IDs:

```
done 1,3,5      # complete tasks 1, 3, and 5
delete 1-3      # delete tasks 1 through 3
mod 1,3-5 !tag  # add tag to tasks 1, 3, 4, 5
skip 2-4        # skip tasks 2, 3, 4
```

Undo works atomically - one undo reverts all changes from a multi-ID command.

## Checklists

Group related tasks under a parent container:

```
add Deploy release
add Run tests
add Update changelog
list
cl 1 2,3                # tasks 2,3 become members of task 1
```

**Data model**:

- Parent: `checklist: "parent"` property
- Members: `checklist: PARENT_UUID` property, `order: N` for sequencing

**Rendering**:

- Today/list views: members expanded under parent with checkbox icons (☐ pending, ☑ done, ⊘ skipped, ⏱ waiting)
- Next view: summary format showing `(done/total)` count
- Calendar view: members shown individually with checklist icon indicator

**Auto-completion**: Parent auto-completes when all members are done/skipped AND no member has `recur` set. Recurring checklists (e.g., daily routines) never auto-complete.

**Commands**:

- `checklist PARENT_ID MEMBER_IDS` (alias: `cl`) - create/update checklist
- `unchecklist MEMBER_IDS` (alias: `ucl`) - remove tasks from checklist

**Constraints**:

- Parents cannot have `recur` set
- A task cannot be both a parent and a member

**Virtual tag**: `!checklist` (shorthand: `!cl`) matches parents and members.

**Implementation**: `commands-checklist.js` contains all checklist logic.

## Task Options

- `pro:ProjectName` - Project (hierarchical with dots)
- `!tag` - Tags (use `!someday` to hide from next)
- `due:DATE`, `sched:DATE`, `wait:DATE` - Dates
- `pri:N` - Priority (1=low, 10=med, 50=high, negative=backlog)
- `order:N` - Custom sort order for `!today` view (aliases: `ord:N`, `o:N`)
- `recur:1d/1w/2w/1m/1y` - Recurrence
- `dep:ID,ID` - Dependencies
- `url:URL`, `icon:name` - Metadata
- `c:X` or `color:X` - Icon color (see below)

## Icon Colors

Tasks with icons can have colored icons using `c:` or `color:`:

```
add Buy milk icon:shopping-cart c:g    # green icon
mod 1 c:y                               # change to yellow
mod 1 c:                                # clear color
```

Color codes (Solarized palette):

| Code | Color   |
| ---- | ------- |
| b    | blue    |
| v    | violet  |
| o    | orange  |
| c    | cyan    |
| g    | green   |
| y    | yellow  |
| r    | red     |
| m    | magenta |

The syntax supports future extensibility: `c:y.r` would set icon=yellow, title=red (title color not yet implemented).

## Hiding Tasks from Next

Three ways to hide tasks/projects from the `next` view:

1. **Someday tag**: `add Read a book !someday` - task gets urgency -100
2. **Negative priority**: `add Something pri:-10` - scaled negative urgency
3. **Reference project**: `mod pro:Books !reference` - all tasks in project get urgency -100

View hidden tasks with `list !someday` or `list pro:Books`.

## Project Metadata

Projects can have icons, tags, and banners:

- `annotate pro:Books icon:book !reference` - add icon and tag
- `mod pro:Books !ref` - toggle tag (add if missing, remove if present)
- `mod pro:Books icon:` - clear icon

### Project Banners

Banners are animated messages shown above the context banner when a project context is active:

```
annotate pro:Work banner:Remember weekly review | Check Slack daily
mod pro:Work banner-style:typewriter   # or "ticker" (default)
mod pro:Work banner:                   # clear banners
info pro:Work                          # shows banners and style
```

Animation styles:

- **ticker** (default): Horizontal scroll, banners joined with ★ separator
- **typewriter**: Types out each banner character by character, cycles through

## Date Formats

- Absolute: `YYYYMMDD` (e.g., `20250115`)
- Relative: `today`, `tomorrow`, `Nd`, `Nw`, `Nm` (e.g., `3d`, `2w`)
- Named days: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` (always next occurrence)

## Testing

Run tests by opening `tests/index.html` in browser. Tests cover urgency calculation, filtering, virtual tags, date handling, recurrence, and E2E command tests.

**CRITICAL TESTING INSTRUCTIONS**:

1.  **Browser Only**: This project uses a browser-based test runner (`index.html`). **Do not write Node.js tests.**
2.  **Manual Registration**: When creating a new test file (e.g., `tests/test_feature.js`), **YOU MUST MANUALLY ADD IT** to `tests/index.html`.
    - Add: `<script type="module" src="test_feature.js"></script>` to the body.
    - If you forget this, the test will not run.
3.  **Check Index**: Always verify that `tests/index.html` includes all files present in `tests/*.js` (except utility/runner files).
4.  **Reference**: Use `tests/test_tasca.js` as the template for test structure (setup, mock context, imports).
5.  **Imports**: Import source files directly from `../src/js/` (e.g., `import { dbOps } from "../src/js/db.js";`).

## Virtual Tags

Virtual tags are computed filters (not stored on tasks). Used in `list`, `context`, `calendar`, `export`.

| Tag          | Shorthands             | Matches                         |
| ------------ | ---------------------- | ------------------------------- |
| `!overdue`   | `!o`, `!od`, `!over`   | Tasks past due date             |
| `!today`     | `!t`, `!tod`           | Tasks due today                 |
| `!waiting`   | `!w`, `!wait`          | Tasks with future wait date     |
| `!scheduled` | `!s`, `!sch`, `!sched` | Tasks with future sched date    |
| `!blocked`   | `!b`, `!blk`, `!block` | Tasks with pending dependencies |
| `!done`      | `!d`                   | Completed tasks                 |
| `!active`    | `!a`, `!act`           | Started tasks                   |
| `!recurring` | `!r`, `!rec`, `!recur` | Tasks with recurrence           |
| `!checklist` | `!cl`                  | Checklist parents and members   |
| `!someday`   | `!sd`                  | Tasks tagged someday            |
| `!routine`   | `!rt`                  | Tasks tagged routine            |
| `!reference` | `!ref`, `!refs`        | Tasks in reference projects     |
| `!modified`  | `!m`, `!mod`           | Tasks modified since last save  |

**Implementation**: Shorthands are expanded via `expandVirtualTagShorthand()` in `logic.js` at filter parse time (in `list.js`, `commands.js`). The `hasVirtualTag()` function only understands full names. This keeps shorthands for filtering only - they don't affect `add`/`modify`.

## Development Notes

- No transpilation - write ES6+ that runs directly in modern browsers
- Module imports use relative paths with `.js` extension
- Branch `gh-pages` is the deployed branch

## Version Management

**When bumping versions, update ALL THREE files:**

1. `pwa-manifest.json` - PWA manifest
2. `manifest.json` - Chrome extension manifest
3. `sw.js` - Service worker cache name (`CACHE_NAME`)

The app has dual manifests: `pwa-manifest.json` for PWA install, `manifest.json` for Chrome extension. The `index.html` references `pwa-manifest.json` via `<link rel="manifest">`. Chrome extensions require `manifest.json` specifically.

## Chrome Extension

The Chrome extension provides quick-add from any tab (Ctrl+Shift+T). Configuration is in `auto-icons.js`:

**DOMAIN_ICONS** - Maps domains to Phosphor icon names:

```javascript
"docs.google.com": "file-doc",
"github.com": "github-logo",
```

**TITLE_TRANSFORMS** - Cleans up page titles by domain:

```javascript
"docs.google.com": (title) => title.replace(/ - Google Docs$/, ""),
"github.com": (title) => title.replace(/ · GitHub$/, ""),
```

Edit `auto-icons.js` to customize without touching `background.js`.

## Code Style

- Vanilla JS, no TypeScript
- ES6 modules with explicit imports
- No semicolons (ASI style)
- Functions over classes where possible
- Keep modules focused on single responsibility
