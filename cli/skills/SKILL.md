---
name: tasca
description: Task management skill for reading and mutating Tasca tasks via the local Go CLI. Use when the user wants to view, add, complete, modify, or query their tasks. Requires TASCA_FILE env var or -f flag pointing to tasca.json.
allowed-tools: Bash(~/.tasca/tasca *)
---

# Tasca CLI

`~/.tasca/tasca` is a local Go binary that reads/writes `tasca.json` directly. No server required.

## Setup

Binary: `~/.tasca/tasca` — install via `cd cli && task install`.

**Before using this skill, look up the tasca file path from memory.** The user stores it there per machine. Pass it with `-f` on every invocation:

```bash
~/.tasca/tasca -f "/path/from/memory/tasca.json" --markdown next
```

## Output Modes

- **Default**: ANSI color for terminal display
- **`--markdown`**: GFM tables, no color codes — use this for LLM consumption

Always use `--markdown` when you need to read task data to reason about it.

## ID System

IDs are positional (1, 2, 3…) based on the last rendered list. They persist for 24h in a state file at `~/.tasca/<hash>.state`.

**Always run `next` or `list` before any command that takes an ID.** IDs from the previous call remain valid for subsequent mutations in the same session.

```bash
~/.tasca/tasca --markdown next     # get current IDs
~/.tasca/tasca done 3              # use ID from above
~/.tasca/tasca mod 5 pri:50        # still valid
~/.tasca/tasca --markdown next     # refresh
```

## Commands

### Context (persistent filter)

```bash
~/.tasca/tasca context pro:Work      # focus on project
~/.tasca/tasca ctx !today            # same as day
~/.tasca/tasca ctx                   # clear context, back to next
```

Mutations (done, mod, skip, etc.) re-render using the active context automatically.

### Read (safe, no mutation)

```bash
~/.tasca/tasca --markdown next                  # top 10 urgent tasks
~/.tasca/tasca --markdown next 20               # top 20
~/.tasca/tasca --markdown list                  # all pending tasks
~/.tasca/tasca --markdown list pro:Work         # filter by project
~/.tasca/tasca --markdown list !overdue         # virtual tag filter
~/.tasca/tasca --markdown list search term      # text search (includes waiting tasks)
~/.tasca/tasca --markdown today                 # tasks due today, with sections
~/.tasca/tasca --markdown info 3                # full task details
~/.tasca/tasca --markdown projects              # all projects with task counts
~/.tasca/tasca --markdown calendar              # next 14 days
~/.tasca/tasca --markdown calendar lim:30       # next 30 days
~/.tasca/tasca --markdown chain 3               # dependency tree
~/.tasca/tasca --markdown report stale          # projects by staleness
~/.tasca/tasca --markdown report rot            # oldest pending tasks
~/.tasca/tasca --markdown report done 1w        # completed last week
~/.tasca/tasca --markdown report done 2w by:project
```

### Write (mutate tasca.json)

```bash
~/.tasca/tasca add Buy milk pro:Home due:tomorrow !errands
~/.tasca/tasca add Fix login bug pro:Work.Backend pri:50 due:3d
~/.tasca/tasca done 3                   # complete task
~/.tasca/tasca done 1,3,5               # complete multiple
~/.tasca/tasca done 1-3                 # complete range
~/.tasca/tasca delete 7
~/.tasca/tasca skip 4                   # cancel (non-recurring) or advance (recurring)
~/.tasca/tasca skip 4 until:today       # skip ahead to today (post-vacation)
~/.tasca/tasca mod 5 pri:10 !urgent     # modify (tags toggle)
~/.tasca/tasca mod 5 due:2w pro:Work
~/.tasca/tasca mod 5 pri:               # clear priority
~/.tasca/tasca start 2                  # mark as started
~/.tasca/tasca annotate 3 Blocked on design review
~/.tasca/tasca annotate 3 -1            # remove annotation 1
```

## Task Options

| Option   | Example                               | Notes                                                        |
| -------- | ------------------------------------- | ------------------------------------------------------------ |
| `pro:`   | `pro:Work.Backend`                    | Project (hierarchical with dots)                             |
| `!tag`   | `!urgent`                             | Tags (toggle on mod)                                         |
| `due:`   | `due:today`, `due:3d`, `due:20260315` | Due date                                                     |
| `wait:`  | `wait:1w`                             | Hidden until date                                            |
| `sched:` | `sched:tomorrow`                      | Scheduled date                                               |
| `pri:`   | `pri:50`                              | Priority (neg=backlog, 1=low, 10=med, 50=high, 100=critical) |
| `recur:` | `recur:1d`, `recur:1w`                | Recurrence                                                   |
| `dep:`   | `dep:2,3`                             | Dependencies (by display ID)                                 |
| `url:`   | `url:https://...`                     | URL                                                          |

## Date Formats

`today`, `tomorrow`, `Nd` (days), `Nw` (weeks), `Nm` (months), `Nh` (hours), `mon`…`sun` (next occurrence), `YYYYMMDD`

## Virtual Tags (for list/filter)

`!overdue`, `!today`, `!waiting`, `!scheduled`, `!blocked`, `!active`, `!recurring`, `!done`, `!someday`, `!modified`

Shorthands: `!o`=overdue, `!t`=today, `!w`=waiting, `!a`=active, `!r`=recurring, `!d`=done, `!m`=modified

## Typical Agent Workflow

```bash
# 1. Read current state
~/.tasca/tasca --markdown next

# 2. Act on tasks (IDs from step 1)
~/.tasca/tasca done 2
~/.tasca/tasca add New task from review pro:Work pri:10

# 3. Verify
~/.tasca/tasca --markdown next
```

## Rules

1. Always run `--markdown next` or `--markdown list` before using IDs in mutations
2. Use `--markdown` for all read commands — cleaner output for reasoning
3. IDs are valid for 24h after last list render; refresh with `next` if unsure
4. `mod` toggles tags — running `mod 1 !tag` twice adds then removes `!tag`
5. Multi-ID: `done 1,3,5` or `done 1-3` or mixed `done 1,3-5,7`

## Confirmation Required

**Always ask the user for confirmation before executing any write command** (`add`, `done`, `delete`, `skip`, `mod`, `start`, `annotate`, `import`). Show what you are about to do and wait for approval. Never mutate tasks autonomously.
