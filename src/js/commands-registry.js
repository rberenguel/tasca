// Command registry - maps command names (including aliases) to handlers
// All handlers receive a ctx object with shared dependencies

import { handleClear, handleAbout } from "./commands-misc.js"
import { handleUndo, handleStart, handleDone, handleDelete, handleSkip } from "./commands-state.js"
import { handleAdd, handleModify, handleModifyProject, handleEdit, handleAnnotate, handleAnnotateProject, handleInfo, handleInfoProject } from "./commands-tasks.js"
import { handleExport, handleImport, handleLink, handleLoad, handleSave, handleUnlink } from "./commands-data.js"
import { handleHelp, handleCopy, handlePaste, handleIcon, handleContext } from "./commands-misc.js"
import { handleNext, handleChain, handleProjects, handleCalendar } from "./commands-views.js"
import { handleReport } from "./commands-reports.js"
import { runList } from "./list.js"

// Command registry
export const commands = {
  // Task mutations
  add: handleAdd,
  a: handleAdd,
  log: handleAdd,

  // Task state changes
  done: handleDone,
  delete: handleDelete,
  rm: handleDelete,
  start: handleStart,
  st: handleStart,
  skip: handleSkip,
  undo: handleUndo,

  // Task editing
  modify: handleModify,
  mod: handleModify,
  edit: handleEdit,
  ed: handleEdit,
  annotate: handleAnnotate,
  info: handleInfo,
  i: handleInfo,

  // Views
  list: async (ctx) => {
    await runList(ctx.args)
  },
  ls: async (ctx) => {
    await runList(ctx.args)
  },
  l: async (ctx) => {
    await runList(ctx.args)
  },
  next: async (ctx) => {
    await handleNext(ctx.args, ctx.print)
  },
  chain: async (ctx) => {
    await handleChain(ctx.args, ctx.print)
  },
  dependencies: async (ctx) => {
    await handleChain(ctx.args, ctx.print)
  },
  tree: async (ctx) => {
    await handleChain(ctx.args, ctx.print)
  },
  calendar: async (ctx) => {
    await handleCalendar(ctx.args, ctx.print)
  },
  cal: async (ctx) => {
    await handleCalendar(ctx.args, ctx.print)
  },
  projects: async (ctx) => {
    await handleProjects(ctx.print)
  },
  proj: async (ctx) => {
    await handleProjects(ctx.print)
  },

  // Reports
  report: async (ctx) => {
    const subCmd = ctx.args[0]?.toLowerCase()
    const subArgs = ctx.args.slice(1)
    const projects = await ctx.dbOps.getAllProjects()
    await handleReport(subCmd, subArgs, ctx.print, ctx.dbOps, projects)
  },
  rep: async (ctx) => {
    const subCmd = ctx.args[0]?.toLowerCase()
    const subArgs = ctx.args.slice(1)
    const projects = await ctx.dbOps.getAllProjects()
    await handleReport(subCmd, subArgs, ctx.print, ctx.dbOps, projects)
  },

  // Data operations
  export: handleExport,
  exp: handleExport,
  import: handleImport,
  imp: handleImport,
  link: handleLink,
  load: handleLoad,
  save: handleSave,
  unlink: handleUnlink,

  // Misc
  context: handleContext,
  ctx: handleContext,
  c: handleContext,
  icon: handleIcon,
  copy: handleCopy,
  cp: handleCopy,
  paste: handlePaste,
  help: handleHelp,
  about: handleAbout,
  clear: handleClear,
}

// Special handlers that need project detection
export const projectCommands = {
  modify: handleModifyProject,
  mod: handleModifyProject,
  annotate: handleAnnotateProject,
  info: handleInfoProject,
  i: handleInfoProject,
}

// Check if args indicate a project command (pro:X as first arg)
export const isProjectCommand = (args) => {
  return args[0] && (
    args[0].startsWith("pro:") ||
    args[0].startsWith("proj:") ||
    args[0].startsWith("project:")
  )
}
