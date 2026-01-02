import { getDaysRemaining } from "./logic.js";
import { formatDateHtml } from "./utils.js";
import { hasContext, formatContextDisplay } from "./context.js";

let projectMetadata = {};
let cachedProjectCounts = {}; // for projects table

export const setProjectMetadata = (meta) => {
  projectMetadata = {};
  if (meta && meta.length) {
    meta.forEach((m) => (projectMetadata[m.name] = m));
  }
};

export const print = (html, append = true) => {
  const term = document.getElementById("terminal-output");
  if (!append) term.innerHTML = "";
  const div = document.createElement("div");
  div.style.marginBottom = "8px";
  div.innerHTML = html;
  term.appendChild(div);
  term.scrollTop = append ? term.scrollHeight : 0;
};

export const formatProject = (proj) => {
  if (!proj) return "";

  // Check for icon
  let iconHtml = "";
  // Check exact match or parent match if we want inheritance, but let's stick to simple lookup first.
  // If strict match:
  if (projectMetadata[proj] && projectMetadata[proj].icon) {
    iconHtml = `<i class="${projectMetadata[proj].icon}" style="margin-right:4px;"></i>`;
  }
  // If we wanted inheritance (e.g. Work.Project gets Work icon), we'd split and loop.
  // Let's support simple inheritance: check 'Work.Project', then 'Work'.
  else {
    const parts = proj.split(".");
    while (parts.length > 0) {
      const p = parts.join(".");
      if (projectMetadata[p] && projectMetadata[p].icon) {
        iconHtml = `<i class="${projectMetadata[p].icon}" style="margin-right:4px;"></i>`;
        break;
      }
      parts.pop();
    }
  }

  const parts = proj.split(".");
  let html = "";
  // Cycle through solarized colors by depth: yellow, orange, red, magenta, violet, blue
  const depthClasses = [
    "row-proj-d0",
    "row-proj-d1",
    "row-proj-d2",
    "row-proj-d3",
    "row-proj-d4",
    "row-proj-d5",
  ];
  for (let i = 0; i < parts.length; i++) {
    const depthClass = depthClasses[Math.min(i, depthClasses.length - 1)];
    html += `<span class="${depthClass}">${parts[i]}</span>`;
    if (i < parts.length - 1) html += `<span class="${depthClass}">.</span>`;
  }
  return iconHtml + html;
};

