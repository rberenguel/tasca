# Tasca CLI — Implementation Plan

## Overview

A Go CLI/REPL that replicates Tasca's core functionality against a `tasca.json` file.
Primary consumer: coding agents (via skill). Secondary: interactive human use.
No external dependencies — stdlib only.

## Usage

```bash
# Single-shot (primary, for agents)
tasca -f ~/tasca.json next
tasca -f ~/tasca.json add Buy milk pro:Home due:tomorrow
tasca -f ~/tasca.json done 3
tasca -f ~/tasca.json --markdown next     # markdown output for LLM consumption

# REPL (secondary, for humans)
tasca -f ~/tasca.json                     # opens interactive prompt
tasca                                     # uses TASCA_FILE env var or ~/tasca.json
```

## File Resolution (priority order)

1. `-f <path>` flag (explicit)
2. `TASCA_FILE` environment variable
3. `./tasca.json` (current directory)
4. `~/tasca.json` (home directory)

Exit with error if none found.

## State File

IDs in Tasca are positional (1, 2, 3…) based on the last rendered list, matching
the web UI's `displayMapRef`. The state file persists this mapping between invocations.

- Location: `~/tmp/tasca/<hash>.state` where `<hash>` is a short hash of the JSON
  file's absolute path (so different files get different state files)
- Created via `os.MkdirTemp`-style directory: `os.MkdirAll("~/tmp/tasca", 0700)`
- Format: JSON `{"displayMap": ["uuid1", "uuid2", ...], "updatedAt": <unix_ms>}`
- Written after every command that renders a task list (next, list, today, calendar)
- Read by commands that take ID arguments (done, delete, mod, skip, start, info, annotate, chain)
- If state file missing or stale (>24h), commands requiring IDs fail with helpful error:
  `"No ID map found. Run 'next' or 'list' first."`

## Output Modes

### Default (ANSI terminal)

ANSI escape codes for color. Detects `NO_COLOR` env var and `--no-color` flag to disable.
Terminal width via `os.Getenv("COLUMNS")` or default 100.

### Markdown (`--markdown` flag)

No ANSI codes. Output formatted as Markdown for LLM consumption:

- Tables use GFM pipe syntax
- Section headers use `##`
- Metadata uses inline backticks
- Dates shown as absolute (`20260315`) not relative (`(2d)`)
- Still shows urgency scores

## File Structure

```
cli/
├── main.go       ~120 lines   Entry point, flag parsing, single-shot dispatch, REPL launch
├── data.go       ~180 lines   Types, JSON load/save, state file read/write
├── logic.go      ~280 lines   Urgency, filtering, virtual tags, date parsing, arg parsing,
│                              recurrence calculation
├── display.go    ~220 lines   ANSI/Markdown rendering, table output, color helpers
├── commands.go   ~450 lines   All command handlers
└── term.go       ~60 lines    Raw terminal mode (platform-specific, like garbell)
```

Total estimate: ~1300 lines.

## Data Model

Matches the web UI's export format exactly (round-trip compatible).

### Task (JSON field names preserved)

```go
type Task struct {
    UUID        string       `json:"uuid"`
    Description string       `json:"description"`
    Status      string       `json:"status"`       // "pending" | "completed" | "skipped"
    Entry       int64        `json:"entry"`         // unix ms
    Modified    int64        `json:"modified,omitempty"`
    Project     string       `json:"project,omitempty"`
    Priority    *int         `json:"priority,omitempty"`
    Order       *int         `json:"order,omitempty"`
    Tags        []string     `json:"tags,omitempty"`
    Depends     []string     `json:"depends,omitempty"` // UUIDs
    Due         *int64       `json:"due,omitempty"`     // unix ms
    Wait        *int64       `json:"wait,omitempty"`
    WaitTime    *WaitTime    `json:"waitTime,omitempty"`
    Sched       *int64       `json:"sched,omitempty"`
    Recur       string       `json:"recur,omitempty"`   // "1d", "1w", "2w", "1m", "1y"
    URL         string       `json:"url,omitempty"`
    Icon        string       `json:"icon,omitempty"`
    Color       *Color       `json:"color,omitempty"`
    Target      string       `json:"target,omitempty"` // x:name reference
    OnDone      string       `json:"onDone,omitempty"` // command to run on completion
    Start       *int64       `json:"start,omitempty"`  // unix ms, when started
    End         *int64       `json:"end,omitempty"`    // unix ms, when completed/skipped
    Annotations []Annotation `json:"annotations,omitempty"`
    Track       []TrackEntry `json:"track,omitempty"`
    Checklist   string       `json:"checklist,omitempty"` // "parent" | parent-UUID

    // Computed, not stored
    Urgency float64 `json:"-"`
}

type WaitTime struct {
    Hours   int `json:"hours"`
    Minutes int `json:"minutes"`
}

type Color struct {
    Icon  string `json:"icon,omitempty"`
    Title string `json:"title,omitempty"`
}

type Annotation struct {
    Entry       int64  `json:"entry"`
    Description string `json:"description"`
}

type TrackEntry struct {
    Entry int64  `json:"entry"`
    Type  string `json:"type"`  // "day" | "pct" | "min"
    Value *int   `json:"value,omitempty"`
}
```

