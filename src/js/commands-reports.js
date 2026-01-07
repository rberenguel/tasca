// Report command handlers extracted from commands.js

import { parseRelativeTime } from "./utils.js"
import { matchesProject, hasVirtualTag, expandVirtualTagShorthand } from "./logic.js"
import { formatProject, formatInlineCode } from "./ui.js"
import { displayMapRef } from "./state.js"
import { getContext } from "./context.js"

// Helper to convert icon name to Phosphor class
const iconClass = (name) =>
  name?.startsWith("ph-") ? name : `ph-light ph-${name}`

// Simple filter function builder for context strings
const buildContextFilter = (ctx) => {
  if (!ctx) return () => true

  const tokens = ctx.split(/\s+/)
  let fProj = null
  const fTags = []
  const search = []

  for (const token of tokens) {
    if (token.startsWith("p:") || token.startsWith("pro:") ||
        token.startsWith("proj:") || token.startsWith("project:")) {
      fProj = token.split(":")[1]
    } else if (token.startsWith("!")) {
      fTags.push(expandVirtualTagShorthand(token))
    } else {
      search.push(token.toLowerCase())
    }
  }

  return (t) => {
    if (fProj && !matchesProject(t.project, fProj)) return false
    for (const tag of fTags) {
      if (!hasVirtualTag(t, tag) && !t.tags?.includes(tag.substring(1))) return false
    }
    for (const term of search) {
      if (!t.description?.toLowerCase().includes(term)) return false
    }
    return true
  }
}

