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

Task commands: `add`, `delete`, `done`, `start`, `stop`, `modify`, `annotate`, `info`, `skip`
Views: `list`, `next`, `calendar/cal`, `projects`, `chain`
Data: `export/exp`, `import/imp`, `link`, `load`, `save`, `unlink`
Context: `context/ctx/c` (GTD persistent filters)

## Task Options

- `pro:ProjectName` - Project (hierarchical with dots)
- `!tag` - Tags (use `!someday` to hide from next)
- `due:DATE`, `sched:DATE`, `wait:DATE` - Dates
- `pri:H/M/L/B` - Priority (B=backlog, hides from next)
- `recur:1d/1w/2w/1m/1y` - Recurrence
- `dep:ID,ID` - Dependencies
- `url:URL`, `icon:name` - Metadata

## Hiding Tasks from Next

Three ways to hide tasks/projects from the `next` view:

1. **Someday tag**: `add Read a book !someday` - task gets urgency -100
2. **Backlog priority**: `add Something pri:B` - task gets urgency -20
3. **Reference project**: `mod pro:Books !reference` - all tasks in project get urgency -100

View hidden tasks with `list !someday` or `list pro:Books`.

## Project Metadata

Projects can have icons and tags:

- `annotate pro:Books icon:book !reference` - add icon and tag
- `mod pro:Books !ref` - toggle tag (add if missing, remove if present)
- `mod pro:Books icon:` - clear icon

## Date Formats

- Absolute: `YYYYMMDD` (e.g., `20250115`)
- Relative: `today`, `tomorrow`, `Nd`, `Nw`, `Nm` (e.g., `3d`, `2w`)

## Testing

Run tests by opening `tests/index.html` in browser. Tests cover urgency calculation, filtering, virtual tags, date handling, and recurrence.

## Development Notes

- No transpilation - write ES6+ that runs directly in modern browsers
- Module imports use relative paths with `.js` extension
- PWA version is in `manifest.json` (currently v0.0.32)
- Cache busting: update `sw.js` cache name when deploying
- Branch `gh-pages` is the deployed branch

## Code Style

- Vanilla JS, no TypeScript
- ES6 modules with explicit imports
- No semicolons (ASI style)
- Functions over classes where possible
- Keep modules focused on single responsibility