### Project

```go
type Project struct {
    Name        string   `json:"name"`
    Icon        string   `json:"icon,omitempty"`
    Tags        []string `json:"tags,omitempty"`
    Banners     []string `json:"banners,omitempty"`
    BannerStyle string   `json:"bannerStyle,omitempty"`
    Modified    int64    `json:"modified,omitempty"`
}
```

### Store (top-level JSON)

```go
type Store struct {
    Tasks    []*Task    `json:"tasks"`
    Projects []*Project `json:"projects"`
    SavedAt  int64      `json:"savedAt,omitempty"`
}
```

### State file

```go
type State struct {
    DisplayMap []string `json:"displayMap"` // index = displayID-1, value = UUID
    UpdatedAt  int64    `json:"updatedAt"`
}
```

## logic.go — Key Functions

### Urgency (exact port of JS `calculateUrgency`)

```
Constants:
  next=15, due=12, blocking=8, active=4, blocked=-20
  priorityScale=0.12, age=2, project=1, someday=-100, reference=-100
  routine=-10, overdueScale=1.5
  ageThreshold=100, daysWarning=2, daysSoon=7

Algorithm:
  if wait != nil && *wait > now: return -10.0
  priorityContrib = priority * 0.12 (if set)
  if tag "someday": return -100 + priorityContrib
  if project is reference (proj.tags contains "reference" or "ref"): return -100 + priorityContrib
  u = 0
  if tag "next": u += 15
  if start != nil: u += 4
  if priority != nil: u += *priority * 0.12
  if project != "": u += 1
  ageDays = (now - entry) / ms_per_day
  u += min(ageDays/100, 1) * 2
  if due != nil:
    daysLeft = (*due - now) / ms_per_day
    if daysLeft < 0: u += 12 + abs(daysLeft) * 1.5
    elif daysLeft <= 2: u += 12
    elif daysLeft <= 14: u += 12 * (1 - (daysLeft-2)/12)
  isBlocking = any pending task has depends containing t.UUID
  if isBlocking: u += 8
  if depends has pending tasks: u += -20
  if tag "routine": u += -10
  return u (2 decimal places)
```

### Date Parsing (`parseDate(s string) *int64`)

Port of JS `parseDate`. Returns unix ms pointer or nil.

- `"today"` / `"tod"` → end of today (23:59:59.999)
- `"tomorrow"` / `"tom"` → end of tomorrow
- `"yesterday"` → end of yesterday
- `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"` → next occurrence end-of-day
- `"Nh"` → now + N hours
- `"Nd"` → end of day N days from now
- `"Nw"` → end of day N weeks from now
- `"Nm"` → end of day N months from now
- `"HH:MM"` → today at that time, or tomorrow if already past
- `"date@HH:MM"` → recursive parse of date part, then set time
- `"YYYYMMDD"` → end of that day

### Recurrence (`calculateNextRecurrence(t *Task) *Recurrence`)

```go
type Recurrence struct {
    NextDue  int64
    NextWait *int64
    NextSched *int64
    WaitTime *WaitTime
}
```

Port of JS logic exactly. Requires task to have both `Recur` and `Due`.
Handles `Nd`, `Nw`, `Nm`, `Ny` and legacy `daily/weekly/monthly/yearly`.
Preserves wait offset from due date. Preserves WaitTime for time-of-day waits.

### Filtering

