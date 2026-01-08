// State change handlers: undo, start, done, delete, skip

import {
  generateUUID,
  calculateNextRecurrence,
  uniqueTimestamp,
} from "./utils.js";
import { pushUndo, popUndo } from "./undo.js";

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
  const id = ctx.targetId || parseInt(ctx.args[0]);
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
  if (task) {
    pushUndo({ type: "update", task: structuredClone(task) });
    task.start = Date.now();
    await ctx.dbOps.update(task);
    ctx.print(`<span class="msg-success">Started task ${id}.</span>`);
    ctx.markDirty();
    await ctx.runListRefresh();
  }
};

export const handleDone = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const ids = parseIds(idArg, ctx.displayMapRef);
  if (ids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];
  let recurringCount = 0;

  for (const id of ids) {
    const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
    if (!task) continue;

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
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  if (recurringCount > 0) {
    ctx.print(
      `<span class="msg-success">Completed ${ids.length} task(s). ${recurringCount} recurring task(s) created.</span>`,
    );
  } else if (ids.length > 1) {
    ctx.print(
      `<span class="msg-success">Completed ${ids.length} tasks.</span>`,
    );
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleDelete = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const ids = parseIds(idArg, ctx.displayMapRef);
  if (ids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];

  // Process in reverse order to maintain correct indices during deletion
  for (const id of [...ids].reverse()) {
    const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
    if (!task) continue;
    allUndoRecords.push({ type: "delete", task: structuredClone(task) });
    await ctx.dbOps.delete(ctx.displayMapRef.value[id - 1]);
  }

  pushUndo({ type: "compound", records: allUndoRecords });
  if (ids.length > 1) {
    ctx.print(`<span class="msg-success">Deleted ${ids.length} tasks.</span>`);
  }
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleSkip = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  const ids = parseIds(idArg, ctx.displayMapRef);
  if (ids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  const allUndoRecords = [];
  let recurringCount = 0;
  let cancelledCount = 0;

  for (const id of ids) {
    const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
    if (!task) continue;

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

  pushUndo({ type: "compound", records: allUndoRecords });

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
  ctx.markDirty();
  await ctx.runListRefresh();
};
