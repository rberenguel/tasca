// View command handlers extracted from commands.js

import { runList } from "./list.js";
import { dbOps } from "./db.js";
import {
  matchesProject,
  hasVirtualTag,
  expandVirtualTagShorthand,
} from "./logic.js";
import { formatInlineCode, renderProjectsTable } from "./ui.js";
import { displayMapRef } from "./state.js";
import { mergeFilters } from "./context.js";

// Helper to convert icon name to Phosphor class
const iconClass = (name) =>
  name?.startsWith("ph-") ? name : `ph-light ph-${name}`;

export const handleNext = async (args, print) => {
  let limit = localStorage.getItem("tasca_next_limit")
    ? parseInt(localStorage.getItem("tasca_next_limit"))
    : 1000;

  if (args.length > 0 && args[0].match(/^\d+$/)) {
    limit = parseInt(args[0]);
    localStorage.setItem("tasca_next_limit", limit);
    args.shift();
  }

  await runList(args, limit);
};

export const handleChain = async (args, print) => {
  const idArg = args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let rootUuid;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const pending = await dbOps.getByStatus("pending");
    const match = pending.find((t) => t.target === name);
    rootUuid = match?.uuid;
  } else {
    const id = parseInt(idArg);
    rootUuid = id ? displayMapRef.value[id - 1] : null;
  }

  if (!rootUuid) return print('<span class="msg-error">Invalid ID.</span>');
  const all = await dbOps.getAll();

  const pending = all.filter((t) => t.status === "pending");
  const blocking = {};
  const uuidMap = {};
  pending.forEach((t) => {
    uuidMap[t.uuid] = t;
    if (t.depends)
      t.depends.forEach((dep) => {
        if (!blocking[dep]) blocking[dep] = [];
        blocking[dep].push(t.uuid);
      });
  });

  const ancestors = new Set();
  const getAncestors = (curr) => {
    const t = uuidMap[curr];
    if (!t || !t.depends) return;
    t.depends.forEach((d) => {
      if (uuidMap[d] && !ancestors.has(d)) {
        ancestors.add(d);
        getAncestors(d);
      }
    });
  };
  getAncestors(rootUuid);

  const descendants = new Set();
  const getDescendants = (curr) => {
    if (blocking[curr])
      blocking[curr].forEach((b) => {
        if (uuidMap[b] && !descendants.has(b)) {
          descendants.add(b);
          getDescendants(b);
        }
      });
  };
  getDescendants(rootUuid);

  const relevantUUIDs = new Set([...ancestors, rootUuid, ...descendants]);
  const roots = [];
  relevantUUIDs.forEach((u) => {
    const t = uuidMap[u];
    if (!(t.depends && t.depends.some((d) => relevantUUIDs.has(d))))
      roots.push(u);
  });

  let html = '<div style="line-height: 1.5; font-family: monospace;">';
  const renderFinal = (u, prefix, isTail) => {
    const t = uuidMap[u];
    const isTarget = u === rootUuid;
    let treeMarker = "";
    if (prefix.length > 0 || isTail !== undefined)
      treeMarker = `<span style="color:var(--base01)">${prefix}${isTail ? "└── " : "├── "}</span>`;

    let content = `<span style="${isTarget ? "color:var(--yellow); font-weight:bold" : ""}">ID:${displayMapRef.value.indexOf(u) + 1} ${formatInlineCode(t.description)}</span>`;
    if (t.tags && t.tags.length)
      content += ` <span style="color:var(--blue)">${t.tags.map((tag) => "!" + tag).join(" ")}</span>`;
    if (t.project)
      content += ` <span style="color:var(--yellow)">${t.project}</span>`;

    html += `<div>${treeMarker}${content}</div>`;

    const children = blocking[u]
      ? blocking[u].filter((c) => relevantUUIDs.has(c))
      : [];
    children.forEach((child, i) => {
      const childIsTail = i === children.length - 1;
      let nextPrefix = prefix;
      if (isTail !== undefined) nextPrefix += isTail ? "    " : "│   ";
      renderFinal(child, nextPrefix, childIsTail);
    });
  };
  if (roots.length === 0 && relevantUUIDs.size > 0)
    renderFinal(rootUuid, "", undefined);
  else roots.forEach((r) => renderFinal(r, "", undefined));
  html += "</div>";
  print(html, true);
};

export const handleProjects = async (print) => {
  await dbOps.cleanupOrphanProjects();
  const all = await dbOps.getAll();
  const projectsMeta = await dbOps.getAllProjects();

  const projectSet = new Set();
  const taskCounts = {};
  all
    .filter((t) => t.status === "pending")
    .forEach((t) => {
      if (t.project) {
        projectSet.add(t.project);
        taskCounts[t.project] = (taskCounts[t.project] || 0) + 1;
      }
    });

  renderProjectsTable(Array.from(projectSet), projectsMeta, taskCounts);
};

