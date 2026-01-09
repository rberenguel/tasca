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
├── app.js       # Entry point & initialization
├── commands.js  # Command parsing & handlers (largest file)
├── context.js   # GTD context feature (persistent filters)
├── db.js        # IndexedDB abstraction layer
├── input.js     # Input handling, autocomplete, history
├── list.js      # Task filtering, sorting, display logic
├── logic.js     # Business logic (urgency calc, filtering)
├── state.js     # Shared application state
├── ui.js        # UI rendering (tables, formatting)
└── utils.js     # Utilities (date parsing, UUIDs, recurrence)
```

## Key Files

- `commands.js` - All command implementations (`add`, `done`, `list`, `modify`, etc.)
- `logic.js` - Urgency algorithm, virtual tags (`!overdue`, `!today`, etc.)
- `db.js` - Database schema (tasks, projects, settings stores)
- `utils.js` - Date parsing (`Nd`, `Nw`, `today`), recurrence logic

## Commands Reference

Task commands: `add`, `delete`, `done`, `start`, `stop`, `modify`, `edit/ed`, `annotate`, `info`, `skip`
Views: `list`, `next`, `calendar/cal`, `projects`, `chain`
Data: `export/exp`, `import/imp`, `link`, `load`, `save`, `unlink`, `status/stat`
Context: `context/ctx/c` (GTD persistent filters)
Reports: `report/rep` with subcommands (for GTD weekly reviews)

## Edit Command

`edit` (or `ed`) populates the input field with a `mod` command containing all task properties:

```
edit 1    → Input becomes: mod 1 Task description pro:Project pri:10 !tag due:20250120 ...
```

This allows quick inline editing of any property - modify what you need and press Enter.

## Skip Command

`skip` has dual behavior:

- **Recurring tasks**: Marks as skipped, creates next occurrence (same as before)
- **Non-recurring tasks**: Cancels the task (status becomes "skipped")

This provides a sync-friendly alternative to `delete` - cancelled tasks are preserved with `status: "skipped"` rather than being permanently removed. The `report audit` only considers recurring tasks, so cancelled non-recurring tasks won't affect skip rate metrics.

## List Search

When using `list` with a search term, waiting and scheduled tasks are included in results:

```
list groceries     → finds "buy groceries" even if it has wait:7d
list !waiting      → explicit filter also shows waiting tasks
```

This allows finding specific tasks regardless of their wait/scheduled status. Context search terms do NOT trigger this behavior - only direct command searches.

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

## Task Options

- `pro:ProjectName` - Project (hierarchical with dots)
- `!tag` - Tags (use `!someday` to hide from next)
- `due:DATE`, `sched:DATE`, `wait:DATE` - Dates
- `pri:N` - Priority (1=low, 10=med, 50=high, negative=backlog)
- `recur:1d/1w/2w/1m/1y` - Recurrence
- `dep:ID,ID` - Dependencies
- `url:URL`, `icon:name` - Metadata

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

## Testing

Run tests by opening `tests/index.html` in browser. Tests cover urgency calculation, filtering, virtual tags, date handling, and recurrence.

**Important**: When adding new logic (especially in `logic.js`, `utils.js`), add corresponding tests in `tests/test_tasca.js`. Export new functions and import them in the test file.

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

## Code Style

- Vanilla JS, no TypeScript
- ES6 modules with explicit imports
- No semicolons (ASI style)
- Functions over classes where possible
- Keep modules focused on single responsibility