export const renderTable = (tasks, allTasks, displayMapRef, projects = []) => {
  setProjectMetadata(projects);
  if (!tasks || tasks.length === 0) {
    displayMapRef.value = [];
    let html = `
        <div class="table-wrapper">
        <table>
            <thead><tr>
                <th style="width:25px">ID</th>
                <th>Description</th>
                <th style="width:40px; text-align:right">Urg</th>
            </tr></thead>
            <tbody></tbody>
        </table></div>`;
    html += `<div style="font-size:0.8em; color:var(--base01)">0 tasks shown.</div>`;
    if (hasContext()) {
      const ctxDisplay = formatContextDisplay();
      html = `<div class="context-banner">Context: ${ctxDisplay}</div>` + html;
    }
    return print(html, false);
  }

  displayMapRef.value = tasks.map((t) => t.uuid);

  let html = `
    <div class="table-wrapper">
    <table>
        <thead><tr>
            <th style="width:25px">ID</th>
            <th>Description</th>
            <th style="width:40px; text-align:right">Urg</th>
        </tr></thead>
        <tbody>`;

  tasks.forEach((t, index) => {
    let desc = t.description;

    let tagsHtml = "";
    if (t.tags && t.tags.length > 0) {
      t.tags.forEach((tag) => {
        tagsHtml += ` <span class="tag-pill">${tag}</span>`;
      });
    }

    // Enrich description with project, priority etc if not simple list
    let metaHtml = "";
    if (t.url) {
      metaHtml += ` <a href="${t.url}" target="_blank" rel="noopener" class="task-link"><i class="ph-light ph-link"></i></a>`;
    }
    if (t.project) metaHtml += ` ${formatProject(t.project)}`;
    if (t.priority != null) {
      let priColor = "var(--base01)"; // default/low/negative
      if (typeof t.priority === "number" && t.priority >= 10) {
        // Smooth gradient: green(10) → yellow(25) → red(50+)
        // HSL hue: green=120, yellow=60, red=0
        let hue;
        if (t.priority >= 50) {
          hue = 0; // red
        } else if (t.priority >= 25) {
          // yellow(60) to red(0) as priority goes 25→50
          hue = 60 - ((t.priority - 25) / 25) * 60;
        } else {
          // green(120) to yellow(60) as priority goes 10→25
          hue = 120 - ((t.priority - 10) / 15) * 60;
        }
        priColor = `hsl(${hue}, 70%, 45%)`;
      }
      metaHtml += ` <span style="color:${priColor}; font-weight:bold">pri:${t.priority}</span>`;
    }

    if (t.due) {
      const daysCheck = getDaysRemaining(t.due);
      let cls = "date-far";
      if (daysCheck < 2) cls = "date-urgent";
      else if (daysCheck < 7) cls = "date-soon";
      metaHtml += ` <span class="date-pill ${cls}">(${daysCheck}d)</span>`;
    }
    if (t.wait && t.wait > Date.now()) {
      metaHtml += ` <span class="date-pill date-wait">wait:${formatDateHtml(t.wait)}</span>`;
    }
    if (t.recur) {
      metaHtml += ` <span class="recur-icon">↻${t.recur}</span>`;
    }
    if (t.start && t.status === "pending") {
      metaHtml += ` <span class="active-icon">▶</span>`;
    }
    if (t.depends && t.depends.length > 0) {
      const activeDeps = allTasks.filter(
        (tsk) => t.depends.includes(tsk.uuid) && tsk.status === "pending",
      );
      if (activeDeps.length > 0) {
        metaHtml += ` <span class="blocked-pill">dep:${activeDeps.length}</span>`;
      }
    }
    if (t.annotations && t.annotations.length > 0) {
      metaHtml += ` <span class="anno-count">msg:${t.annotations.length}</span>`;
    }
    if (t.end) {
      const d = new Date(t.end);
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toTimeString().slice(0, 5);
      metaHtml += ` <span style="color:var(--green)">done:${dateStr} ${timeStr}</span>`;
    }

    const taskIcon = t.icon
      ? `<i class="${t.icon}" style="margin-right:5px"></i>`
      : "";
    const isActive = t.start && t.status === "pending";
    html += `<tr${isActive ? ' class="row-active"' : ""}>
            <td class="row-id">${index + 1}</td>
            <td class="row-desc">${taskIcon}${desc}${metaHtml}${tagsHtml}</td>
            <td class="row-urgency">${t.urgency}</td>
        </tr>`;
  });

  html += `</tbody></table></div>`;
  html += `<div style="font-size:0.8em; color:var(--base01)">${tasks.length} tasks shown.</div>`;

  // Prepend context banner if active
  if (hasContext()) {
    const ctxDisplay = formatContextDisplay();
    html = `<div class="context-banner">Context: ${ctxDisplay}</div>` + html;
  }

  print(html, false);
};

export const renderProjectsTable = (projectNames, projectsMeta, taskCounts) => {
  setProjectMetadata(projectsMeta);
  if (!projectNames || projectNames.length === 0) {
    let html = `
        <div class="table-wrapper">
        <table>
            <thead><tr>
                <th>Project</th>
                <th style="width:60px; text-align:right">Tasks</th>
            </tr></thead>
            <tbody></tbody>
        </table></div>`;
    html += `<div style="font-size:0.8em; color:var(--base01)">0 projects.</div>`;
    return print(html, false);
  }

  let html = `
    <div class="table-wrapper">
    <table>
        <thead><tr>
            <th>Project</th>
            <th style="width:60px; text-align:right">Tasks</th>
        </tr></thead>
        <tbody>`;

  projectNames.sort().forEach((name) => {
    const count = taskCounts[name] || 0;
    const meta = projectMetadata[name];
    let tagsHtml = "";
    if (meta?.tags?.length > 0) {
      meta.tags.forEach((tag) => {
        tagsHtml += ` <span class="tag-pill">${tag}</span>`;
      });
    }
    html += `<tr>
            <td>${formatProject(name)}${tagsHtml}</td>
            <td style="text-align:right">${count}</td>
        </tr>`;
  });

  html += `</tbody></table></div>`;
  html += `<div style="font-size:0.8em; color:var(--base01)">${projectNames.length} projects.</div>`;

  print(html, false);
};
