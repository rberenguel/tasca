// State change handlers: undo, start, done, delete, skip

import {
  generateUUID,
  calculateNextRecurrence,
  uniqueTimestamp,
} from "./utils.js";
import { pushUndo, popUndo } from "./undo.js";
import {
  isChecklistMember,
  getChecklistParentUuid,
  maybeAutoCompleteParent,
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
  const idArg = ctx.targetId || ctx.args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let uuid;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const all = await ctx.dbOps.getByStatus("pending");
    const match = all.find((t) => t.target === name);
    uuid = match?.uuid;
  } else {
    const id = parseInt(idArg);
    uuid = id ? ctx.displayMapRef.value[id - 1] : null;
  }

  if (!uuid) return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(uuid);
  if (task) {
    pushUndo({ type: "update", task: structuredClone(task) });
    task.start = Date.now();
    await ctx.dbOps.update(task);
    ctx.print(`<span class="msg-success">Started task.</span>`);
    ctx.markDirty();
    await ctx.runListRefresh();
  }
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

    allUndoRecords.push({ type: "delete", task: structuredClone(task) });
    await ctx.dbOps.delete(uuid);
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

  const allUndoRecords = [];
  let recurringCount = 0;
  let cancelledCount = 0;
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
      ctx.print(
        '<span class="msg-success">Skipped. Next occurrence created.</span>',
      );
    } else if (total === 1 && cancelledCount === 1) {
      ctx.print('<span class="msg-success">Cancelled.</span>');
    } else {
      let msg = [];
      if (recurringCount > 0) msg.push(`${recurringCount} skipped`);
      if (cancelledCount > 0) msg.push(`${cancelledCount} cancelled`);
      ctx.print(`<span class="msg-success">${msg.join(", ")}.</span>`);
    }
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};