```go
type Filter struct {
    Project  string
    Tags     []string // virtual or real, prefixed with "!"
    Search   []string // text terms (AND)
    EndAfter *int64   // for "end:Nw" filter
    Target   string   // x:name
    SortFields []string
}
```

`parseFilters(args []string) Filter` — identical token parsing to JS list.js.

Virtual tag expansion (shorthands → canonical names):

```
o/od/over → overdue
t/tod → today
w/wait → waiting
s/sch/sched → scheduled
b/blk/block → blocked
d → done
a/act → active
r/rec/recur → recurring
sd → someday
rt → routine
m/mod → modified
cl → checklist
sk/skipped → skipped
```

`hasVirtualTag(t *Task, tag string, all []*Task, projects []*Project) bool`
— port of JS `hasVirtualTag`, same logic.

`matchesProject(taskProj, filterProj string) bool`
— exact match or `taskProj` starts with `filterProj + "."`

### Task Arg Parsing (`parseTaskArgs(args []string, displayMap []string) TaskArgs`)

```go
type TaskArgs struct {
    Desc     string
    Project  string
    Priority *int
    Order    *int
    Tags     []string
    Depends  []string // resolved UUIDs
    Due      *int64
    Wait     *int64
    WaitTime *WaitTime
    Sched    *int64
    Recur    string
    URL      string
    Icon     string
    Color    *Color
    Target   string
    OnDone   string
}
```

Token prefixes:

- `p:` / `pro:` / `proj:` / `project:` → Project
- `pri:` / `priority:` → Priority (int)
- `o:` / `ord:` / `order:` → Order (int, empty = nil to clear)
- `dep:N,M` → Depends (resolve display IDs to UUIDs via displayMap)
- `due:DATE` → Due
- `wait:DATE` → Wait (also parse WaitTime for time-only)
- `sched:` / `scheduled:` → Sched
- `recur:` / `rec:` → Recur
- `url:` → URL (substring(4) to preserve URL colons)
- `icon:` → Icon
- `c:` / `color:` → Color
- `x:` / `target:` → Target
- `done:` / `td:` → OnDone (captures everything after, to end of input)
- `!word` → Tags
- anything else → description words

### Multi-ID Parsing (`resolveIDs(s string, displayMap []string) []string`)

Parses `"1"`, `"1,3,5"`, `"1-3"`, `"1,3-5,7"`, `"x:name"` → returns UUIDs.
Also supports mixed `"1,x:bike,3"`.

## display.go — Rendering

### ANSI Color Helpers

```go
const (
    Reset   = "\x1b[0m"
    Bold    = "\x1b[1m"
    Dim     = "\x1b[2m"
    Red     = "\x1b[31m"
    Green   = "\x1b[32m"
    Yellow  = "\x1b[33m"
    Blue    = "\x1b[34m"
    Magenta = "\x1b[35m"
    Cyan    = "\x1b[36m"
    Orange  = "\x1b[38;5;166m"
    Violet  = "\x1b[38;5;135m"
)
// Project depth colors: Yellow, Orange, Red, Magenta, Violet, Blue
var projDepthColors = []string{Yellow, Orange, Red, Magenta, Violet, Blue}
```

When `--no-color` or `NO_COLOR` is set, all color strings are empty.

### Table Rendering (`renderTable(tasks []*Task, all []*Task, projects []*Project, opts RenderOpts)`)

Columns: `ID | Description | Urg`

- ID: right-justified, width = len(strconv.Itoa(len(tasks))) + 1, min 3
- Description: fills remaining width
- Urg: right-justified, 6 chars wide

Header row:

```
 ID  Description                                    Urg
```

Task row content (description cell, in order):

1. Order badge (today view only): dim number + space, e.g. `1 `
2. Checklist parent marker: `[cl] ` (cyan)
3. Task icon name in brackets if set: `[icon] ` (no actual rendering, just the name)
4. Description text
5. Checklist summary (next view only): ` (done/total)` in cyan
6. URL indicator: ` [url]` (dim)
7. Blocker count: ` [blocks N]` (yellow) if this task blocks N others
8. Project: ` pro:Work.Sub` with depth colors
9. Priority: ` pri:N` with color (green=low, yellow=med, red=high)
10. Due pill: ` (Nd)` — red if <2d, yellow if <7d, dim otherwise
    - In markdown mode: ` due:YYYYMMDD`
