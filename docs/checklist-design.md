# Checklist Feature Design

## Overview

Checklists allow grouping related tasks that are done together (like a release/deploy) or form a logical routine (like daily exercise). The design leverages existing task infrastructure - members are normal tasks with full feature support.

## Data Model

### Container Task

- Regular task with property `checklist:parent`
- Cannot have `recur` set (constraint enforced by commands)
- Has standard properties: description, project, tags, icon, etc.
- Never explicitly marked "done" by user (see Auto-completion below)

### Member Task

- Regular task with property `checklist:PARENT_UUID`
- Inherits order from checklist command sequence (stored in `order` property)
- Full task features: icons, recurrence, due dates, priorities, etc.
- Hidden from normal views when part of a checklist (rendered under parent instead)

### Orphan Members

- Members whose parent UUID no longer exists
- Display: broken-link icon indicator
- `info` command explains orphan status
- `unchecklist MEMBER_ID` removes the checklist property, making it a regular task

## Commands

### `checklist PARENT_ID MEMBER_IDS` (alias: `cl`)

Creates or updates checklist membership.

```
checklist 5 1,2,3      # Tasks 1,2,3 become members of task 5 (in that order)
cl 5 7-10              # Tasks 7,8,9,10 become members of task 5
cl 5 1,3,7-9           # Mixed syntax
```

Behavior:

- Sets `checklist:parent` on parent task (if not already set)
- Sets `checklist:PARENT_UUID` on each member
- Sets `order:N` on members based on position in command (1-indexed)
- Fails if parent has `recur` set
- Fails if any member is already a checklist parent

### `unchecklist MEMBER_IDS` (alias: `ucl`)

Removes tasks from their checklist.

```
unchecklist 3          # Task 3 becomes regular task
ucl 1,2,3              # Multiple tasks
```

Behavior:

- Clears `checklist:UUID` property from members
- Clears `order` property
- Does not affect the parent

### Modifications to Existing Commands

**`add`**: No changes needed. Create tasks normally, then use `checklist` to group.

**`modify`**:

- Prevent adding `recur` to a checklist parent
- Allow normal modifications to members

**`done MEMBER_ID`**:

- Normal completion behavior
- Triggers parent auto-completion check (see below)

**`skip MEMBER_ID`**:

- Normal skip behavior (cancel for non-recurring, skip occurrence for recurring)
- Triggers parent auto-completion check

**`delete`**:

- Deleting a parent: members become orphans (show broken-link)
- Deleting a member: normal deletion, triggers parent auto-completion check

**`info`**:

- On parent: shows member list (pending and future, not historical done)
- On member: shows parent reference
- On orphan: shows broken-link explanation

**`edit`**:

- Works normally on both parents and members
- Does not include `checklist:X` in the edit line (managed via `checklist` command only)

## Auto-completion Logic

Parent auto-completes when ALL conditions are met:

1. All members are done OR skipped (status != "pending")
2. No member has `recur` set

This handles:

- **Recurring checklists**: Never auto-complete, resurface when members recur
- **One-time checklists**: Auto-complete when all steps finished/cancelled

Implementation: Check after `done`, `skip`, `delete` on any member.

## Virtual Tag

`!checklist` (shorthands: `!cl`) matches:

- Tasks with `checklist:parent` property (containers)
- Tasks with `checklist:UUID` property (members)

Use cases:

- `list !checklist` - see all checklist-related tasks
- `list -!checklist` - exclude checklist tasks from a view

## Rendering

### Today View (`day` / `!today` context)

If any member is due today (matches `!today`), show:

```
 1  ☰ Deploy release v2.0                      pro:Work
      ☑ Run test suite
      ☑ Update changelog
      □ Tag release
      ◇ Notify stakeholders (waiting)
```

- Parent shown with checklist icon (e.g., `list-checks` from Phosphor)
- Done members: filled checkbox (☑), possibly dimmed
- Pending members: hollow checkbox (□)
- Waiting/scheduled members: diamond (◇), dimmed
- Members indented under parent
- Member order via `order` property (reorder with `mod ID o:N`)

### Next View

Compact summary format:

```
 1  Deploy release v2.0  (2/4)                 pro:Work
```

- `(done/total)` count suffix
- No expanded members
- Shown if any member would appear in next view

### List View / Project View

Full expansion like Today view.

### Calendar View

Show member tasks individually on their due dates (not the parent). Optionally add a small checklist icon indicator to show they belong to a checklist.

## Implementation Phases

### Phase 1: Data Model & Commands ✓

- [x] Add `checklist` command (parse multi-ID, set properties)
- [x] Add `unchecklist` command
- [x] Add validation: prevent `recur` on parents
- [x] Add validation: prevent parent-of-parent
- [x] Update `info` command for parent/member/orphan display
- [x] Add `!checklist` virtual tag

### Phase 2: Rendering ✓

- [x] Group checklist members under parents in list.js
- [x] Add checkbox icons for member states (☐ pending, ☑ done, ⊘ skipped, ⏱ waiting)
- [x] Add dimming for waiting/scheduled members
- [x] Modify `next` view for summary format `(done/total)`
- [x] Update list/today rendering with full expansion in ui.js

### Phase 3: Auto-completion ✓

- [x] Implement auto-completion check function (in commands-checklist.js)
- [x] Hook into `done` command
- [x] Hook into `skip` command
- [x] Hook into `delete` command

### Phase 4: Edge Cases & Polish ✓

- [x] Orphan detection in `info` command (shows broken-link message)
- [x] Undo support for checklist operations
- [x] Export/import handling (verified: JSON.stringify preserves all properties)
- [x] Calendar view with checklist icon indicator for members

## Resolved Decisions

1. **`unchecklist` clears `order`**: Yes, for cleanliness
2. **Calendar view**: Show member tasks individually, with optional checklist icon indicator
3. **Reordering members**: Use `mod ID o:N` like today view
4. **Parent icon**: Always checklist icon (e.g., `list-checks`)
5. **Command shorthands**: `cl` for checklist, `ucl` for unchecklist

## Open Questions

(None currently)

## Test Cases

- Create checklist, verify member ordering
- Complete all non-recurring members, verify parent auto-completes
- Complete recurring checklist members, verify parent stays pending
- Delete parent, verify members show orphan indicator
- `unchecklist` member, verify it appears in normal views
- `info` on parent/member/orphan shows correct information
- `list !checklist` filters correctly
- Rendering in today/next/list views
