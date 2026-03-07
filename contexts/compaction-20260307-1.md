# Session Compaction Summary

## User Intent

- Build a Go CLI/TUI for Tasca that replicates web UI functionality for agent use
- Primary consumer: coding agents (via skill); secondary: interactive human REPL
- No external Go dependencies; reads/writes `tasca.json` directly
- Output modes: ANSI color (default) and `--markdown` (for LLM consumption)

## Contextual Work Summary

### Planning

- Wrote comprehensive `cli/PLAN.md` covering architecture, data model, commands, display format, agent workflow patterns, and implementation decisions
- Key decisions: state file in `~/tmp/tasca/<hash>.state` for ID persistence, `--markdown` flag for GFM table output, garbell-style raw-mode REPL

### File Structure Created

Five source files + terminal platform files + go.mod in `cli/`:

- `data.go` — types, JSON load/save, state file, UUID/timestamp helpers
- `logic.go` — urgency (exact JS port), filtering, virtual tags, date parsing, recurrence, sorting, multi-ID resolution, task arg parsing
- `display.go` — ANSI table renderer, markdown renderer, today sections, info/chain/projects/calendar/reports display
- `commands.go` — all command handlers: next, list, add, done, delete, skip, mod, start, info, annotate, chain, projects, today, calendar, report, export, import, help
- `main.go` — flag parsing, file resolution, single-shot dispatch, REPL (garbell pattern: raw terminal mode, history, cursor movement, tab completion)
- `term.go` / `term_darwin.go` / `term_linux.go` — raw terminal mode via syscall/termios

### Build Status

- Compiles cleanly (`go build`)
- `help` command works without a file
- Hit a JSON unmarshaling error on real data: `priority` field stored as string in some tasks
- Fix in progress: `FlexInt` custom type + `rawTask` mirror struct + `Task.UnmarshalJSON` to handle string/number/empty priority and order fields
- **Stopped mid-fix** — `FlexInt.UnmarshalJSON` doesn't yet handle empty string `""`; need to return nil (treat as no priority) when value is `""`

### Real Data Location

User's tasca.json: `/Users/ruben/Library/Mobile Documents/com~apple~CloudDocs/tasca/tasca.json`

### What Was NOT Implemented

Per plan: undo, edit, link/save/load/unlink, copy/paste, icon search, ref (fuzzy), checklist/ucl, track, context persistence, stop

## Files Touched

### New — Go CLI (`cli/`)

- **cli/PLAN.md**: Full implementation plan (architecture, data model, commands, display, agent workflow)
- **cli/go.mod**: `module tasca`, `go 1.21`
- **cli/data.go**: Task/Project/Store/State types; JSON load/save with atomic writes; state file (FNV hash path); UUID v4; monotonic timestamp; FlexInt + rawTask + Task.UnmarshalJSON (partially complete — FlexInt empty-string case needs fixing)
- **cli/logic.go**: Urgency (exact JS port with all constants); virtual tag expansion/matching; date parsing (full feature parity with JS); recurrence calculation; filter struct + applyFilters; sort functions (default urgency, today-order, custom fields); resolveIDs; parseTaskArgs
- **cli/display.go**: ANSI helpers (Solarized palette); renderList (ANSI + Markdown paths); buildDescCell; formatProject (depth colors); today section renderer; printInfo; printChain; printProjects; printCalendar; report{Stale,Rot,Done}; pad/truncate ANSI-aware utilities
- **cli/commands.go**: All command handlers delegating to display/logic; runList core (filter→urgency→sort→limit→render→save state)
- **cli/main.go**: Flag parsing; resolveFile (TASCA_FILE env, ./tasca.json, ~/tasca.json); execute() dispatcher with normalizeArgs + resolveCommand (handles "ID CMD" syntax); REPL with raw mode, history, cursor, tab completion (commands + pro: + !tag)
- **cli/term.go**: enableRawMode/disableRawMode via syscall (build-tagged)
- **cli/term_darwin.go**: TIOCGETA/TIOCSETA constants
- **cli/term_linux.go**: TCGETS/TCSETS constants

## Next Steps to Resume

1. Fix `FlexInt.UnmarshalJSON` in `data.go`: when stripped value is `""`, return `nil` error and leave `V` as zero — but caller needs to detect nil. Better: keep `*FlexInt` nullable; if `b == "null" || stripped == ""`, return nil without error and don't set `t.Priority`.
2. Run `./tasca -f "$TASCA" next` to verify real data loads
3. Run `./tasca -f "$TASCA" --markdown next` to verify markdown output
4. Test mutations: add, done, mod against a copy of the real file
5. Update `TASCA_FILE` default resolution or document the iCloud path for skill use
