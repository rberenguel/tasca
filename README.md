# <img src="icon.png" alt="Tasca Icon" width="32" height="32"> Tasca

A local-first PWA task manager inspired by Taskwarrior.

## Usage

Tasca runs entirely in the browser using IndexedDB for storage. No server required.

### Commands

| Command                           | Description                              |
| --------------------------------- | ---------------------------------------- |
| `add` / `a <desc> [opts]`         | Add a task                               |
| `list` / `l [filters]`            | List pending tasks                       |
| `next [N]`                        | List top N tasks by urgency              |
| `start` / `st <ID>`               | Mark task as started                     |
| `done <ID>`                       | Mark task complete                       |
| `skip <ID> [until:DATE]`          | Skip recurring task (or until DATE)      |
| `delete <ID>`                     | Remove task                              |
| `mod <ID> [desc] [options]`       | Modify task (description and/or options) |
| `annotate <ID> <note>`            | Add note to task                         |
| `annotate <ID> -N`                | Remove annotation by index               |
| `undo`                            | Revert last task operation               |
| `info` / `i <ID>`                 | Show task details                        |
| `track` / `t <ID> [val]`          | Track effort (30m, 50%, or today)        |
| `open` / `o <ID>`                 | Open task URL in new tab                 |
| `chain` / `tree` / `deps` <ID>    | Show dependency tree                     |
| `checklist` / `cl <P> <M>`        | Group tasks into a checklist             |
| `unchecklist` / `ucl <IDs>`       | Remove tasks from checklist              |
| `projects`                        | List all projects                        |
| `context` / `ctx` / `c [filters]` | Set/clear persistent context             |
| `day` / `today`                   | Set context to `!today`                  |
| `calendar` / `cal [filters]`      | Agenda view of dated tasks               |
| `report` / `rep <subcommand>`     | GTD weekly review reports                |
| `export` / `exp [filters]`        | Export tasks as JSON                     |
| `import` / `imp`                  | Import tasks from JSON                   |
| `copy` / `cp`                     | Copy current view to clipboard           |
| `paste`                           | Import tasks from clipboard              |
| `link`                            | Link a sync file (desktop)               |
| `load`                            | Import from linked file                  |
| `save`                            | Export to linked file                    |
| `unlink`                          | Remove linked file                       |
| `icon <term>`                     | Search for icon names by keyword         |
| `about`                           | Show version info                        |
| `help [cmd]`                      | Show help                                |

### Task Options

| Option         | Description                                         |
| -------------- | --------------------------------------------------- |
| `pro:Name`     | Project (hierarchical, e.g. `Work.Client`)          |
| `pri:N`        | Priority (1=low, 10=med, 50=high, negative=backlog) |
| `order:N`      | Custom sort order for `!today` view (lower first)   |
| `due:DATE`     | Due date (deadline)                                 |
| `wait:DATE`    | Hide until date                                     |
| `sched:DATE`   | Scheduled date (start working on)                   |
| `recur:PERIOD` | Recurrence (`1d`, `1w`, `2w`, `1m`, `1y`)           |
| `dep:ID,ID`    | Dependencies (toggles on `mod`)                     |
| `url:URL`      | Link URL (shown as clickable icon)                  |
| `!tag`         | Tag (toggles on `mod`)                              |

DATE formats: `YYYYMMDD`, `today`, `tomorrow`, `3d` (days), `2w` (weeks), `1m` (months), `mon`-`sun` (next occurrence)

### Filters

Use with `list` or `export`:

- `pro:Name` — filter by project (includes subprojects)
- `!tag` — filter by tag
- `text` — search in description
- `end:1w` — completed in last week (use with `!done`). Supports `d`ays, `w`eeks, `m`onths.
- `sort:field` — sort by field: `start`, `end`, `pri`, `pro`, `due`, `urg`. Use `-` for reverse (e.g., `sort:-end`). Combine with commas: `sort:pro,pri`.

Virtual tags: `!overdue`, `!today`, `!waiting`, `!scheduled`, `!recurring`, `!blocked`, `!active`, `!checklist`, `!someday`, `!done`, `!all`

Example: `list !done end:1w` — review tasks completed in the last week.

### Multi-ID Commands

Commands `done`, `delete`, `skip`, `modify`, and `open` support multiple IDs:

```
done 1,3,5              # complete tasks 1, 3, and 5
delete 1-3              # delete tasks 1 through 3
mod 1,3-5 !tag          # add tag to tasks 1, 3, 4, 5
open 1-3                # open URLs from tasks 1, 2, 3
```

Undo works atomically — one undo reverts all changes from a multi-ID command.

### Skip Ahead (OOO)

Skip multiple recurring occurrences at once without creating intermediate tasks:

```
skip 1 until:today      # skip all past occurrences, get today's task
skip 2 u:fri            # skip ahead, get Friday's task (u: is shorthand)
skip 3 until:2w         # skip 2 weeks ahead
```

