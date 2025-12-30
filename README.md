# <img src="icon.png" alt="Tasca Icon" width="32" height="32"> Tasca

A local-first PWA task manager inspired by Taskwarrior.

## Usage

Tasca runs entirely in the browser using IndexedDB for storage. No server required.

### Commands

| Command                | Description                 |
| ---------------------- | --------------------------- |
| `add <desc> [options]` | Add a task                  |
| `list [filters]`       | List pending tasks          |
| `next [N]`             | List top N tasks by urgency |
| `done <ID>`            | Mark task complete          |
| `delete <ID>`          | Remove task                 |
| `mod <ID> [desc] [options]` | Modify task (description and/or options) |
| `annotate <ID> <note>` | Add note to task            |
| `annotate <ID> -N`     | Remove annotation by index  |
| `info <ID>`            | Show task details           |
| `chain <ID>`           | Show dependency tree        |
| `projects`             | List all projects           |
| `export [filters]`     | Export tasks as JSON        |
| `import`               | Import tasks from JSON      |
| `link`                 | Link a sync file (desktop)  |
| `sync`                 | Export to linked file       |
| `unlink`               | Remove linked file          |
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
| `!tag`                              | Tag (toggles on `mod`)                     |

### Filters

Use with `list` or `export`:

- `pro:Name` — filter by project (includes subprojects)
- `!tag` — filter by tag
- `text` — search in description
- `end:1w` — completed in last week (use with `!done`). Supports `d`ays, `w`eeks, `m`onths.

Virtual tags: `!overdue`, `!today`, `!waiting`, `!blocked`, `!done`, `!all`

Example: `list !done end:1w` — review tasks completed in the last week.

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

### Quick Sync (Desktop Chrome)

On desktop Chrome, use the File System Access API for persistent file access:

```
link                        # pick/create sync file (once)
sync                        # export all tasks to linked file
```

The file handle persists across sessions. Use `unlink` to disconnect.

### Keyboard Shortcuts

- **Up/Down arrows**: Navigate command history
- **Tab**: Autocomplete commands, projects, and tags

## Installation

Serve the files via any static file server or open `index.html` directly. Install as PWA for offline use.
