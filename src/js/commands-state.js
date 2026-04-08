// State change handlers: undo, start, done, delete, skip

import {
  generateUUID,
  calculateNextRecurrence,
  uniqueTimestamp,
  parseDate,
  formatDate,
} from "./utils.js";
import { pushUndo, popUndo } from "./undo.js";
import {
  isChecklistMember,
  getChecklistParentUuid,
  maybeAutoCompleteParent,
  maybeRevertParent,
} from "./commands-checklist.js";

// Parse multi-ID syntax: "1", "1,3,5", "1-3", or "1,3-5,7"
// Returns array of valid display IDs (1-indexed)
export const parseIds = (str, displayMapRef) => {
  if (!str) return [];
  const ids = new Set();
  const parts = str.split(",");
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((n) => parseInt(n));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          if (displayMapRef.value[i - 1]) ids.add(i);
        }
      }
    } else {
      const id = parseInt(part);
      if (!isNaN(id) && displayMapRef.value[id - 1]) ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a - b);
};

// Resolve mixed references: "1", "1,3,5", "1-3", "x:name", or "1,x:bike,3"
// Returns array of UUIDs
export const resolveRefs = async (str, displayMapRef, dbOps) => {
  if (!str) return [];
  const uuids = new Set();
  const parts = str.split(",");

  for (const part of parts) {
    if (part.startsWith("x:")) {
      // Target reference
      const name = part.substring(2);
      const all = await dbOps.getByStatus("pending");
      const match = all.find((t) => t.target === name);
      if (match) uuids.add(match.uuid);
    } else if (part.includes("-") && /^\d+-\d+$/.test(part)) {
      // Range: "1-3"
      const [start, end] = part.split("-").map(Number);
      for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
        const uuid = displayMapRef.value[i - 1];
        if (uuid) uuids.add(uuid);
      }
    } else {
      // Single ID
      const id = parseInt(part);
      if (!isNaN(id)) {
        const uuid = displayMapRef.value[id - 1];
        if (uuid) uuids.add(uuid);
      }
    }
  }
  return [...uuids];
};

// Apply an undo record
const applyUndo = async (record, dbOps) => {
  if (record.type === "update") {
    await dbOps.update(record.task, { touch: false });
  } else if (record.type === "create") {
    await dbOps.delete(record.uuid);
  } else if (record.type === "delete") {
    await dbOps.add(record.task, { touch: false });
  } else if (record.type === "compound") {
    for (const r of [...record.records].reverse()) {
      await applyUndo(r, dbOps);
    }
  }
};

