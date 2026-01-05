import { getDaysRemaining, C } from "./logic.js";
import { formatDateHtml } from "./utils.js";
import { hasContext, formatContextDisplay } from "./context.js";

let projectMetadata = {};

// Format text between backticks as inline code
export const formatInlineCode = (text) => {
  if (!text) return text;
  return text.replace(/`([^`]+)`/g, '<span class="inline-code">$1</span>');
};
let cachedProjectCounts = {}; // for projects table

export const setProjectMetadata = (meta) => {
  projectMetadata = {};
  if (meta && meta.length) {
    meta.forEach((m) => (projectMetadata[m.name] = m));
  }
};

export const print = (content, append = true) => {
  const term = document.getElementById("terminal-output");
  if (!append) term.innerHTML = "";
  const div = document.createElement("div");
  div.style.marginBottom = "8px";
  if (typeof content === "string") {
    div.innerHTML = content;
  } else if (content instanceof Node) {
    div.appendChild(content);
  }
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
    iconHtml = `<i class="${projectMetadata[proj].icon}" style="margin-right:4px; color:var(--yellow)"></i>`;
  }
  // If we wanted inheritance (e.g. Work.Project gets Work icon), we'd split and loop.
  // Let's support simple inheritance: check 'Work.Project', then 'Work'.
  else {
    const parts = proj.split(".");
    while (parts.length > 0) {
      const p = parts.join(".");
      if (projectMetadata[p] && projectMetadata[p].icon) {
        iconHtml = `<i class="${projectMetadata[p].icon}" style="margin-right:4px; color:var(--yellow)"></i>`;
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

  // Helper to create table structure
  const createTableStruct = () => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
        <th style="width:25px">ID</th>
        <th>Description</th>
        <th style="width:40px; text-align:right">Urg</th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return { wrapper, tbody };
  };

  const container = document.createDocumentFragment();

  if (hasContext()) {
    const ctxDiv = document.createElement("div");
    ctxDiv.className = "context-banner";
    ctxDiv.textContent = `Context: ${formatContextDisplay()}`;
    container.appendChild(ctxDiv);
  }

  if (!tasks || tasks.length === 0) {
    displayMapRef.value = [];
    const { wrapper } = createTableStruct();
    container.appendChild(wrapper);
    const footer = document.createElement("div");
    footer.style.fontSize = "0.8em";
    footer.style.color = "var(--base01)";
    footer.textContent = "0 tasks shown.";
    container.appendChild(footer);
    return print(container, false);
  }

  displayMapRef.value = tasks.map((t) => t.uuid);
  const { wrapper, tbody } = createTableStruct();

  tasks.forEach((t, index) => {
    const tr = document.createElement("tr");
    if (t.start && t.status === "pending") tr.className = "row-active";

    // Cell 1: ID
    const tdId = document.createElement("td");
    tdId.className = "row-id";
    tdId.textContent = index + 1;
    tr.appendChild(tdId);

    // Cell 2: Description + Metadata
    const tdDesc = document.createElement("td");
    tdDesc.className = "row-desc";

    // Icon
    if (t.icon) {
      const i = document.createElement("i");
      i.className = t.icon;
      i.style.marginRight = "5px";
      tdDesc.appendChild(i);
    }

    // Description (handles inline code)
    const descSpan = document.createElement("span");
    descSpan.innerHTML = formatInlineCode(t.description); // formatInlineCode still returns HTML string
    tdDesc.appendChild(descSpan);

    // Metadata
    // Link
    if (t.url) {
      const a = document.createElement("a");
      a.href = t.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "task-link";
      a.style.marginLeft = "4px"; // added spacing
      a.innerHTML = '<i class="ph-light ph-link"></i>';
      tdDesc.appendChild(a);
    }
    // Project
    if (t.project) {
      tdDesc.appendChild(document.createTextNode(" "));
      const projSpan = document.createElement("span");
      projSpan.innerHTML = formatProject(t.project);
      tdDesc.appendChild(projSpan);
    }
    // Priority
    if (t.priority != null) {
      tdDesc.appendChild(document.createTextNode(" "));
      const priSpan = document.createElement("span");
      let priColor = "var(--base01)";
      if (typeof t.priority === "number" && t.priority >= C.priLow) {
        let hue;
        if (t.priority >= C.priHigh) hue = 0;
        else if (t.priority >= C.priMed)
          hue = 60 - ((t.priority - C.priMed) / C.priMed) * 60;
        else hue = 120 - ((t.priority - C.priLow) / (C.priMed - C.priLow)) * 60;
        priColor = `hsl(${hue}, 70%, 45%)`;
      }
      priSpan.style.color = priColor;
      priSpan.style.fontWeight = "bold";
      priSpan.textContent = `pri:${t.priority}`;
      tdDesc.appendChild(priSpan);
    }
    // Due
    if (t.due) {
      tdDesc.appendChild(document.createTextNode(" "));
      const daysCheck = getDaysRemaining(t.due);
      const dateSpan = document.createElement("span");
      let cls = "date-far";
      if (daysCheck < C.daysWarning) cls = "date-urgent";
      else if (daysCheck < C.daysSoon) cls = "date-soon";
      dateSpan.className = `date-pill ${cls}`;
      dateSpan.textContent = `(${daysCheck}d)`;
      tdDesc.appendChild(dateSpan);
    }
    // Wait
    if (t.wait && t.wait > Date.now()) {
      tdDesc.appendChild(document.createTextNode(" "));
      const waitSpan = document.createElement("span");
      waitSpan.className = "date-pill date-wait";
      waitSpan.textContent = `wait:${formatDateHtml(t.wait)}`;
      tdDesc.appendChild(waitSpan);
    }
    // Recur
    if (t.recur) {
      tdDesc.appendChild(document.createTextNode(" "));
      const recurSpan = document.createElement("span");
      recurSpan.className = "recur-icon";
      recurSpan.textContent = `↻${t.recur}`;
      tdDesc.appendChild(recurSpan);
    }
    // Active
    if (t.start && t.status === "pending") {
      tdDesc.appendChild(document.createTextNode(" "));
      const activeSpan = document.createElement("span");
      activeSpan.className = "active-icon";
      activeSpan.textContent = "▶";
      tdDesc.appendChild(activeSpan);
    }
    // Deps
    if (t.depends && t.depends.length > 0) {
      const activeDeps = allTasks.filter(
        (tsk) => t.depends.includes(tsk.uuid) && tsk.status === "pending",
      );
      if (activeDeps.length > 0) {
        tdDesc.appendChild(document.createTextNode(" "));
        const depSpan = document.createElement("span");
        depSpan.className = "blocked-pill";
        depSpan.textContent = `dep:${activeDeps.length}`;
        tdDesc.appendChild(depSpan);
      }
    }
    // Annotations
    if (t.annotations && t.annotations.length > 0) {
      tdDesc.appendChild(document.createTextNode(" "));
      const annoSpan = document.createElement("span");
      annoSpan.className = "anno-count";
      annoSpan.textContent = `msg:${t.annotations.length}`;
      tdDesc.appendChild(annoSpan);
    }
    // Done info
    if (t.end) {
      tdDesc.appendChild(document.createTextNode(" "));
      const d = new Date(t.end);
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toTimeString().slice(0, 5);
      const doneSpan = document.createElement("span");
      doneSpan.style.color = "var(--green)";
      doneSpan.textContent = `done:${dateStr} ${timeStr}`;
      tdDesc.appendChild(doneSpan);
    }
    // Tags
    if (t.tags && t.tags.length > 0) {
      t.tags.forEach((tag) => {
        tdDesc.appendChild(document.createTextNode(" "));
        const tagSpan = document.createElement("span");
        tagSpan.className = "tag-pill";
        tagSpan.textContent = tag;
        tdDesc.appendChild(tagSpan);
      });
    }

    tr.appendChild(tdDesc);

    // Cell 3: Urgency
    const tdUrg = document.createElement("td");
    tdUrg.className = "row-urgency";
    tdUrg.textContent = t.urgency;
    tr.appendChild(tdUrg);

    tbody.appendChild(tr);
  });

  container.appendChild(wrapper);

  const footer = document.createElement("div");
  footer.style.fontSize = "0.8em";
  footer.style.color = "var(--base01)";
  footer.textContent = `${tasks.length} tasks shown.`;
  container.appendChild(footer);

  print(container, false);
};

export const renderProjectsTable = (projectNames, projectsMeta, taskCounts) => {
  setProjectMetadata(projectsMeta);

  const createTableStruct = () => {
    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
        <th>Project</th>
        <th style="width:60px; text-align:right">Tasks</th>
    </tr>`;
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return { wrapper, tbody };
  };

  const container = document.createDocumentFragment();

  if (!projectNames || projectNames.length === 0) {
    const { wrapper } = createTableStruct();
    container.appendChild(wrapper);
    const footer = document.createElement("div");
    footer.style.fontSize = "0.8em";
    footer.style.color = "var(--base01)";
    footer.textContent = "0 projects.";
    container.appendChild(footer);
    return print(container, false);
  }

  const { wrapper, tbody } = createTableStruct();

  projectNames.sort().forEach((name) => {
    const count = taskCounts[name] || 0;
    const meta = projectMetadata[name];

    const tr = document.createElement("tr");

    // Cell 1: Project with icon and tags
    const tdProj = document.createElement("td");

    // formatProject returns HTML string
    const projSpan = document.createElement("span");
    projSpan.innerHTML = formatProject(name);
    tdProj.appendChild(projSpan);

    if (meta?.tags?.length > 0) {
      meta.tags.forEach((tag) => {
        tdProj.appendChild(document.createTextNode(" "));
        const tagSpan = document.createElement("span");
        tagSpan.className = "tag-pill";
        tagSpan.textContent = tag;
        tdProj.appendChild(tagSpan);
      });
    }
    tr.appendChild(tdProj);

    // Cell 2: Count
    const tdCount = document.createElement("td");
    tdCount.style.textAlign = "right";
    tdCount.textContent = count;
    tr.appendChild(tdCount);

    tbody.appendChild(tr);
  });

  container.appendChild(wrapper);

  const footer = document.createElement("div");
  footer.style.fontSize = "0.8em";
  footer.style.color = "var(--base01)";
  footer.textContent = `${projectNames.length} projects.`;
  container.appendChild(footer);

  print(container, false);
};