11. Wait pill: ` wait:YYYYMMDD` if still waiting (dim)
12. Sched pill: ` sched:YYYYMMDD` if scheduled (dim)
13. Tags (non-virtual, real user tags): ` !tag` (dim cyan)
14. Recur indicator: ` ~recur` (dim)
15. Annotation count: ` [N notes]` (dim) if > 0

Row styling:

- Active (started, pending): bold or cyan prefix indicator
- Negative urgency: dim entire row
- Checklist members: indented with `  ` prefix, checkbox char (☐/☑/⊘/⏱)

Urgency column:

- Positive: normal
- Negative: dim
- Always show 1 decimal place

Footer: `N tasks` (dim, small)

### Section Headers (today view)

```
--- started ---    (cyan)
--- overdue ---    (red)
--- ready ---      (blue)
```

### Markdown Table

```markdown
| ID  | Description | Project | Tags     | Due      | Urg  |
| --- | ----------- | ------- | -------- | -------- | ---- |
| 1   | Buy milk    | Home    | !errands | 20260315 | 15.2 |
```

Separate columns for project, tags, due (absolute date), urgency.
No color codes. Checklist members shown inline under parent with `> ` blockquote prefix.

### Context Banner

```
Context: pro:Work
```

Shown above table when a context is active (read from state file).

## commands.go — Command Handlers

All handlers have signature:

```go
func cmdXxx(store *Store, state *State, args []string, opts Options) error
```

Where `Options` contains `{markdown bool, file string, noColor bool}`.

Each mutating command:

1. Loads store from JSON
2. Makes changes
3. Saves store back to JSON (atomic: write to temp file, rename)
4. Renders updated list (calls `runList` or `runNext`)
5. Saves updated displayMap to state file

### `next [N]`

Default N=10. Runs `runList` with limit=N.
Filters: only pending, not waiting/scheduled, urgency >= 0.
Sort: urgency desc, then entry asc (FIFO tiebreak), then UUID.
Saves displayMap.

### `list [filters]`

Full filter support. No limit.
Determines showWaiting/showDone/showSkipped from filter tags.
If search terms present (non-modifier tokens), include waiting tasks.
Saves displayMap.

Supported filter tokens (identical to web UI):

- `pro:X` / `p:X` — project filter
- `x:X` / `target:X` — target filter
- `end:Nw` — completed in last N weeks/days/months
- `sort:field` / `s:field` — sort (fields: start, end, pri, pro, due, urg, desc, entry, modified)
- `!virtualtag` — virtual tag filter
- `!realtag` — real tag filter
- `text` — search term

### `add <desc> [opts]`

Parses args with `parseTaskArgs`. Creates new Task with:

- UUID: `crypto/rand` based UUID v4
- Entry: `time.Now().UnixMilli()`
- Status: "pending"
- Annotations: []
- All parsed fields

Appends to store.Tasks. Saves. Runs `next` to refresh display.

### `done <IDs>`

Resolves IDs → UUIDs. For each:

- Sets `status = "completed"`, `end = now`
- If `recur` set: runs `calculateNextRecurrence`, creates new pending task
  (fresh UUID, fresh entry, copies all fields except uuid/entry/end/start/depends/annotations)
- If `onDone` set: executes the command string recursively via `execute()`

Saves. Runs list refresh.

### `delete <IDs>`

Resolves IDs → UUIDs. Removes tasks from store.Tasks slice. Saves. Refreshes.

### `skip <IDs> [until:DATE]`

Resolves IDs → UUIDs. For each:

- Sets `status = "skipped"`, `end = now`
- If recurring + due: runs skip-ahead loop until >= untilDate (or just once if no until:)
  Creates next occurrence
- If not recurring: just marks skipped ("cancelled")

Saves. Prints result message. Refreshes.

### `mod <IDs> [opts]`

Resolves IDs → UUIDs. Parses modifications from args.
For each task, applies each modification:

- `description` → set
- `project` → set
- `priority` → set (nil to clear)
- `order` → set (nil to clear)
- `due/wait/sched/recur/url/icon/color/target/onDone` → set
- `!tag` → toggle (add if absent, remove if present)
- `dep:N,M` → toggle each dependency UUID

Saves. Refreshes.

### `start <ID>`

Sets `task.Start = &now`. Saves. Refreshes.

### `info <ID>`

