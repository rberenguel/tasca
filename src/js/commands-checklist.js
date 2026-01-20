// Checklist command handlers: checklist (cl), unchecklist (ucl)

import { resolveRefs } from "./commands-state.js";
import { pushUndo } from "./undo.js";

// Check if a task is a checklist parent
export const isChecklistParent = (task) => {
  return task?.checklist === "parent";
};

// Check if a task is a checklist member (has checklist UUID)
export const isChecklistMember = (task) => {
  return !!(task?.checklist && task.checklist !== "parent");
};

// Get the parent UUID from a checklist member
export const getChecklistParentUuid = (task) => {
  if (isChecklistMember(task)) {
    return task.checklist;
  }
  return null;
};

// Get all members of a checklist parent
export const getChecklistMembers = async (
  parentUuid,
  dbOps,
  statusFilter = null,
) => {
  const all = statusFilter
    ? await dbOps.getByStatus(statusFilter)
    : await dbOps.getAll();
  return all.filter((t) => t.checklist === parentUuid);
};

// Check if parent should auto-complete (all members done/skipped, none recurring)
export const shouldAutoComplete = async (parentUuid, dbOps) => {
  const members = await getChecklistMembers(parentUuid, dbOps);
  if (members.length === 0) return false;

  const allDoneOrSkipped = members.every(
    (m) => m.status === "completed" || m.status === "skipped",
  );
  const anyRecurring = members.some((m) => !!m.recur);

  return allDoneOrSkipped && !anyRecurring;
};

// Auto-complete parent if conditions are met
export const maybeAutoCompleteParent = async (parentUuid, dbOps) => {
  if (await shouldAutoComplete(parentUuid, dbOps)) {
    const parent = await dbOps.get(parentUuid);
    if (parent && parent.status === "pending") {
      const undoRecord = { type: "update", task: structuredClone(parent) };
      parent.status = "completed";
      parent.end = Date.now();
      await dbOps.update(parent);
      return undoRecord;
    }
  }
  return null;
};

// Check if parent should be reverted to pending (if any member is now pending/not done)
export const maybeRevertParent = async (parentUuid, dbOps) => {
  const members = await getChecklistMembers(parentUuid, dbOps);
  if (members.length === 0) return null;

  // Parent should be pending if ANY member is pending (or rather, if NOT all are done/skipped)
  // Actually, simpler: if not shouldAutoComplete, then it should be pending.
  const shouldBeComplete = await shouldAutoComplete(parentUuid, dbOps);

  if (!shouldBeComplete) {
    const parent = await dbOps.get(parentUuid);
    if (parent && parent.status !== "pending") {
      const undoRecord = { type: "update", task: structuredClone(parent) };
      parent.status = "pending";
      parent.end = null; // Clear completion date
      await dbOps.update(parent);
      return undoRecord;
    }
  }
  return null;
};

// checklist PARENT_ID MEMBER_IDS
// Sets parent as checklist container, members get checklist:PARENT_UUID and order
export const handleChecklist = async (ctx) => {
  const parentIdArg = ctx.args[0];
  const memberIdArg = ctx.args[1];

  if (!parentIdArg || !memberIdArg) {
    return ctx.print(
      '<span class="msg-error">Usage: checklist PARENT_ID MEMBER_IDS</span>',
    );
  }

  // Resolve parent
  const parentUuids = await resolveRefs(
    parentIdArg,
    ctx.displayMapRef,
    ctx.dbOps,
  );
  if (parentUuids.length !== 1) {
    return ctx.print(
      '<span class="msg-error">Specify exactly one parent task.</span>',
    );
  }
  const parentUuid = parentUuids[0];
  const parent = await ctx.dbOps.get(parentUuid);
  if (!parent) {
    return ctx.print('<span class="msg-error">Parent task not found.</span>');
  }

  // Validate: parent cannot have recur
  if (parent.recur) {
    return ctx.print(
      '<span class="msg-error">Checklist parent cannot be recurring.</span>',
    );
  }

  // Validate: parent cannot already be a member of another checklist
  if (isChecklistMember(parent)) {
    return ctx.print(
      '<span class="msg-error">Task is already a checklist member.</span>',
    );
  }

  // Resolve members
  const memberUuids = await resolveRefs(
    memberIdArg,
    ctx.displayMapRef,
    ctx.dbOps,
  );
  if (memberUuids.length === 0) {
    return ctx.print('<span class="msg-error">No valid member IDs.</span>');
  }

  // Validate members
  for (const uuid of memberUuids) {
    if (uuid === parentUuid) {
      return ctx.print(
        '<span class="msg-error">Task cannot be its own parent.</span>',
      );
    }
    const member = await ctx.dbOps.get(uuid);
    if (!member) continue;

    // Member cannot be a checklist parent
    if (isChecklistParent(member)) {
      return ctx.print(
        `<span class="msg-error">Task "${member.description.substring(0, 30)}..." is a checklist parent.</span>`,
      );
    }
  }

  const allUndoRecords = [];

  // Mark parent as checklist container (if not already)
  if (!isChecklistParent(parent)) {
    allUndoRecords.push({ type: "update", task: structuredClone(parent) });
    parent.checklist = "parent";
    await ctx.dbOps.update(parent);
  }

  // Set checklist membership and order on members
  let orderNum = 1;
  for (const uuid of memberUuids) {
    const member = await ctx.dbOps.get(uuid);
    if (!member) continue;

    allUndoRecords.push({ type: "update", task: structuredClone(member) });
    member.checklist = parentUuid;
    member.order = orderNum++;
    await ctx.dbOps.update(member);
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  ctx.print(
    `<span class="msg-success">Added ${memberUuids.length} member(s) to checklist.</span>`,
  );
  ctx.markDirty();
  await ctx.runListRefresh();
};

// unchecklist MEMBER_IDS
// Removes tasks from their checklist
export const handleUnchecklist = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];

  if (!idArg) {
    return ctx.print(
      '<span class="msg-error">Usage: unchecklist MEMBER_IDS</span>',
    );
  }

  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0) {
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  }

  const allUndoRecords = [];
  let removedCount = 0;

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    // Only process checklist members
    if (!isChecklistMember(task)) {
      continue;
    }

    allUndoRecords.push({ type: "update", task: structuredClone(task) });
    delete task.checklist;
    delete task.order;
    await ctx.dbOps.update(task);
    removedCount++;
  }

  if (removedCount === 0) {
    return ctx.print(
      '<span class="msg-info">No checklist members found in selection.</span>',
    );
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  ctx.print(
    `<span class="msg-success">Removed ${removedCount} task(s) from checklist.</span>`,
  );
  ctx.markDirty();
  await ctx.runListRefresh();
};