export const handleReport = async (subCmd, subArgs, print, dbOps, projects) => {
  if (!subCmd || subCmd === "help") {
    print(`<div class="msg-standalone"><b>Report Commands:</b>
  <span class="cmd">report stale</span> - Project staleness (days since last activity)
  <span class="cmd">report rot [N]</span> - Oldest pending tasks (default: 10)
  <span class="cmd">report done [period] [by:project|tag]</span> - Completed tasks grouped (default: 1w, by:project)
  <span class="cmd">report cfd [pro:X] [period] [by:project|tag]</span> - Cumulative flow diagram (done vs pending over time)
  <span class="cmd">report cycle [pro:X] [period] [by:project|tag]</span> - Cycle time distribution (entry to done latency)
  <span class="cmd">report forecast</span> - Backlog completion prediction based on velocity
  <span class="cmd">report churn [period]</span> - Project context switching metric (default: 1w)
  <span class="cmd">report audit [period]</span> - Recurring task skip rate analysis (default: 4w)</div>`, false)
    return true
  }

  if (subCmd === "stale") {
    const all = await dbOps.getAll()

    // Get reference project names to exclude
    const refProjects = new Set(
      projects
        .filter((p) =>
          p.tags?.some((tag) =>
            ["reference", "ref"].includes(tag.toLowerCase()),
          ),
        )
        .map((p) => p.name),
    )

    // Build project activity map
    const projectActivity = {}
    for (const t of all) {
      if (!t.project || refProjects.has(t.project)) continue
      const current = projectActivity[t.project] || {
        lastActivity: 0,
        activityType: null,
      }

      // Check entry date (task added)
      if (t.entry && t.entry > current.lastActivity) {
        current.lastActivity = t.entry
        current.activityType = "added"
      }
      // Check end date (task completed)
      if (t.end && t.end > current.lastActivity) {
        current.lastActivity = t.end
        current.activityType = "completed"
      }
      // Check start date (task started)
      if (t.start && t.start > current.lastActivity) {
        current.lastActivity = t.start
        current.activityType = "started"
      }
      projectActivity[t.project] = current
    }

    // Sort by staleness (oldest first)
    const sorted = Object.entries(projectActivity)
      .map(([name, data]) => ({
        name,
        lastActivity: data.lastActivity,
        activityType: data.activityType,
        daysSince: Math.floor((Date.now() - data.lastActivity) / 86400000),
      }))
      .sort((a, b) => a.lastActivity - b.lastActivity)

    if (sorted.length === 0) {
      print(
        '<span class="msg-warning">No projects with activity found.</span>',
      )
    } else {
      let html = '<div class="table-wrapper"><table><thead><tr>'
      html += "<th>Days</th><th>Project</th><th>Last Activity</th>"
      html += "</tr></thead><tbody>"

      for (const p of sorted) {
        const pMeta = projects.find((pm) => pm.name === p.name)
        const icon = pMeta?.icon
          ? `<i class="${iconClass(pMeta.icon)}" style="margin-right:4px"></i>`
          : ""
        const dateStr = new Date(p.lastActivity).toLocaleDateString()
        const staleClass =
          p.daysSince > 30
            ? 'style="color:var(--red)"'
            : p.daysSince > 14
              ? 'style="color:var(--yellow)"'
              : ""
        html += `<tr>`
        html += `<td ${staleClass}>${p.daysSince}d</td>`
        html += `<td>${icon}${p.name}</td>`
        html += `<td>${p.activityType} ${dateStr}</td>`
        html += `</tr>`
      }
      html += "</tbody></table></div>"
      print(html, false)
    }
    return true
  }

  if (subCmd === "rot") {
    const limit = parseInt(subArgs[0]) || 10
    const all = await dbOps.getAll()

    // Get pending tasks sorted by age (oldest first)

    const refProjects = new Set(
      projects
        .filter((p) =>
          p.tags?.some((t) =>
            ["reference", "ref"].includes(t.toLowerCase()),
          ),
        )
        .map((p) => p.name),
    )

    // Get pending tasks sorted by age (oldest first), excluding reference projects
    const pending = all
      .filter(
        (t) =>
          t.status === "pending" &&
          (!t.project || !refProjects.has(t.project)),
      )
      .map((t) => ({
        ...t,
        ageDays: Math.floor((Date.now() - t.entry) / 86400000),
      }))
      .sort((a, b) => a.entry - b.entry)
      .slice(0, limit)

    if (pending.length === 0) {
      print('<span class="msg-success">No pending tasks!</span>')
    } else {
      // Update display map for task references
      displayMapRef.value = pending.map((t) => t.uuid)

      // Age distribution
      const dist = { week: 0, month: 0, quarter: 0, older: 0 }
      for (const t of all.filter((t) => t.status === "pending")) {
        const age = Math.floor((Date.now() - t.entry) / 86400000)
        if (age < 7) dist.week++
        else if (age < 30) dist.month++
        else if (age < 90) dist.quarter++
        else dist.older++
      }
      let html = `<div style="margin-bottom:8px;color:var(--base01)">Age: <span style="color:var(--green)">&lt;1w:${dist.week}</span> | <span style="color:var(--cyan)">1-4w:${dist.month}</span> | <span style="color:var(--yellow)">1-3m:${dist.quarter}</span> | <span style="color:var(--red)">3m+:${dist.older}</span></div>`

      html += '<div class="table-wrapper"><table><thead><tr>'
      html += '<th style="width:25px">ID</th><th>Description</th>'
      html += "</tr></thead><tbody>"

      let idx = 1
      for (const t of pending) {
        const proj = t.project ? formatProject(t.project) : ""
        const ageColor =
          t.ageDays > 90
            ? "var(--red)"
            : t.ageDays > 30
              ? "var(--yellow)"
              : "var(--cyan)"
        html += `<tr>`
        html += `<td>${idx++}</td>`
        html += `<td>${formatInlineCode(t.description)} ${proj} <span style="color:${ageColor}">${t.ageDays}d</span></td>`
        html += `</tr>`
      }
      html += "</tbody></table></div>"
      print(html, false)
    }
    return true
  }

  if (subCmd === "done") {
    // Parse options: period (1w, 2w, etc.) and grouping (by:tag or by:project)
    let periodArg = "1w"
    let groupBy = "project"
    for (const arg of subArgs) {
      if (arg.startsWith("by:")) {
        const val = arg.split(":")[1].toLowerCase()
        if (["p", "pro", "proj", "project"].includes(val))
          groupBy = "project"
        else if (["t", "tag"].includes(val)) groupBy = "tag"
      } else {
        periodArg = arg
      }
    }

    const periodMs = parseRelativeTime(periodArg)
    const cutoff = periodMs || Date.now() - 7 * 86400000

    const all = await dbOps.getAll()

    // Get completed tasks in period
    const completed = all
      .filter((t) => t.status === "completed" && t.end && t.end >= cutoff)
      .sort((a, b) => b.end - a.end)

    if (completed.length === 0) {
      print(
        `<span class="msg-warning">No tasks completed in the last ${periodArg}.</span>`,
      )
    } else if (groupBy === "tag") {
      // Group by tag (tasks with multiple tags appear in each)
      const byTag = {}
      for (const t of completed) {
        const tags = t.tags?.length > 0 ? t.tags : ["(no tag)"]
        for (const tag of tags) {
          if (!byTag[tag]) byTag[tag] = []
          byTag[tag].push(t)
        }
      }

      // Sort tags by task count descending
      const sortedTags = Object.entries(byTag).sort(
        (a, b) => b[1].length - a[1].length,
      )

      let html = `<div style="margin-bottom:8px;color:var(--base01)">Completed in last ${periodArg}: <span style="color:var(--green)">${completed.length} tasks</span> across <span style="color:var(--cyan)">${sortedTags.length} tags</span></div>`

      for (const [tagName, tasks] of sortedTags) {
        html += `<div style="color:var(--magenta); margin-top:8px; border-bottom:1px solid var(--base01)">!${tagName} (${tasks.length})</div>`

        for (const t of tasks) {
          const dateStr = new Date(t.end).toLocaleDateString()
          html += `<div style="margin-left:12px"><span style="color:var(--green)">✓</span> ${formatInlineCode(t.description)} <span style="color:var(--base01)">${dateStr}</span></div>`
        }
      }
      print(html, false)
    } else {
      // Group by project (default)
      const byProject = {}
      for (const t of completed) {
        const proj = t.project || "(no project)"
        if (!byProject[proj]) byProject[proj] = []
        byProject[proj].push(t)
      }

      // Sort projects by task count descending
      const sortedProjects = Object.entries(byProject).sort(
        (a, b) => b[1].length - a[1].length,
      )

      let html = `<div style="margin-bottom:8px;color:var(--base01)">Completed in last ${periodArg}: <span style="color:var(--green)">${completed.length} tasks</span> across <span style="color:var(--cyan)">${sortedProjects.length} projects</span></div>`

      for (const [projName, tasks] of sortedProjects) {
        const pMeta = projects.find((p) => p.name === projName)
        const icon = pMeta?.icon
          ? `<i class="${iconClass(pMeta.icon)}" style="margin-right:4px"></i>`
          : ""
        html += `<div style="color:var(--yellow); margin-top:8px; border-bottom:1px solid var(--base01)">${icon}${projName} (${tasks.length})</div>`

        for (const t of tasks) {
          const dateStr = new Date(t.end).toLocaleDateString()
          html += `<div style="margin-left:12px"><span style="color:var(--green)">✓</span> ${formatInlineCode(t.description)} <span style="color:var(--base01)">${dateStr}</span></div>`
        }
      }
      print(html, false)
    }
    return true
  }

  if (subCmd === "cfd") {
    // Cumulative Flow Diagram
    // Parse project filter, grouping, and period
    let fProj = null
    let groupBy = null
    let periodArg = null
    for (const arg of subArgs) {
      if (
        arg.startsWith("p:") ||
        arg.startsWith("pro:") ||
        arg.startsWith("proj:") ||
        arg.startsWith("project:")
      )
        fProj = arg.split(":")[1]
      else if (arg.startsWith("by:")) {
        const val = arg.split(":")[1].toLowerCase()
        if (["p", "pro", "proj", "project"].includes(val))
          groupBy = "project"
        else if (["t", "tag"].includes(val)) groupBy = "tag"
      } else if (/^\d+[dwmy]$/.test(arg)) periodArg = arg
    }

    const all = await dbOps.getAll()
    let tasks = all
    if (fProj)
      tasks = tasks.filter((t) => matchesProject(t.project, fProj))

    // Period filter - include tasks that existed during the period
    const periodStart = periodArg ? parseRelativeTime(periodArg) : null
    if (periodStart) {
      tasks = tasks.filter(
        (t) => t.entry <= Date.now() && (!t.end || t.end >= periodStart),
      )
    }

    if (tasks.length === 0) {
      print('<span class="msg-info">No tasks found.</span>')
      return true
    }

    if (groupBy === "project" || groupBy === "tag") {
      // Snapshot comparison by project or tag
      const byGroup = {}
      for (const t of tasks) {
        if (groupBy === "project") {
          const proj = t.project || "(no project)"
          if (!byGroup[proj]) byGroup[proj] = { pending: 0, done: 0 }
          if (t.status === "pending") byGroup[proj].pending++
          else if (t.status === "completed") byGroup[proj].done++
        } else {
          const tags = t.tags?.length > 0 ? t.tags : ["(no tag)"]
          for (const tag of tags) {
            if (!byGroup[tag]) byGroup[tag] = { pending: 0, done: 0 }
            if (t.status === "pending") byGroup[tag].pending++
            else if (t.status === "completed") byGroup[tag].done++
          }
        }
      }

      // Identify reference projects
      const refProjects = new Set(
        projects
          .filter((p) =>
            p.tags?.some((t) =>
              ["reference", "ref"].includes(t.toLowerCase()),
            ),
          )
          .map((p) => p.name),
      )

      const groupData = Object.entries(byGroup)
        .map(([name, data]) => ({
          name,
          pending: data.pending,
          done: data.done,
          total: data.pending + data.done,
          rate: data.done / (data.pending + data.done) || 0,
          isRef: groupBy === "project" && refProjects.has(name),
        }))
        .filter((g) => g.total > 0)
        .sort((a, b) => {
          // Reference projects go to the end
          if (a.isRef !== b.isRef) return a.isRef ? 1 : -1
          return b.pending - a.pending // most backlog first
        })

      const maxTotal = Math.max(...groupData.map((g) => g.total), 1)
      const barWidth = 150

      const label = groupBy === "project" ? "Project" : "Tag"
      const periodLabel = periodArg ? ` — last ${periodArg}` : ""
      let html = `<div class="msg-standalone" style="margin-bottom:8px;color:var(--base01)">Flow by ${label}${fProj ? ` (${fProj})` : ""}${periodLabel} — ${tasks.length} tasks</div>`
      html += `<div style="font-size:0.85em;margin-bottom:4px"><span style="color:var(--cyan)">■</span> done <span style="color:var(--orange)">■</span> pending</div>`
      html += '<div class="table-wrapper"><table><thead><tr>'
      html += `<th>${label}</th><th></th><th>Done</th><th>Ratio</th>`
      html += "</tr></thead><tbody>"

      for (const g of groupData) {
        let icon = ""
        let displayName = g.name
        if (groupBy === "project") {
          const pMeta = projects.find((pm) => pm.name === g.name)
          icon = pMeta?.icon
            ? `<i class="${iconClass(pMeta.icon)}" style="margin-right:4px"></i>`
            : ""
        } else {
          displayName = `!${g.name}`
        }
        const doneW = Math.round((g.done / maxTotal) * barWidth)
        const pendingW = Math.round((g.pending / maxTotal) * barWidth)
        const ratePct = (g.rate * 100).toFixed(0)
        const rateColor = g.isRef
          ? "var(--base01)"
          : g.rate >= 0.7
            ? "var(--green)"
            : g.rate >= 0.4
              ? "var(--yellow)"
              : "var(--orange)"
        const refMarker = g.isRef
          ? ' <span style="color:var(--base01);font-size:0.8em">[ref]</span>'
          : ""
        const rowStyle = g.isRef ? ' style="opacity:0.6"' : ""
        html += `<tr${rowStyle}>`
        html += `<td>${icon}${displayName}${refMarker}</td>`
        html += `<td><div style="display:flex"><div style="width:${doneW}px;height:10px;background:var(--cyan)"></div><div style="width:${pendingW}px;height:10px;background:var(--orange)"></div></div></td>`
        html += `<td style="color:var(--base01)">${g.done}/${g.total}</td>`
        html += `<td style="color:${rateColor}">${ratePct}%</td>`
        html += `</tr>`
      }
      html += "</tbody></table></div>"
      print(html, false)
    } else {
      // Time series CFD (default)
      const minEntry = Math.min(...tasks.map((t) => t.entry || Date.now()))
      const now = Date.now()
      const Day = 86400000

      // Use period start if specified, otherwise use earliest task entry
      const startDate = periodStart || minEntry

      // Build daily data points (sample weekly if range > 90 days)
      const totalDays = Math.ceil((now - startDate) / Day)
      const step = totalDays > 90 ? 7 : 1
      const data = []

      for (let d = startDate; d <= now; d += step * Day) {
        const dayEnd = d + Day
        const pending = tasks.filter(
          (t) => t.entry <= dayEnd && (t.end > dayEnd || !t.end),
        ).length
        const done = tasks.filter((t) => t.end && t.end <= dayEnd).length
        data.push({ date: d, pending, done, total: pending + done })
      }

      // Ensure today is always included (may be skipped when step > 1)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayTs = today.getTime()
      if (data.length === 0 || data[data.length - 1].date < todayTs) {
        const dayEnd = todayTs + Day
        const pending = tasks.filter(
          (t) => t.entry <= dayEnd && (t.end > dayEnd || !t.end),
        ).length
        const done = tasks.filter((t) => t.end && t.end <= dayEnd).length
        data.push({ date: todayTs, pending, done, total: pending + done })
      }

      // Find max for scaling
      const maxTotal = Math.max(...data.map((d) => d.total), 1)
      const barWidth = 200

      const periodLabel = periodArg
        ? ` — last ${periodArg}`
        : ` — ${totalDays} days`
      let html = `<div class="msg-standalone" style="margin-bottom:8px;color:var(--base01)">Cumulative Flow${fProj ? ` (${fProj})` : ""}${periodLabel}, ${tasks.length} tasks</div>`
      html += `<div style="font-size:0.85em;margin-bottom:4px"><span style="color:var(--orange)">■</span> pending <span style="color:var(--cyan)">■</span> done</div>`

      // Show last 20 data points max for readability
      const displayData = data.slice(-20)

      for (const d of displayData) {
        const dateStr = new Date(d.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
        const pendingW = Math.round((d.pending / maxTotal) * barWidth)
        const doneW = Math.round((d.done / maxTotal) * barWidth)
        html += `<div style="display:flex;align-items:center;margin:2px 0">`
        html += `<span style="width:50px;color:var(--base01);font-size:0.8em">${dateStr}</span>`
        html += `<div style="width:${doneW}px;height:10px;background:var(--cyan)"></div>`
        html += `<div style="width:${pendingW}px;height:10px;background:var(--orange)"></div>`
        html += `<span style="margin-left:6px;color:var(--base01);font-size:0.8em">${d.done}/${d.total}</span>`
        html += `</div>`
      }
      print(html, false)
    }
    return true
  }

  if (subCmd === "cycle" || subCmd === "slo") {
    // Cycle Time analysis
    let fProj = null
    let periodArg = "all"
    let groupBy = null
    for (const arg of subArgs) {
      if (
        arg.startsWith("p:") ||
        arg.startsWith("pro:") ||
        arg.startsWith("proj:") ||
        arg.startsWith("project:")
      )
        fProj = arg.split(":")[1]
      else if (/^\d+[dwmy]$/.test(arg)) periodArg = arg
      else if (arg.startsWith("by:")) {
        const val = arg.split(":")[1].toLowerCase()
        if (["p", "pro", "proj", "project"].includes(val))
          groupBy = "project"
        else if (["t", "tag"].includes(val)) groupBy = "tag"
      }
    }

    const all = await dbOps.getAll()
    let completed = all.filter(
      (t) => t.status === "completed" && t.end && t.entry,
    )

    if (fProj)
      completed = completed.filter((t) => matchesProject(t.project, fProj))

    if (periodArg !== "all") {
      const cutoff = parseRelativeTime(periodArg)
      if (cutoff) completed = completed.filter((t) => t.end >= cutoff)
    }

    if (completed.length === 0) {
      print(
        '<span class="msg-info">No completed tasks found.</span>',
      )
      return true
    }

    // Helper to calculate stats for a set of tasks
    const calcStats = (tasks) => {
      const latencies = tasks
        .map((t) => (t.end - t.entry) / 86400000)
        .sort((a, b) => a - b)
      if (latencies.length === 0) return null
      return {
        n: latencies.length,
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p85: latencies[Math.floor(latencies.length * 0.85)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
      }
    }

    if (groupBy === "project" || groupBy === "tag") {
      // Group by project or tag, show p50 for each, sorted by worst first
      const byGroup = {}
      for (const t of completed) {
        if (groupBy === "project") {
          const proj = t.project || "(no project)"
          if (!byGroup[proj]) byGroup[proj] = []
          byGroup[proj].push(t)
        } else {
          const tags = t.tags?.length > 0 ? t.tags : ["(no tag)"]
          for (const tag of tags) {
            if (!byGroup[tag]) byGroup[tag] = []
            byGroup[tag].push(t)
          }
        }
      }

      // Identify reference projects
      const refProjects = new Set(
        projects
          .filter((p) =>
            p.tags?.some((t) =>
              ["reference", "ref"].includes(t.toLowerCase()),
            ),
          )
          .map((p) => p.name),
      )

      const groupStats = Object.entries(byGroup)
        .map(([name, tasks]) => ({
          name,
          ...calcStats(tasks),
          isRef: groupBy === "project" && refProjects.has(name),
        }))
        .filter((p) => p.n)
        .sort((a, b) => {
          // Reference projects go to the end
          if (a.isRef !== b.isRef) return a.isRef ? 1 : -1
          return b.p50 - a.p50 // worst first
        })

      const maxP50 = Math.max(...groupStats.map((p) => p.p50), 1)
      const barWidth = 120

      const label = groupBy === "project" ? "Project" : "Tag"
      let html = `<div style="margin-bottom:8px;color:var(--base01)">Cycle Time by ${label}${periodArg !== "all" ? ` — last ${periodArg}` : ""} (${completed.length} tasks)</div>`
      html += '<div class="table-wrapper"><table><thead><tr>'
      html += `<th>${label}</th><th>n</th><th>p50</th><th>p85</th><th></th>`
      html += "</tr></thead><tbody>"

      for (const p of groupStats) {
        let icon = ""
        let displayName = p.name
        if (groupBy === "project") {
          const pMeta = projects.find((pm) => pm.name === p.name)
          icon = pMeta?.icon
            ? `<i class="${iconClass(pMeta.icon)}" style="margin-right:4px"></i>`
            : ""
        } else {
          displayName = `!${p.name}`
        }
        const w = Math.round((p.p50 / maxP50) * barWidth)
        const color = p.isRef
          ? "var(--base01)"
          : p.p50 < 7
            ? "var(--green)"
            : p.p50 < 30
              ? "var(--yellow)"
              : "var(--red)"
        const refMarker = p.isRef
          ? ' <span style="color:var(--base01);font-size:0.8em">[ref]</span>'
          : ""
        const rowStyle = p.isRef ? ' style="opacity:0.6"' : ""
        html += `<tr${rowStyle}>`
        html += `<td>${icon}${displayName}${refMarker}</td>`
        html += `<td style="color:var(--base01)">${p.n}</td>`
        html += `<td style="color:${color}">${p.p50.toFixed(1)}d</td>`
        html += `<td style="color:var(--base01)">${p.p85.toFixed(1)}d</td>`
        html += `<td><div style="width:${w}px;height:10px;background:${color}"></div></td>`
        html += `</tr>`
      }
      html += "</tbody></table></div>"
      print(html, false)
    } else {
      // Default: overall stats with histogram
      const stats = calcStats(completed)

      // Distribution buckets
      const buckets = [
        { label: "<1d", max: 1, count: 0 },
        { label: "1-7d", max: 7, count: 0 },
        { label: "7-30d", max: 30, count: 0 },
        { label: "30-90d", max: 90, count: 0 },
        { label: "90d+", max: Infinity, count: 0 },
      ]
      for (const t of completed) {
        const lat = (t.end - t.entry) / 86400000
        for (const b of buckets) {
          if (lat < b.max) {
            b.count++
            break
          }
        }
      }

      const maxCount = Math.max(...buckets.map((b) => b.count), 1)
      const barWidth = 150

      let html = `<div style="margin-bottom:8px;color:var(--base01)">Cycle Time${fProj ? ` (${fProj})` : ""}${periodArg !== "all" ? ` — last ${periodArg}` : ""}</div>`
      html += `<div style="margin-bottom:8px">`
      html += `<span style="color:var(--cyan)">n=${stats.n}</span> `
      html += `<span style="color:var(--base01)">avg:</span><span style="color:var(--base1)">${stats.avg.toFixed(1)}d</span> `
      html += `<span style="color:var(--base01)">p50:</span><span style="color:var(--green)">${stats.p50.toFixed(1)}d</span> `
      html += `<span style="color:var(--base01)">p85:</span><span style="color:var(--yellow)">${stats.p85.toFixed(1)}d</span> `
      html += `<span style="color:var(--base01)">p95:</span><span style="color:var(--red)">${stats.p95.toFixed(1)}d</span>`
      html += `</div>`

      html += `<div style="font-size:0.9em">`
      for (const b of buckets) {
        const w = Math.round((b.count / maxCount) * barWidth)
        const pct = ((b.count / completed.length) * 100).toFixed(0)
        const color =
          b.max <= 1
            ? "var(--green)"
            : b.max <= 7
              ? "var(--cyan)"
              : b.max <= 30
                ? "var(--yellow)"
                : b.max <= 90
                  ? "var(--orange)"
                  : "var(--red)"
        html += `<div style="display:flex;align-items:center;margin:2px 0">`
        html += `<span style="width:55px;color:var(--base01)">${b.label}</span>`
        html += `<div style="width:${w}px;height:12px;background:${color}"></div>`
        html += `<span style="margin-left:6px;color:var(--base01)">${b.count} (${pct}%)</span>`
        html += `</div>`
      }
      html += `</div>`
      print(html, false)
    }
    return true
  }

  if (subCmd === "churn") {
    // Parse period (default: 1w)
    let periodArg = "1w"
    for (const arg of subArgs) {
      periodArg = arg
    }

    const periodMs = parseRelativeTime(periodArg)
    const cutoff = periodMs || Date.now() - 7 * 86400000

    const all = await dbOps.getAll()

    // Find tasks with activity (started or completed/skipped) in period
    const activeTasks = all.filter(
      (t) =>
        (t.start && t.start >= cutoff) || (t.end && t.end >= cutoff),
    )

    // Group by project and count
    const projectCounts = {}
    for (const t of activeTasks) {
      const proj = t.project || "(no project)"
      if (!projectCounts[proj]) projectCounts[proj] = 0
      projectCounts[proj]++
    }

    const projectCount = Object.keys(projectCounts).length
    const sortedProjects = Object.entries(projectCounts).sort(
      (a, b) => b[1] - a[1],
    )

    let html = `<div style="margin-bottom:8px">`
    html += `<span style="color:var(--base01)">Churn (${periodArg}):</span> `
    html += `<span style="color:${projectCount > 5 ? "var(--yellow)" : "var(--green)"}">${projectCount} projects</span>`
    html += `<span style="color:var(--base01)"> touched (${activeTasks.length} tasks)</span>`
    html += `</div>`

    if (sortedProjects.length > 0) {
      html += `<div class="table-wrapper"><table><tbody>`
      for (const [proj, count] of sortedProjects) {
        html += `<tr>`
        html += `<td style="color:var(--cyan)">${proj}</td>`
        html += `<td style="color:var(--base01);text-align:right;padding-left:12px">${count} task${count > 1 ? "s" : ""}</td>`
        html += `</tr>`
      }
      html += `</tbody></table></div>`
    }

    print(html, false)
    return true
  }

  if (subCmd === "forecast") {
    const all = await dbOps.getAll()

    // Calculate velocity: tasks completed in last 4 weeks
    const fourWeeksAgo = Date.now() - 28 * 86400000
    const completedRecently = all.filter(
      (t) => t.status === "completed" && t.end && t.end >= fourWeeksAgo,
    )
    const velocity = completedRecently.length / 4 // tasks per week

    // Count pending tasks (respecting context filter)
    const pending = all.filter((t) => t.status === "pending")
    const ctx = getContext()
    const filterFn = buildContextFilter(ctx)
    const filteredPending = pending.filter(filterFn)
    const pendingCount = filteredPending.length

    // Calculate ETA
    let etaWeeks = velocity > 0 ? pendingCount / velocity : Infinity
    const etaDate = new Date(Date.now() + etaWeeks * 7 * 86400000)

    let html = `<div style="margin-bottom:8px;color:var(--base01)">Backlog Forecast${ctx ? ` (context: ${ctx})` : ""}</div>`

    html += `<div style="margin-bottom:4px">`
    html += `<span style="color:var(--base01)">Velocity:</span> `
    html += `<span style="color:var(--cyan)">${velocity.toFixed(1)} tasks/week</span>`
    html += `<span style="color:var(--base01)"> (last 4 weeks: ${completedRecently.length} completed)</span>`
    html += `</div>`

    html += `<div style="margin-bottom:4px">`
    html += `<span style="color:var(--base01)">Pending:</span> `
    html += `<span style="color:var(--yellow)">${pendingCount} tasks</span>`
    html += `</div>`

    html += `<div>`
    html += `<span style="color:var(--base01)">ETA:</span> `
    if (velocity === 0) {
      html += `<span style="color:var(--red)">No velocity data (no completions in 4 weeks)</span>`
    } else if (pendingCount === 0) {
      html += `<span style="color:var(--green)">Backlog empty!</span>`
    } else {
      const etaColor =
        etaWeeks <= 2
          ? "var(--green)"
          : etaWeeks <= 8
            ? "var(--yellow)"
            : "var(--red)"
      html += `<span style="color:${etaColor}">${etaWeeks.toFixed(1)} weeks</span>`
      html += `<span style="color:var(--base01)"> (${etaDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})</span>`
    }
    html += `</div>`

    print(html, false)
    return true
  }

  if (subCmd === "audit") {
    // Parse period (default: 4w)
    let periodArg = "4w"
    for (const arg of subArgs) {
      periodArg = arg
    }

    const periodMs = parseRelativeTime(periodArg)
    const cutoff = periodMs || Date.now() - 28 * 86400000

    const all = await dbOps.getAll()

    // Find recurring tasks resolved in period
    const resolved = all.filter(
      (t) =>
        t.recur &&
        t.end &&
        t.end >= cutoff &&
        (t.status === "completed" || t.status === "skipped"),
    )

    const totalResolved = resolved.length
    const skippedCount = resolved.filter(
      (t) => t.status === "skipped",
    ).length
    const skipRate =
      totalResolved > 0 ? (skippedCount / totalResolved) * 100 : 0

    // Group by description to see which recurring tasks get skipped most
    const byDesc = {}
    for (const t of resolved) {
      const key = t.description
      if (!byDesc[key]) byDesc[key] = { completed: 0, skipped: 0 }
      if (t.status === "skipped") byDesc[key].skipped++
      else byDesc[key].completed++
    }

    // Sort by skip rate descending, then by total volume
    const sortedTasks = Object.entries(byDesc)
      .map(([desc, counts]) => ({
        desc,
        ...counts,
        total: counts.completed + counts.skipped,
        rate: (counts.skipped / (counts.completed + counts.skipped)) * 100,
      }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total)

    let html = `<div style="margin-bottom:8px;color:var(--base01)">Recurring Task Audit (${periodArg})</div>`

    if (totalResolved === 0) {
      html += `<span style="color:var(--base01)">No recurring tasks resolved in this period.</span>`
    } else {
      const overallColor =
        skipRate < 10
          ? "var(--green)"
          : skipRate < 30
            ? "var(--yellow)"
            : "var(--red)"

      html += `<div style="margin-bottom:8px">`
      html += `<span style="color:var(--base01)">Total resolved:</span> `
      html += `<span style="color:var(--cyan)">${totalResolved}</span>`
      html += `<span style="color:var(--base01)"> | Skipped:</span> `
      html += `<span style="color:${overallColor}">${skippedCount} (${skipRate.toFixed(0)}%)</span>`
      html += `</div>`

      if (sortedTasks.length > 0) {
        html += `<div class="table-wrapper"><table><tbody>`
        for (const t of sortedTasks) {
          const rateColor =
            t.rate < 10
              ? "var(--green)"
              : t.rate < 30
                ? "var(--yellow)"
                : "var(--red)"
          const flag = t.rate >= 50 ? " ⚠" : ""
          html += `<tr>`
          html += `<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.desc}</td>`
          html += `<td style="color:${rateColor};text-align:right;padding-left:12px">${t.skipped}/${t.total} skipped (${t.rate.toFixed(0)}%)${flag}</td>`
          html += `</tr>`
        }
        html += `</tbody></table></div>`
      }
    }

    print(html, false)
    return true
  }

  // Unknown report
  print(
    `<span class="msg-error">Unknown report: ${subCmd}. Try: stale, rot, done, cfd, cycle, churn, forecast, audit</span>`,
  )
  return true
}
