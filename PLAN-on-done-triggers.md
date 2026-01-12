# On-Done Triggers - Implementation Plan

## Overview

Add trigger commands that execute when a task is completed. Primary use case: completing one task (hike) defers or modifies another (stationary bike).

## New Property: `x:` (Target Identifier)

A stable identifier for referencing tasks across the codebase.

**Syntax:**
- `x:bike` or `target:bike` (long form)
- Must be unique across all pending tasks
- Persists across recurrence (copied to next occurrence)

**Visibility:**
- Only shown in `info TASKID` output
- Hidden from list views, tables, and other presentations
- Internal detail, not user-facing in normal workflow

**Must work everywhere task references are accepted:**
- `list x:bike` - filter by identifier
- `done x:bike` - complete by identifier
- `mod x:bike ...` - modify by identifier
- `delete x:bike` - delete by identifier
- `start x:bike` / `stop x:bike`
- `skip x:bike`
- `info x:bike`
- `annotate x:bike ...`
- Any other command that takes a task ID

**Implementation notes:**
- Store as `target` property on task object
- Add resolution function: `resolveTaskReference(ref)` that handles both integer IDs and `x:name`
- Update all commands to use this resolver
- Validate uniqueness on add/modify

## New Property: `done:` (Completion Trigger)

A command string that executes when the task is completed.

**Syntax:**
- `done:mod x:bike due:3d` - modify another task
- `done:done x:other` - complete another task
- `done:add followup task due:1w` - create a new task
- Must be last property in command (captures everything after `done:`)

**Behavior:**
- On task completion, parse trigger as a command and execute it
- Trigger persists across recurrence (copied to next occurrence)
- If target not found, warn in output area (don't fail silently)
- Multiple commands: consider `|` separator for chaining (optional, v2)

**Examples:**
```
# Hiking defers bike for 3 days
add stationary bike due:today recur:1d x:bike
add hike done:mod x:bike due:3d

# Completing a task creates a follow-up in a week
add review document done:add follow up on review due:1w

# Completing one task completes another
add task A x:a
add task B done:done x:a
```

## Edit Command Handling

**Problem:** `done:` contains free-form command text, which breaks `edit` parsing.

**Solution:**
- `edit` omits `done:` (and future `start:`, `skip:`) from output
- `info` displays triggers for inspection
- To modify triggers: re-add with new trigger, or future `edit-trigger` command

## Multiple Targets

Support comma-separated targets where it makes sense:
- `done:mod x:bike,x:yoga due:3d` - defer multiple tasks
- Resolution: expand to multiple operations internally

## Future: Other Trigger Types

Same pattern, same edit-omission approach:
- `start:` - executes when task is started
- `skip:` - executes when task is skipped

## Implementation Checklist

### Phase 1: Target Identifier (`x:`) - COMPLETED

- [x] Add `target` property to task schema
- [x] Create `resolveRefs(ref)` in commands-state.js
  - Returns UUIDs for integer ID, ranges, or `x:name`
- [x] Update command parser to recognize `x:name` syntax
- [x] Update all commands to use resolver:
  - [x] `done`
  - [x] `mod` / `modify`
  - [x] `delete`
  - [x] `start`
  - [x] `skip`
  - [x] `info`
  - [x] `annotate`
  - [x] `edit`
  - [x] `chain`
- [x] Update `list` to filter by `x:name`
- [x] Validate uniqueness on add/modify
- [x] Copy `target` to next occurrence on recurrence (via spread)
- [x] Add e2e tests for `x:` resolution

### Phase 2: Completion Triggers (`done:`) - COMPLETED

- [x] Add `onDone` property to task schema
- [x] Update command parser to capture `done:...` as final property
- [x] Modify `done` command to execute trigger after completion
- [x] Handle trigger execution errors (warn, don't fail)
- [x] Copy `onDone` to next occurrence on recurrence (via spread)
- [x] Update `edit` to omit `onDone` from output (already omitted)
- [x] Update `info` to display triggers
- [x] Add tests for trigger execution

### Phase 3: Enhancements (Optional)

- [ ] Multiple targets: `x:a,x:b`
- [ ] Command chaining: `done:mod x:a due:3d | done x:b`
- [ ] Other triggers: `start:`, `skip:`
- [ ] Weekday recurrence: `recur:sun`, `recur:mon,wed,fri`

## Testing

Add tests in `tests/test_tasca.js` for:
- `x:` uniqueness validation
- `x:` resolution in various commands
- `x:` persistence across recurrence
- Trigger parsing (done: as last property)
- Trigger execution on completion
- Trigger with `mod`, `done`, `add` commands
- Trigger target not found warning
- Trigger persistence across recurrence
- Edit omitting triggers