Common use case: when returning from vacation, run `skip ID until:today` on each daily recurring task to clear the backlog and get only today's instance.

### Checklists

Group related tasks under a parent for routines or multi-step processes:

```
add Deploy release
add Run tests
add Update changelog
add Tag release
list
cl 1 2,3,4              # tasks 2,3,4 become members of task 1
```

Members are displayed under their parent with checkbox icons:

- ☐ pending
- ☑ done
- ⊘ skipped
- ⏱ waiting/scheduled

**Auto-completion**: When all members are done or skipped and none are recurring, the parent auto-completes.

**Recurring checklists**: If any member has `recur`, the parent stays open. Great for daily routines.

```
add Morning routine
add Meditate due:today recur:1d
add Exercise due:today recur:1d
list
cl 1 2,3                # parent stays open as members recur
```

Use `ucl` (unchecklist) to remove tasks from a checklist:

```
ucl 2                   # task 2 becomes a regular task
ucl 2,3,4               # multiple tasks
```

Filter checklists with `list !checklist` or `list !cl`.

### Contexts (GTD)

Set a persistent filter context that auto-applies to `list`/`next` and inherits to new tasks:

```
c pro:Work              # filter by project
c !urgent               # filter by tag
c meeting               # text search
c pro:Work !urgent      # combine filters
c                       # clear context (no args)
day                     # shortcut for c !today
today                   # same as day
```

When context is active:

- `list` and `next` automatically apply the context filters
- `add` inherits project and tags from context (unless overridden)
- A banner shows the active context above the task list

Context persists in localStorage across sessions.

### Today View

The `day` or `today` commands set context to `!today` with special behavior:

- Shows all tasks due today, including waiting tasks (e.g., routines with `wait:`)
- Tasks are sorted by `order:N` (ascending, lower first), then by urgency
- The order value is displayed as a small number before the task description
- Additional sections appear below the main list:
  - **started** (cyan): Active tasks not due today — good for ongoing work
  - **overdue** (red): Past due tasks not yet started
  - **ready** (blue): Tasks whose wait period ended earlier today

```
add Morning routine due:today order:1 wait:6h recur:1d
add Check email due:today order:2
add Exercise due:today order:3
day                     # shows all three, sorted by order
```

Use `order:` (empty) on `mod` to clear the order value.

### Calendar

Agenda view of tasks with dates:

```
cal                     # show next 14 days
cal lim:30              # show next 30 days (persisted)
cal pro:Work            # filter by project
cal !done               # show completed by end date
```

Shows `[due]`, `[sched]`, `[wait]` labels grouped by date. Includes overdue from past 7 days.

### Reports (GTD Weekly Review)

Reports help with GTD weekly reviews:

```
report stale              # projects by staleness (oldest first)
report rot                # top 10 oldest pending tasks
report rot 20             # top 20 oldest pending tasks
report done               # completed tasks in last week, by project
report done 2w            # completed in last 2 weeks
report done by:tag        # completed tasks grouped by tag
report done 2w by:tag     # combine period and grouping
```

| Subcommand               | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `stale`                  | Projects sorted by days since last activity                        |
| `rot [N]`                | Oldest N pending tasks (default 10) with age summary               |
| `done [period] [by:tag]` | Completed tasks grouped by project or tag (default 1w, by project) |

Activity for staleness: task added, completed, or started. Reference projects excluded.

### Hiding Tasks from Next

Three ways to keep tasks out of `next` while still tracking them:

```
add Read a good book !someday           # someday tag (urgency -100)
add Low priority thing pri:-10          # negative priority (backlog)
mod pro:Books !reference                # reference project (all tasks urgency -100)
```

View hidden tasks with `list !someday` or `list pro:Books`.

### Project Metadata

```
mod pro:Work icon:briefcase             # set icon
mod pro:Home icon:home
mod pro:Work icon:                      # clear icon
mod pro:Books !reference                # toggle tag (hides from next)
```

Icons use [Phosphor](https://phosphoricons.com/). Use `icon <term>` to search for icon names (uses Phosphor's tag index for related terms). Use `copy N` to copy an icon name from search results. Project tags are shown in `projects` list.

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
3. Use `load` to import changes, `save` to export your state

```
export                      # create initial sync file in iCloud
link                        # select that file (once)
load                        # import from linked file
save                        # export to linked file
```

On mobile, use `export` → "Save to Files" → overwrite the same file.

Use `unlink` to disconnect the linked file.

### Keyboard & Gestures

- **Up/Down arrows**: Navigate command history
- **Swipe up/down on input**: Navigate history (mobile)
- **Tab**: Autocomplete commands, projects, and tags
- **Tap output area**: Toggle keyboard focus (mobile)

## Installation

Serve the files via any static file server or open `index.html` directly. Install as PWA for offline use.
