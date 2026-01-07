// Data handlers: export, import, link, load, save, unlink

import { matchesProject, hasVirtualTag, expandVirtualTagShorthand } from "./logic.js"
import { markClean } from "./state.js"
import { updateCache } from "./state.js"

export const handleExport = async (ctx) => {
  await ctx.dbOps.cleanupOrphanProjects()
  const all = await ctx.dbOps.getAll()
  const projectsMeta = await ctx.dbOps.getAllProjects()
  let filtered = all

  if (ctx.args.length > 0) {
    let fProj = null,
      fTags = [],
      search = []
    for (let token of ctx.args) {
      if (
        token.startsWith("p:") ||
        token.startsWith("pro:") ||
        token.startsWith("proj:") ||
        token.startsWith("project:")
      )
        fProj = token.split(":")[1]
      else if (token.startsWith("!")) {
        const expanded = expandVirtualTagShorthand(token)
        const tag = expanded.substring(1).toUpperCase()
        if (tag !== "ALL") fTags.push(expanded)
      } else search.push(token.toLowerCase())
    }
    if (fProj)
      filtered = filtered.filter((t) => matchesProject(t.project, fProj))
    if (fTags.length) {
      filtered = filtered.filter((t) =>
        fTags.every((ft) => {
          const tag = ft.substring(1).toLowerCase()
          if (t.tags && t.tags.some((tt) => tt.toLowerCase() === tag))
            return true
          if (hasVirtualTag(t, ft, all, projectsMeta)) return true
          return false
        }),
      )
    }
    if (search.length)
      filtered = filtered.filter((t) =>
        search.every((s) => t.description.toLowerCase().includes(s)),
      )
  }

  const exportData = {
    tasks: filtered,
    projects: projectsMeta,
    savedAt: Date.now(),
  }
  const dataStr = JSON.stringify(exportData, null, 2)
  const blob = new Blob([dataStr], { type: "application/json" })
  const filename =
    ctx.args.length > 0
      ? `tasca_${ctx.args.join("_").replace(/[^a-zA-Z0-9]/g, "")}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`
      : `tasca_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "JSON files",
            accept: { "application/json": [".json"] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(dataStr)
      await writable.close()
      ctx.print(
        `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks to ${handle.name}.</span></div>`,
        false,
      )
      if (ctx.args.length === 0) {
        markClean()
        await ctx.dbOps.setSetting("lastSave", Date.now())
      }
      return
    } catch (e) {
      if (e.name === "AbortError") return
    }
  }

  const file = new File([blob], filename, { type: "application/json" })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      ctx.print(
        `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks.</span></div>`,
        false,
      )
      if (ctx.args.length === 0) {
        markClean()
        await ctx.dbOps.setSetting("lastSave", Date.now())
      }
      return
    } catch (e) {
      if (e.name === "AbortError") return
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ctx.print(
    `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks.</span></div>`,
    false,
  )
  if (ctx.args.length === 0) {
    markClean()
    await ctx.dbOps.setSetting("lastSave", Date.now())
  }
}

export const handleImport = async (ctx) => {
  document.getElementById("import-picker").click()
}

export const handleLink = async (ctx) => {
  if (!window.showOpenFilePicker) {
    return ctx.print(
      '<span class="msg-error">File System Access API not supported in this browser.</span>',
    )
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: "JSON files",
          accept: { "application/json": [".json"] },
        },
      ],
    })
    await ctx.dbOps.setSetting("syncFileHandle", handle)
    ctx.print(
      `<span class="msg-success">Linked to ${handle.name}. Use 'load' to import, 'save' to export.</span>`,
    )
  } catch (e) {
    if (e.name !== "AbortError") {
      ctx.print(`<span class="msg-error">Error: ${e.message}</span>`)
    }
  }
}

export const handleLoad = async (ctx) => {
  const handle = await ctx.dbOps.getSetting("syncFileHandle")
  if (!handle) {
    return ctx.print(
      "<span class=\"msg-error\">No file linked. Use 'link' first.</span>",
    )
  }
  try {
    const options = { mode: "read" }
    if ((await handle.queryPermission(options)) !== "granted") {
      if ((await handle.requestPermission(options)) !== "granted") {
        return ctx.print(
          "<span class=\"msg-error\">Permission denied. Try 'link' again.</span>",
        )
      }
    }
    let imported = 0
    let importedProjects = 0
    const file = await handle.getFile()
    const text = await file.text()
    if (text.trim()) {
      const data = JSON.parse(text)
      // Handle both old format (array) and new format (object with tasks/projects)
      const tasks = Array.isArray(data) ? data : data.tasks || []
      const projects = Array.isArray(data) ? [] : data.projects || []
      const savedAt = Array.isArray(data) ? null : data.savedAt || null
      for (const t of tasks) {
        if (t.uuid) {
          await ctx.dbOps.update(t, { touch: false })
          imported++
        }
      }
      for (const p of projects) {
        if (p.name) {
          await ctx.dbOps.updateProject(p, { touch: false })
          importedProjects++
        }
      }
      if (savedAt) {
        await ctx.dbOps.setSetting("lastSave", savedAt)
      }
    }
    const projMsg = importedProjects
      ? ` and ${importedProjects} projects`
      : ""
    ctx.print(
      `<span class="msg-success">Loaded ${imported} tasks${projMsg} from ${handle.name}.</span>`,
    )
    markClean()
    if (imported > 0) {
      const all = await ctx.dbOps.getAll()
      updateCache(all)
      await ctx.execute("next")
    }
  } catch (e) {
    ctx.print(`<span class="msg-error">Load failed: ${e.message}</span>`)
  }
}

export const handleSave = async (ctx) => {
  const handle = await ctx.dbOps.getSetting("syncFileHandle")
  if (!handle) {
    return ctx.print(
      "<span class=\"msg-error\">No file linked. Use 'link' first.</span>",
    )
  }
  try {
    const options = { mode: "readwrite" }
    if ((await handle.queryPermission(options)) !== "granted") {
      if ((await handle.requestPermission(options)) !== "granted") {
        return ctx.print(
          "<span class=\"msg-error\">Permission denied. Try 'link' again.</span>",
        )
      }
    }
    await ctx.dbOps.cleanupOrphanProjects()
    const all = await ctx.dbOps.getAll()
    const projects = await ctx.dbOps.getAllProjects()
    const saveData = { tasks: all, projects, savedAt: Date.now() }
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(saveData, null, 2))
    await writable.close()
    ctx.print(
      `<div class="msg-standalone"><span class="msg-success">Saved ${all.length} tasks to ${handle.name}.</span></div>`,
      false,
    )
    markClean()
    await ctx.dbOps.setSetting("lastSave", Date.now())
  } catch (e) {
    ctx.print(`<span class="msg-error">Save failed: ${e.message}</span>`)
  }
}

export const handleUnlink = async (ctx) => {
  const handle = await ctx.dbOps.getSetting("syncFileHandle")
  if (!handle) {
    return ctx.print('<span class="msg-error">No file linked.</span>')
  }
  await ctx.dbOps.deleteSetting("syncFileHandle")
  ctx.print('<span class="msg-success">Unlinked sync file.</span>')
}
