# <img src="icon.png" alt="Tasca Icon" width="32" height="32"> Tasca

A local-first PWA task manager inspired by Taskwarrior.

## Usage

Tasca runs entirely in the browser using IndexedDB for storage. No server required.

### Commands

| Command                  | Description                 |
| ------------------------ | --------------------------- |
| `add` / `a <desc> [opts]` | Add a task                  |
| `list` / `l [filters]` | List pending tasks          |
| `next [N]`             | List top N tasks by urgency |
| `start` / `st <ID>`    | Mark task as started        |
| `done <ID>`            | Mark task complete          |
| `delete <ID>`          | Remove task                 |
| `mod <ID> [desc] [options]` | Modify task (description and/or options) |
| `annotate <ID> <note>` | Add note to task            |
| `annotate <ID> -N`     | Remove annotation by index  |
| `info` / `i <ID>`      | Show task details           |
| `chain <ID>`           | Show dependency tree        |
| `projects`             | List all projects           |
| `context` / `ctx` / `c [filters]` | Set/clear persistent context |
| `export` / `exp [filters]` | Export tasks as JSON        |
| `import` / `imp`       | Import tasks from JSON      |
| `link`                 | Link a sync file (desktop)  |
| `sync`                 | Pull & push to linked file  |
| `unlink`               | Remove linked file          |
| `about`                | Show version info           |
| `help [cmd]`           | Show help                   |

### Task Options

| Option                              | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `pro:Name`                          | Project (hierarchical, e.g. `Work.Client`) |
| `pri:H/M/L`                         | Priority                                   |
| `due:YYYYMMDD`                      | Due date                                   |
| `wait:YYYYMMDD`                     | Hide until date                            |
| `recur:daily/weekly/monthly/yearly` | Recurrence                                 |
| `dep:ID,ID`                         | Dependencies (toggles on `mod`)            |
| `url:URL`                           | Link URL (shown as clickable icon)         |
| `!tag`                              | Tag (toggles on `mod`)                     |

### Filters

Use with `list` or `export`:

- `pro:Name` — filter by project (includes subprojects)
- `!tag` — filter by tag
- `text` — search in description
- `end:1w` — completed in last week (use with `!done`). Supports `d`ays, `w`eeks, `m`onths.
- `sort:field` — sort by field: `start`, `end`, `pri`, `pro`, `due`, `urg`. Use `-` for reverse (e.g., `sort:-end`). Combine with commas: `sort:pro,pri`.

Virtual tags: `!overdue`, `!today`, `!waiting`, `!blocked`, `!active`, `!done`, `!all`

Example: `list !done end:1w` — review tasks completed in the last week.

### Contexts (GTD)

Set a persistent filter context that auto-applies to `list`/`next` and inherits to new tasks:

```
c pro:Work              # filter by project
c !urgent               # filter by tag
c meeting               # text search
c pro:Work !urgent      # combine filters
c                       # clear context (no args)
```

When context is active:
- `list` and `next` automatically apply the context filters
- `add` inherits project and tags from context (unless overridden)
- A banner shows the active context above the task list

Context persists in localStorage across sessions.

### Project Icons

```
mod pro:Work icon:briefcase
mod pro:Home icon:home
mod pro:Work icon:          # clear icon
```

Icons use [Iconoir](https://iconoir.com/).

### Sync Between Devices

Export and import filtered subsets:

```
export pro:Work             # on device A
# transfer file
import                      # on device B
```

Tasks are matched by UUID. Re-importing updates existing tasks.

### Cross-Device Sync

**Export** uses the best available method:
- **Desktop Chrome**: File picker — select existing file to overwrite
- **iOS Safari**: Share sheet — tap "Save to Files" to save/overwrite in iCloud
- **Other browsers**: Standard download

**Workflow for syncing between desktop and mobile:**

1. Create a sync file: `export` → save to shared folder (iCloud, Dropbox, etc.)
2. On desktop Chrome, run `link` to select the existing file
3. Use `sync` to pull changes and push your state back

```
export                      # create initial sync file in iCloud
link                        # select that file (once)
sync                        # read → merge → write
```

On mobile, use `export` → "Save to Files" → overwrite the same file.

The `sync` command is bidirectional:
1. Reads from the linked file (imports any changes from other devices)
2. Writes all tasks back (so other devices can import)

Use `unlink` to disconnect the linked file.

### Keyboard & Gestures

- **Up/Down arrows**: Navigate command history
- **Swipe up/down on input**: Navigate history (mobile)
- **Tab**: Autocomplete commands, projects, and tags
- **Tap output area**: Toggle keyboard focus (mobile)

## Installation

Serve the files via any static file server or open `index.html` directly. Install as PWA for offline use.
