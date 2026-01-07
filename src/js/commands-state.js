// State change handlers: undo, start, done, delete, skip

import { generateUUID, calculateNextRecurrence, uniqueTimestamp } from "./utils.js"
import { pushUndo, popUndo } from "./undo.js"

// Apply an undo record
const applyUndo = async (record, dbOps) => {
  if (record.type === "update") {
    await dbOps.update(record.task, { touch: false })
  } else if (record.type === "create") {
    await dbOps.delete(record.uuid)
  } else if (record.type === "delete") {
    await dbOps.add(record.task, { touch: false })
  } else if (record.type === "compound") {
    for (const r of [...record.records].reverse()) {
      await applyUndo(r, dbOps)
    }
  }
}

export const handleUndo = async (ctx) => {
  const record = popUndo()
  if (!record)
    return ctx.print('<span class="msg-error">Nothing to undo.</span>')
  await applyUndo(record, ctx.dbOps)
  ctx.print('<span class="msg-success">Undone.</span>')
  ctx.markDirty()
  await ctx.runListRefresh()
}

export const handleStart = async (ctx) => {
  const id = ctx.targetId || parseInt(ctx.args[0])
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>')
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1])
  if (task) {
    pushUndo({ type: "update", task: structuredClone(task) })
    task.start = Date.now()
    await ctx.dbOps.update(task)
    ctx.print(`<span class="msg-success">Started task ${id}.</span>`)
    ctx.markDirty()
    await ctx.runListRefresh()
  }
}

export const handleDone = async (ctx) => {
  const id = ctx.targetId || parseInt(ctx.args[0])
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>')
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1])
  if (task) {
    const undoRecords = [{ type: "update", task: structuredClone(task) }]
    task.status = "completed"
    task.end = Date.now()
    await ctx.dbOps.update(task)
    const recurrence = calculateNextRecurrence(task)
    if (recurrence) {
      const newUuid = generateUUID()
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
      }
      delete newTask.depends
      delete newTask.end
      delete newTask.start
      await ctx.dbOps.add(newTask)
      undoRecords.push({ type: "create", uuid: newUuid })
      ctx.print(`<span class="msg-success">Recurring task created.</span>`)
    }
    pushUndo({ type: "compound", records: undoRecords })
    ctx.markDirty()
    await ctx.runListRefresh()
  }
}

export const handleDelete = async (ctx) => {
  const id = ctx.targetId || parseInt(ctx.args[0])
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>')
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1])
  pushUndo({ type: "delete", task: structuredClone(task) })
  await ctx.dbOps.delete(ctx.displayMapRef.value[id - 1])
  ctx.markDirty()
  await ctx.runListRefresh()
}

export const handleSkip = async (ctx) => {
  const id = ctx.targetId || parseInt(ctx.args[0])
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>')
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1])
  if (!task) return ctx.print('<span class="msg-error">Task not found.</span>')
  if (!task.recur || !task.due)
    return ctx.print(
      '<span class="msg-error">Task is not recurring (needs both due: and recur:).</span>',
    )

  const recurrence = calculateNextRecurrence(task)
  if (!recurrence)
    return ctx.print(
      '<span class="msg-error">Could not calculate next recurrence.</span>',
    )

  const undoRecords = [{ type: "update", task: structuredClone(task) }]

  // Mark current as skipped
  task.status = "skipped"
  task.end = Date.now()
  await ctx.dbOps.update(task)

  // Create next occurrence
  const newUuid = generateUUID()
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
  }
  delete newTask.depends
  delete newTask.end
  delete newTask.start
  await ctx.dbOps.add(newTask)
  undoRecords.push({ type: "create", uuid: newUuid })

  pushUndo({ type: "compound", records: undoRecords })
  ctx.print(
    '<span class="msg-success">Skipped. Next occurrence created.</span>',
  )
  ctx.markDirty()
  await ctx.runListRefresh()
}