export const handleCalendar = async (args, print) => {
  const effectiveArgs = mergeFilters(args);

  // Parse limit from args (lim:N or l:N)
  let limit = localStorage.getItem("tasca_cal_limit")
    ? parseInt(localStorage.getItem("tasca_cal_limit"))
    : 14;
  let filterArgs = [];
  let showDone = false;

  for (const token of effectiveArgs) {
    if (token.startsWith("lim:") || token.startsWith("l:")) {
      limit = parseInt(token.split(":")[1]) || 14;
      localStorage.setItem("tasca_cal_limit", limit);
    } else {
      const expanded = token.startsWith("!")
        ? expandVirtualTagShorthand(token)
        : token;
      filterArgs.push(expanded);
      const tag = expanded.startsWith("!")
        ? expanded.substring(1).toUpperCase()
        : "";
      if (tag === "DONE" || tag === "COMPLETED") showDone = true;
    }
  }

  const all = await dbOps.getAll();
  const projects = await dbOps.getAllProjects();
  const Day = 86400000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const pastLimit = startOfToday - 7 * Day; // 7 days ago
  const futureLimit = startOfToday + limit * Day;

  // Parse filters (same as list)
  let fProj = null,
    fTags = [],
    search = [];
  for (let token of filterArgs) {
    if (
      token.startsWith("p:") ||
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      fProj = token.split(":")[1];
    else if (token.startsWith("!")) {
      fTags.push(token);
    } else search.push(token.toLowerCase());
  }

  // Filter tasks
  let tasks = showDone
    ? all.filter((t) => t.status === "completed")
    : all.filter((t) => t.status === "pending");

  if (fProj) tasks = tasks.filter((t) => matchesProject(t.project, fProj));
  if (fTags.length) {
    tasks = tasks.filter((t) =>
      fTags.every((ft) => {
        const tag = ft.substring(1).toLowerCase();
        if (t.tags && t.tags.some((tt) => tt.toLowerCase() === tag))
          return true;
        if (hasVirtualTag(t, ft, all, projects)) return true;
        return false;
      }),
    );
  }
  if (search.length)
    tasks = tasks.filter((t) =>
      search.every((s) => t.description.toLowerCase().includes(s)),
    );

  // Collect date entries: { date, type, task }
  const entries = [];
  for (const t of tasks) {
    if (showDone) {
      // For done tasks, show by end date
      if (t.end && t.end >= pastLimit && t.end < futureLimit) {
        entries.push({ date: t.end, type: "end", task: t });
      }
    } else {
      // For pending tasks, show due/sched/wait
      if (t.due) {
        // Show overdue (past 7 days) or future within limit
        if (
          (t.due < startOfToday && t.due >= pastLimit) ||
          (t.due >= startOfToday && t.due < futureLimit)
        ) {
          entries.push({ date: t.due, type: "due", task: t });
        }
      }
      if (t.sched && t.sched >= startOfToday && t.sched < futureLimit) {
        entries.push({ date: t.sched, type: "sched", task: t });
      }
      if (t.wait && t.wait >= startOfToday && t.wait < futureLimit) {
        entries.push({ date: t.wait, type: "wait", task: t });
      }
    }
  }

  // Sort by date
  entries.sort((a, b) => a.date - b.date);

  // Group by day
  const groups = {};
  for (const e of entries) {
    const dayKey = new Date(e.date).toDateString();
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(e);
  }

  // Render
  if (Object.keys(groups).length === 0) {
    print(
      `<span class="msg-info">No dated tasks in range (${limit}d).</span>`,
      false,
    );
  } else {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    let html = '<div class="calendar-view">';

    for (const dayKey of Object.keys(groups)) {
      const d = new Date(dayKey);
      const isOverdue = d.getTime() < startOfToday;
      const isToday = d.toDateString() === new Date().toDateString();
      const dayLabel = `${monthNames[d.getMonth()]} ${d.getDate()} (${dayNames[d.getDay()]})`;

      let headerStyle =
        "color:var(--cyan); border-bottom:1px solid var(--base01); margin-top:8px;";
      if (isOverdue)
        headerStyle =
          "color:var(--red); border-bottom:1px solid var(--base01); margin-top:8px;";
      if (isToday)
        headerStyle =
          "color:var(--green); border-bottom:1px solid var(--base01); margin-top:8px; font-weight:bold;";

      html += `<div style="${headerStyle}">${dayLabel}${isToday ? " (today)" : ""}${isOverdue ? " (overdue)" : ""}</div>`;

      for (const e of groups[dayKey]) {
        const t = e.task;
        const typeLabel = `<span style="color:var(--base01)">[${e.type}]</span>`;
        let desc = formatInlineCode(t.description);
        if (t.priority)
          desc += ` <span style="color:var(--magenta)">pri:${t.priority}</span>`;
        if (t.project) {
          const pMeta = projects.find((p) => p.name === t.project);
          const icon =
            pMeta && pMeta.icon
              ? `<i class="${iconClass(pMeta.icon)}" style="margin-right:3px"></i>`
              : "";
          desc += ` <span style="color:var(--yellow)">${icon}${t.project}</span>`;
        }
        html += `<div style="margin-left:12px">${typeLabel} ${desc}</div>`;
      }
    }
    html += "</div>";
    print(html, false);
  }
};
