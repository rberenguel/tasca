# <img src="icon.png" alt="Tasca Icon" width="32" height="32">Tasca

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
| `mod <ID> [options]`   | Modify task                 |
| `annotate <ID> <note>` | Add note to task            |
| `annotate <ID> -N`     | Remove annotation by index  |
| `info <ID>`            | Show task details           |
| `chain <ID>`           | Show dependency tree        |
| `projects`             | List all projects           |
| `export [filters]`     | Export tasks as JSON        |
| `import`               | Import tasks from JSON      |
| `help [cmd]`           | Show help                   |

### Task Options

| Option                              | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `pro:Name`                          | Project (hierarchical, e.g. `Work.Client`) |
| `pri:H/M/L`                         | Priority                                   |
| `due:YYYYMMDD`                      | Due date                                   |
| `wait:YYYYMMDD`                     | Hide until date                            |
| `recur:daily/weekly/monthly/yearly` | Recurrence                                 |
| `dep:ID,ID`                         | Dependencies                               |
| `!tag`                              | Add tag (toggles on `mod`)                 |

### Filters

Use with `list` or `export`:

- `pro:Name` — filter by project (includes subprojects)
- `!tag` — filter by tag
- `text` — search in description

Virtual tags: `!overdue`, `!today`, `!waiting`, `!blocked`, `!done`, `!all`

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

## Installation

Serve the files via any static file server or open `index.html` directly. Install as PWA for offline use.