Does not mutate. Prints full task details:

```
Task 3 — <uuid>
Desc:      Buy milk
Status:    pending
Project:   Home
Priority:  10
Tags:      errands
Due:       20260315 (2d)
Wait:      —
Sched:     —
Recur:     1d
URL:       https://...
Started:   —
Urgency:   15.2
Depends:   2 tasks
Checklist: member of "Morning routine" (task 1)
Annotations:
  1. 20260313: Need to get oat milk
Tracking:
  20260310: worked
  20260311: 45m
```

In markdown: same but as a definition list or simple `**field:** value` lines.

### `annotate <ID> <note | -N>`

- `annotate 3 Some note` → appends `{entry: now, description: "Some note"}`
- `annotate 3 -2` → removes annotation at index 2 (1-indexed)

### `projects`

Lists all projects with pending task counts and metadata.

```
Project          Tasks  Tags
Home               5
Work              12    !reference
Work.Backend       3
```

Counts derived from store.Tasks where status=pending.

### `today` / `day`

Equivalent to `list !today` but with today-view sections below main table.

Main table: pending tasks due today (including waiting ones due today).
Sorted by order asc (nulls last), then urgency desc.

Additional sections collected separately (not in displayMap main list,
but added after main tasks in displayMap so they get IDs too):

- **started** (cyan): active tasks not due today
- **overdue** (red): past-due tasks not started
- **ready** (blue): wait ended today, not due today, not started

### `calendar [opts]`

```
cal             # next 14 days
cal lim:30      # next 30 days
cal pro:Work    # filtered
```

Groups tasks by date. For each date in range, shows tasks with:

- `[due]` marker for due date
- `[sched]` marker for scheduled date
- `[wait]` marker for wait date

Also shows overdue from past 7 days.

Output format:

```
20260315  Sat
  1  Buy milk [due] (0d)                    15.2
  2  Review PR [sched]                        4.1

20260316  Sun
  3  Exercise [due] (1d) pro:Health           8.3
```

### `chain <ID>`

Prints dependency tree for a task.

```
chain 3

3 Fix auth bug
  └─ 5 Write tests (blocked)
       └─ 7 Deploy (blocked)
```

Uses DFS from the task, showing what it blocks (tasks that depend on it).
Also shows what blocks it (its own dependencies).

Full tree:

```
Depends on:
  1 Design spec (done ✓)

Blocks:
  5 Write tests
    └─ 7 Deploy
```

### `report stale`

Lists projects sorted by days since last activity (task added, completed, or started).
Reference projects excluded.

```
Project         Last activity    Days
Work.Backend    20260201          34  (red if >30, yellow if >14)
Home            20260210          25
```

### `report rot [N]`

Top N oldest pending tasks by entry date. Default N=10.

```
Age distribution: <30d: 5  30-90d: 3  >90d: 2

 ID  Description              Age
  1  Refactor auth module     127d  (red)
  2  Write blog post           45d  (yellow)
  3  Buy whiteboard            12d
```

### `report done [period] [by:project|by:tag]`

Completed tasks grouped by project (default) or tag.
Period default `1w`. Supports `Nd`, `Nw`, `Nm`.

```
## Work.Backend  (3)
  ✓ Fix login bug
  ✓ Add rate limiting
  ✓ Update docs

## Home  (1)
  ✓ Buy groceries
```

### `export [filters]`

Applies filters (same as `list`), then prints JSON to stdout in the standard
`{tasks, projects, savedAt}` format. Can be piped to a file.

```bash
tasca -f ~/tasca.json export pro:Work > work_backup.json
```

### `import`

Reads JSON from stdin. Upserts tasks and projects by UUID/name.

```bash
cat backup.json | tasca -f ~/tasca.json import
```

### `help [cmd]`

Prints command list or detailed help for a specific command.

## term.go — Raw Terminal Mode

Same pattern as garbell's `term_darwin.go` / `term_linux.go`.
Uses `syscall.SYS_IOCTL` with `termios` to enable raw mode.
Restores on `defer disableRawMode(state)`.

## main.go — Structure