export const handleUndo = async (ctx) => {
  const record = popUndo();
  if (!record)
    return ctx.print('<span class="msg-error">Nothing to undo.</span>');
  await applyUndo(record, ctx.dbOps);
  ctx.print('<span class="msg-success">Undone.</span>');
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleStart = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const now = Date.now();
  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;
    pushUndo({ type: "update", task: structuredClone(task) });
    task.start = now;
    await ctx.dbOps.update(task);
  }
  ctx.print(`<span class="msg-success">Started.</span>`);
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleStop = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const now = Date.now();
  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task || !task.start) continue;
    pushUndo({ type: "update", task: structuredClone(task) });
    delete task.start;
    task.touches = (task.touches || 0) + 1;
    await ctx.dbOps.update(task);
  }
  ctx.print(`<span class="msg-success">Stopped.</span>`);
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleDone = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];
  let recurringCount = 0;
  const affectedParentUuids = new Set();

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    // Track parent if this is a checklist member
    if (isChecklistMember(task)) {
      const parentUuid = getChecklistParentUuid(task);
      if (parentUuid) affectedParentUuids.add(parentUuid);
    }

    allUndoRecords.push({ type: "update", task: structuredClone(task) });
    task.status = "completed";
    task.end = Date.now();
    await ctx.dbOps.update(task);

    const recurrence = calculateNextRecurrence(task);
    if (recurrence) {
      const newUuid = generateUUID();
      const newTask = {
        ...task,
        uuid: newUuid,
        status: "pending",
        due: recurrence.nextDue,
        wait: recurrence.nextWait || null,
        waitTime: recurrence.waitTime || task.waitTime || null,
        sched: recurrence.nextSched || null,
        entry: uniqueTimestamp(),
        annotations: [],
      };
      delete newTask.depends;
      delete newTask.end;
      delete newTask.start;
      await ctx.dbOps.add(newTask);
      allUndoRecords.push({ type: "create", uuid: newUuid });
      recurringCount++;
    }

    // Execute on-done trigger if present
    if (task.onDone) {
      try {
        await ctx.execute(task.onDone);
      } catch (err) {
        ctx.print(
          `<span class="msg-warning">Trigger warning: ${err.message}</span>`,
        );
      }
    }
  }

  // Check for checklist parent auto-completion
  let autoCompletedCount = 0;
  for (const parentUuid of affectedParentUuids) {
    const undoRecord = await maybeAutoCompleteParent(parentUuid, ctx.dbOps);
    if (undoRecord) {
      allUndoRecords.push(undoRecord);
      autoCompletedCount++;
    }
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  if (autoCompletedCount > 0) {
    ctx.print(
      `<span class="msg-success">Completed. Checklist auto-completed.</span>`,
    );
  } else if (recurringCount > 0) {
    ctx.print(
      `<span class="msg-success">Completed ${uuids.length} task(s). ${recurringCount} recurring task(s) created.</span>`,
    );
  } else if (uuids.length > 1) {
    ctx.print(
      `<span class="msg-success">Completed ${uuids.length} tasks.</span>`,
    );
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleUndone = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];
  const affectedParentUuids = new Set();
  let deletedFutureCount = 0;

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    // If task is already pending, check if it's a recurring future instance that the user wants to undo
    if (task.status === "pending") {
      if (!task.recur) continue; // Not recurring, just ignore

      // User selected the NEW pending task, but wants to undo the COMPLETION that created it.
      // We need to find the COMPLETED task that spawned this one.
      // Heuristic: Same description, project, recur. End time should be close to this task's entry.
      // Since entry is set to uniqueTimestamp() which is around Date.now() when created, and
      // the completed task's end is roughly the same time.
      // Actually, handleDone sets end = Date.now(), then creates new task with entry = uniqueTimestamp().
      // So new.entry >= old.end.

      const allTasks = await ctx.dbOps.getAll();
      // Find candidates: completed, same attrs, end <= task.entry
      const candidates = allTasks.filter(
        (t) =>
          t.status === "completed" &&
          t.description === task.description &&
          t.project === task.project &&
          t.recur === task.recur &&
          (t.end || 0) <= task.entry,
      );

      // Pick the most recent one
      candidates.sort((a, b) => (b.end || 0) - (a.end || 0));
      const originTask = candidates[0];

      if (!originTask) {
        // No matching completed task found, ignore
        continue;
      }

      // Found the origin!
      // Action:
      // 1. Delete this pending task (the future instance)
      // 2. Revert the origin task to pending

      // 1. Delete future instance
      allUndoRecords.push({
        type: "delete",
        task: structuredClone(task),
      });
      await ctx.dbOps.delete(task.uuid);
      deletedFutureCount++;

      // 2. Revert origin task
      allUndoRecords.push({
        type: "update",
        task: structuredClone(originTask),
      });
      originTask.status = "pending";
      originTask.end = null;
      await ctx.dbOps.update(originTask);

      // Handle checklist parent for the ORIGIN task
      if (isChecklistMember(originTask)) {
        const parentUuid = getChecklistParentUuid(originTask);
        if (parentUuid) affectedParentUuids.add(parentUuid);
      }

      continue; // Done with this item
    }

    // Normal path for completed/skipped tasks
    // Track parent if this is a checklist member
    if (isChecklistMember(task)) {
      const parentUuid = getChecklistParentUuid(task);
      if (parentUuid) affectedParentUuids.add(parentUuid);
    }

    allUndoRecords.push({ type: "update", task: structuredClone(task) });
    task.status = "pending";
    task.end = null;
    await ctx.dbOps.update(task);

    // Recurrence handling: Find and delete future instance
    if (task.recur) {
      const pendingTasks = await ctx.dbOps.getByStatus("pending");
      const futureInstance = pendingTasks.find((t) => {
        return (
          t.description === task.description &&
          t.project === task.project &&
          t.recur === task.recur &&
          t.entry > (task.end || 0) // Created after completion
        );
      });

      if (futureInstance) {
        allUndoRecords.push({
          type: "delete",
          task: structuredClone(futureInstance),
        });
        await ctx.dbOps.delete(futureInstance.uuid);
        deletedFutureCount++;
      }
    }
  }

  // Check for checklist parent reversion
  let revertedParentCount = 0;
  for (const parentUuid of affectedParentUuids) {
    const undoRecord = await maybeRevertParent(parentUuid, ctx.dbOps);
    if (undoRecord) {
      allUndoRecords.push(undoRecord);
      revertedParentCount++;
    }
  }

  if (allUndoRecords.length === 0) {
    return ctx.print('<span class="msg-info">No tasks to undone.</span>');
  }

  pushUndo({ type: "compound", records: allUndoRecords });

  let msg = `<span class="msg-success">Undone ${uuids.length} task(s).`;
  if (deletedFutureCount > 0) {
    msg += ` Deleted ${deletedFutureCount} future instance(s).`;
  }
  if (revertedParentCount > 0) {
    msg += ` Reverted ${revertedParentCount} parent(s).`;
  }
  msg += `</span>`;
  ctx.print(msg);
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleDelete = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];
  const affectedParentUuids = new Set();

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    // Track parent if this is a checklist member
    if (isChecklistMember(task)) {
      const parentUuid = getChecklistParentUuid(task);
      if (parentUuid) affectedParentUuids.add(parentUuid);
    }

    allUndoRecords.push({ type: "update", task: structuredClone(task) });
    await ctx.dbOps.update({
      ...task,
      status: "deleted",
      deletedAt: Date.now(),
    });
  }

  // Check for checklist parent auto-completion
  let autoCompletedCount = 0;
  for (const parentUuid of affectedParentUuids) {
    const undoRecord = await maybeAutoCompleteParent(parentUuid, ctx.dbOps);
    if (undoRecord) {
      allUndoRecords.push(undoRecord);
      autoCompletedCount++;
    }
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  if (autoCompletedCount > 0) {
    ctx.print(
      `<span class="msg-success">Deleted. Checklist auto-completed.</span>`,
    );
  } else if (uuids.length > 1) {
    ctx.print(
      `<span class="msg-success">Deleted ${uuids.length} tasks.</span>`,
    );
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleSkip = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  // Parse until: or u: parameter from remaining args
  const tokens = ctx.targetId ? ctx.args : ctx.args.slice(1);
  let untilDate = null;
  for (const token of tokens) {
    if (token.startsWith("until:") || token.startsWith("u:")) {
      const dateStr = token.split(":")[1];
      untilDate = parseDate(dateStr);
      if (!untilDate) {
        return ctx.print('<span class="msg-error">Invalid until date.</span>');
      }
      break;
    }
  }

  const allUndoRecords = [];
  let recurringCount = 0;
  let cancelledCount = 0;
  let totalSkipped = 0; // Track total occurrences skipped when using until:
  const affectedParentUuids = new Set();

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    // Track parent if this is a checklist member
    if (isChecklistMember(task)) {
      const parentUuid = getChecklistParentUuid(task);
      if (parentUuid) affectedParentUuids.add(parentUuid);
    }

    allUndoRecords.push({ type: "update", task: structuredClone(task) });

    // Mark as skipped (works as "cancelled" for non-recurring)
    task.status = "skipped";
    task.end = Date.now();
    await ctx.dbOps.update(task);

    // For recurring tasks, create next occurrence
    if (task.recur && task.due) {
      let recurrence = calculateNextRecurrence(task);
      if (recurrence) {
        let skippedOccurrences = 1; // Count the current task being skipped

        // If until: is specified, skip ahead to first occurrence >= untilDate
        if (untilDate) {
          let currentTask = { ...task, due: recurrence.nextDue };
          while (recurrence.nextDue < untilDate) {
            skippedOccurrences++;
            recurrence = calculateNextRecurrence({
              ...currentTask,
              due: recurrence.nextDue,
              wait: recurrence.nextWait || null,
              waitTime: recurrence.waitTime || currentTask.waitTime || null,
              sched: recurrence.nextSched || null,
            });
            if (!recurrence) break; // Safety check
          }
        }

        if (recurrence) {
          const newUuid = generateUUID();
          const newTask = {
            ...task,
            uuid: newUuid,
            status: "pending",
            due: recurrence.nextDue,
            wait: recurrence.nextWait || null,
            waitTime: recurrence.waitTime || task.waitTime || null,
            sched: recurrence.nextSched || null,
            entry: uniqueTimestamp(),
            annotations: [],
          };
          delete newTask.depends;
          delete newTask.end;
          delete newTask.start;
          await ctx.dbOps.add(newTask);
          allUndoRecords.push({ type: "create", uuid: newUuid });
          recurringCount++;
          if (untilDate) totalSkipped += skippedOccurrences;
        }
      }
    } else {
      cancelledCount++;
    }
  }

  // Check for checklist parent auto-completion
  let autoCompletedCount = 0;
  for (const parentUuid of affectedParentUuids) {
    const undoRecord = await maybeAutoCompleteParent(parentUuid, ctx.dbOps);
    if (undoRecord) {
      allUndoRecords.push(undoRecord);
      autoCompletedCount++;
    }
  }

  pushUndo({ type: "compound", records: allUndoRecords });

  if (autoCompletedCount > 0) {
    ctx.print(
      `<span class="msg-success">Skipped. Checklist auto-completed.</span>`,
    );
  } else {
    const total = recurringCount + cancelledCount;
    if (total === 1 && recurringCount === 1) {
      if (untilDate && totalSkipped > 1) {
        // Find the create record (last record will be the create)
        const createRecord = allUndoRecords.find((r) => r.type === "create");
        const nextTask = await ctx.dbOps.get(createRecord?.uuid);
        const nextDueStr = formatDate(nextTask?.due);
        ctx.print(
          `<span class="msg-success">Skipped ${totalSkipped} occurrence${totalSkipped > 1 ? "s" : ""}. Next: ${nextDueStr}</span>`,
        );
      } else {
        ctx.print(
          '<span class="msg-success">Skipped. Next occurrence created.</span>',
        );
      }
    } else if (total === 1 && cancelledCount === 1) {
      ctx.print('<span class="msg-success">Cancelled.</span>');
    } else {
      let msg = [];
      if (recurringCount > 0) msg.push(`${recurringCount} skipped`);
      if (cancelledCount > 0) msg.push(`${cancelledCount} cancelled`);
      if (untilDate && totalSkipped > 0) {
        ctx.print(
          `<span class="msg-success">${msg.join(", ")}. Total occurrences skipped: ${totalSkipped}</span>`,
        );
      } else {
        ctx.print(`<span class="msg-success">${msg.join(", ")}.</span>`);
      }
    }
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};
