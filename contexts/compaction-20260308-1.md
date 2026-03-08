# Session Compaction Summary

## User Intent

- Fix gemini-cli not receiving the tasca skill during `task install`
- Add project-level annotations (free-text notes/descriptions on projects)
- Add `info pro:Name` support in the CLI TUI
- Add annotation editing (replace in place with `-N new text`) for both tasks and projects

## Contextual Work Summary

### Gemini-CLI Install Fix

- `Taskfile.yml` `install` task was only copying the skill to `~/.claude/skills/tasca`
- Added parallel copy step to `~/.gemini/skills/tasca` so both Claude Code and Gemini CLI receive the skill

### Project Annotations (Go CLI)

- Added `Annotations []Annotation` field to the `Project` struct in `data.go`
- Extracted reusable `applyAnnotation()` function that handles add/remove/edit on any annotation slice
- Added `annotateProject()` helper that finds-or-creates the project and delegates to `applyAnnotation`
- `cmdAnnotate` now detects `pro:Name` prefix on first arg and routes to project path

### Project Info (Go CLI)

- `cmdInfo` now detects `pro:Name`/`p:Name`/`proj:Name` prefix and calls `printProjectInfo`
- Added `printProjectInfo()` to `display.go` rendering icon, tags, banners, pending task count, and annotations (both ANSI and `--markdown` modes)

### Annotation Editing (Go CLI + Web)

- `-N` alone still removes; `-N text` now edits the annotation in place
- Works for both task and project annotations in CLI
- Web app `handleAnnotate` updated with same `-N text` edit semantics

### Project Annotations (Web App)

- `handleAnnotateProject` restructured: banner → remove/edit → icon/tag metadata → free-text annotation
- Free-text args (not icon:/!tag/banner:) are now added as timestamped project annotations
- `handleInfoProject` now renders project annotations the same way task info renders task annotations

### Testing

- Added 12 new Go unit tests covering `applyAnnotation` and `annotateProject`
- Cases: add, add-second, remove-middle, remove-first, edit, edit-multi-word, invalid index, invalid syntax, creates-project, preserves-existing-tags, remove-via-project, edit-via-project

### Skill Docs

- `cli/skills/SKILL.md` updated with examples for `annotate pro:Name text`, `annotate pro:Name -N`, `annotate pro:Name -N text`, and `info pro:Name`

## Files Touched

### CLI — Go

- **cli/Taskfile.yml**: Added `~/.gemini/skills/tasca` install step
- **cli/cmd/tasca/data.go**: Added `Annotations []Annotation` to `Project` struct
- **cli/cmd/tasca/commands.go**: `cmdInfo` project routing; `cmdAnnotate` project routing + `applyAnnotation`/`annotateProject` helpers; annotation edit support
- **cli/cmd/tasca/display.go**: Added `printProjectInfo()` function
- **cli/cmd/tasca/logic_test.go**: 12 new tests for `applyAnnotation` and `annotateProject`

### Web App — JavaScript

- **src/js/commands-tasks.js**: `handleAnnotate` (edit support), `handleAnnotateProject` (restructured + free-text annotations), `handleInfoProject` (renders annotations)

### Skill

- **cli/skills/SKILL.md**: Documented new project annotation and info commands