```go
func main() {
    // Parse global flags: -f, --markdown, --no-color
    // Resolve file path
    // If remaining args: single-shot mode → execute(args)
    // Else: REPL mode → repl.Run()
}

type REPL struct {
    file     string
    history  []string
    histPos  int
    markdown bool
}

func (r *REPL) Run() error {
    // Raw terminal mode (same as garbell)
    // Prompt: "\r\x1b[K\x1b[1;36mtasca\x1b[0m> "
    // Byte-by-byte loop:
    //   Enter → execute(input), redraw prompt
    //   Ctrl+C (empty buf) → exit
    //   Ctrl+D → exit
    //   Backspace → edit buf
    //   Up/Down → history navigation
    //   Left/Right → cursor movement
    //   Tab → command completion
    //   Printable → insert into buf
}

func (r *REPL) execute(input string) {
    args := strings.Fields(input)
    // same dispatch as single-shot
}
```

Tab completion in REPL: complete command names on first token,
project names (`pro:` prefix) and tag names (`!` prefix) on subsequent tokens
(derived from loaded store).

## Invocation Patterns for Agents

The primary agent interface is single-shot. Suggested skill usage:

```bash
# Read operations (safe, no mutation)
tasca -f $TASCA_FILE --markdown next
tasca -f $TASCA_FILE --markdown list pro:Work
tasca -f $TASCA_FILE --markdown info 3
tasca -f $TASCA_FILE --markdown today
tasca -f $TASCA_FILE --markdown report rot

# Write operations (mutate tasca.json)
tasca -f $TASCA_FILE add Fix the login bug pro:Work.Backend pri:50 due:tomorrow
tasca -f $TASCA_FILE done 3
tasca -f $TASCA_FILE mod 5 pri:10 !urgent
tasca -f $TASCA_FILE annotate 2 Discussed with team, blocked on design

# Typical agent workflow:
#  1. tasca --markdown next          → get current state + IDs
#  2. tasca done 3                   → mark complete (IDs from step 1 still valid)
#  3. tasca add New task pro:X       → add task
#  4. tasca --markdown next          → verify new state
```

State file ensures IDs from a `next` call remain valid for subsequent mutations
within the same session (up to 24h TTL).

## Implementation Notes

### Atomic File Writes

All saves write to a temp file in the same directory, then `os.Rename`:

```go
tmp, _ := os.CreateTemp(filepath.Dir(path), ".tasca-*.json")
json.NewEncoder(tmp).Encode(store)
tmp.Close()
os.Rename(tmp.Name(), path)
```

### UUID Generation

```go
import "crypto/rand"

func newUUID() string {
    var b [16]byte
    rand.Read(b[:])
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
        b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
```

### Monotonic Timestamps

Entry timestamps need to be monotonically increasing (matching JS `uniqueTimestamp`).
Use `time.Now().UnixMilli()` but track last used and increment if collision:

```go
var lastTs int64
func uniqueTimestamp() int64 {
    now := time.Now().UnixMilli()
    if now <= lastTs { lastTs++ } else { lastTs = now }
    return lastTs
}
```

### Commands Not Implemented

- `undo` — stack is in-memory only in web UI, not persisted in JSON
- `edit` — populates DOM input field, not applicable to CLI
- `link/load/save/unlink` — File System Access API, not needed (use `-f` flag)
- `copy/paste` — clipboard API
- `icon` — Phosphor icon tag index lookup
- `ref` — fuzzy trigram reference search (complex, low priority)
- `checklist/ucl` — complex grouping logic (can add later)
- `track` — effort tracking (can add later)
- `context/ctx` — persistent context (CLI uses explicit filters instead)
- `stop` — not in README, web UI only

### Commands Renamed/Adapted

- `open` → not implemented (opens browser tab)
- `paste` → `import` from stdin
- `copy` → `export` to stdout

## Build

```bash
cd cli
go build -o tasca .
# or
go build -o ~/bin/tasca .
```

No `go.mod` needed beyond `module tasca` + `go 1.21`.

## Testing Approach (future)

Since there's no DB dependency, testing is straightforward:

- Load a test `tasca.json` fixture
- Run command functions directly
- Assert store state and/or rendered output
- Use `testing` stdlib only

Key test cases:

- Urgency calculation matches web UI for known tasks
- Date parsing edge cases (named days, time-only, date@time)
- Recurrence calculation (weekly, monthly, skip-ahead)
- Multi-ID parsing (ranges, mixed, x:name)
- Filter application (virtual tags, project hierarchy, search)
- Done with recurrence creates correct next task
- Skip with until: advances to correct date
