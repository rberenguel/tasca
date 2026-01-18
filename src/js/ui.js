import { getDaysRemaining, C, hasVirtualTag } from "./logic.js";
import { isChecklistParent } from "./commands-checklist.js";
import { formatDateHtml } from "./utils.js";
import { hasContext, formatContextDisplay, getContext } from "./context.js";

// Convert icon name to full Phosphor class (handles legacy full class format)
const iconClass = (name) => {
  if (!name) return "";
  return name.startsWith("ph-") ? name : `ph-light ph-${name}`;
};

// Solarized color mapping for task styling
const colorMap = {
  b: "var(--blue)",
  v: "var(--violet)",
  o: "var(--orange)",
  c: "var(--cyan)",
  g: "var(--green)",
  y: "var(--yellow)",
  r: "var(--red)",
  m: "var(--magenta)",
};

const getTrackMarker = (task) => {
  if (!task.track || task.track.length === 0) return null;

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const todayNext = todayStart + 86400000;

  const todayEvents = task.track.filter(
    (t) => t.entry >= todayStart && t.entry < todayNext,
  );

  if (todayEvents.length === 0) return null;

  // Most recent event determines type
  const last = todayEvents[todayEvents.length - 1];

  if (last.type === "day") {
    // Subtle cyan dot
    return `<span style="color:var(--cyan); margin-left:4px" title="Tracked today">•</span>`;
  } else if (last.type === "pct") {
    // Last percentage
    return `<span style="color:var(--cyan); font-size:0.8em; margin-left:4px" title="Progress: ${last.value}%">${last.value}%</span>`;
  } else if (last.type === "min") {
    // Sum of all minutes TODAY
    const totalMinutes = todayEvents
      .filter((t) => t.type === "min")
      .reduce((acc, t) => acc + t.value, 0);
    return `<span style="color:var(--cyan); font-size:0.8em; margin-left:4px" title="Today: ${totalMinutes}m">${totalMinutes}m</span>`;
  }
  return null;
};

let projectMetadata = {};

// Format text between backticks as inline code
export const formatInlineCode = (text) => {
  if (!text) return text;
  return text.replace(/`([^`]+)`/g, '<span class="inline-code">$1</span>');
};
let cachedProjectCounts = {}; // for projects table
let bannerHidden = false; // temporarily hide banner (reset on context change)

export const resetBannerHidden = () => {
  bannerHidden = false;
};

// Ticker animation for project banners (marquee style: right to left)
let tickerInterval = null;
const startTicker = (span) => {
  if (tickerInterval) clearInterval(tickerInterval);

  const banners = JSON.parse(span.dataset.banners);
  let bannerIndex = 0;
  let pos = 0;
  const speed = 1.5;

  span.textContent = banners[bannerIndex];

  // Start animation after element is in DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const containerWidth = span.parentElement?.clientWidth || 300;
      // Start from right edge
      pos = containerWidth;
      span.style.transform = `translateX(${pos}px)`;

      tickerInterval = setInterval(() => {
        pos -= speed;
        span.style.transform = `translateX(${pos}px)`;

        // When text has scrolled completely off left side, switch to next
        const textWidth = span.scrollWidth;
        if (pos < -textWidth) {
          bannerIndex = (bannerIndex + 1) % banners.length;
          span.textContent = banners[bannerIndex];
          pos = containerWidth;
        }
      }, 30);
    });
  });
};

// Typewriter animation for project banners
let typewriterInterval = null;
const startTypewriter = (span) => {
  // Clear any existing interval
  if (typewriterInterval) clearInterval(typewriterInterval);

  const banners = JSON.parse(span.dataset.banners);
  let bannerIndex = 0;
  let charIndex = 0;
  let deleting = false;
  let pauseCount = 0;

  typewriterInterval = setInterval(() => {
    const currentBanner = banners[bannerIndex];

    if (pauseCount > 0) {
      pauseCount--;
      return;
    }

    if (!deleting) {
      // Typing
      span.textContent = currentBanner.substring(0, charIndex + 1);
      charIndex++;
      if (charIndex >= currentBanner.length) {
        pauseCount = 50; // Pause at end (~2s at 40ms interval)
        deleting = true;
      }
    } else {
      // Deleting
      span.textContent = currentBanner.substring(0, charIndex);
      charIndex--;
      if (charIndex <= 0) {
        deleting = false;
        bannerIndex = (bannerIndex + 1) % banners.length;
        charIndex = 0;
        pauseCount = 10; // Brief pause before next (~0.4s)
      }
    }
  }, 40);
};

export const setProjectMetadata = (meta) => {
  projectMetadata = {};
  if (meta && meta.length) {
    meta.forEach((m) => (projectMetadata[m.name] = m));
  }
};

// Store execute reference for dismissible outputs
let executeRef = null;
export const setExecuteRef = (fn) => {
  executeRef = fn;
};

// Make the entire terminal output area dismissible (click anywhere to refresh)
let dismissibleHandler = null;
export const makeOutputDismissible = () => {
  if (!executeRef) return;
  const term = document.getElementById("terminal-output");
  if (!term) return;

  // Remove any existing handler
  if (dismissibleHandler) {
    term.removeEventListener("click", dismissibleHandler);
  }

  // Add new one-time handler
  dismissibleHandler = () => {
    term.removeEventListener("click", dismissibleHandler);
    term.style.cursor = "";
    dismissibleHandler = null;
    executeRef("");
  };

  term.style.cursor = "pointer";
  term.addEventListener("click", dismissibleHandler);
};

// Clear dismissible state (called when output changes)
export const clearDismissible = () => {
  if (dismissibleHandler) {
    const term = document.getElementById("terminal-output");
    if (term) {
      term.removeEventListener("click", dismissibleHandler);
      term.style.cursor = "";
    }
    dismissibleHandler = null;
  }
};

export const print = (content, append = true, options = {}) => {
  const term = document.getElementById("terminal-output");
  if (!append) {
    term.innerHTML = "";
    clearDismissible();
  }
  const div = document.createElement("div");
  div.style.marginBottom = "8px";
  if (typeof content === "string") {
    div.innerHTML = content;
  } else if (content instanceof Node) {
    div.appendChild(content);
  }
  // Dismissible outputs - make whole output area clickable to refresh
  if (options.dismissible) {
    makeOutputDismissible();
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
    iconHtml = `<i class="${iconClass(projectMetadata[proj].icon)}" style="margin-right:4px; color:var(--yellow)"></i>`;
  }
  // If we wanted inheritance (e.g. Work.Project gets Work icon), we'd split and loop.
  // Let's support simple inheritance: check 'Work.Project', then 'Work'.
  else {
    const parts = proj.split(".");
    while (parts.length > 0) {
      const p = parts.join(".");
      if (projectMetadata[p] && projectMetadata[p].icon) {
        iconHtml = `<i class="${iconClass(projectMetadata[p].icon)}" style="margin-right:4px; color:var(--yellow)"></i>`;
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

export const renderTable = (
  tasks,
  allTasks,
  displayMapRef,
  projects = [],
  headerHtml = null,
  isTodayView = false,
  sections = { started: [], overdue: [], ready: [] },
  checklistGroups = new Map(),
  isNextView = false,
) => {
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

  // Add optional header (e.g. status command info)
  if (headerHtml) {
    const headerDiv = document.createElement("div");
    headerDiv.innerHTML = headerHtml;
    headerDiv.style.marginBottom = "8px";
    container.appendChild(headerDiv);
  }

  // Add context banner first, then project banner below it
  let projectBannerData = null;
  if (hasContext()) {
    const ctx = getContext();
    if (ctx?.project && projectMetadata[ctx.project]?.banners?.length > 0) {
      projectBannerData = projectMetadata[ctx.project];
    }

    const ctxDiv = document.createElement("div");
    ctxDiv.className = "context-banner";
    ctxDiv.textContent = `Context: ${formatContextDisplay()}`;
    container.appendChild(ctxDiv);

    // Add project banner below context (unless temporarily hidden)
    if (projectBannerData && !bannerHidden) {
      const proj = projectBannerData;
      const style = proj.bannerStyle || "ticker";
      const bannerDiv = document.createElement("div");
      bannerDiv.className = `project-banner project-banner-${style}`;
      bannerDiv.style.cursor = "pointer";

      // Both styles use JS animation for rotation
      const innerSpan = document.createElement("span");
      innerSpan.className = "project-banner-text";
      innerSpan.dataset.banners = JSON.stringify(proj.banners);
      innerSpan.dataset.bannerIndex = "0";
      bannerDiv.appendChild(innerSpan);

      // Click to hide temporarily
      bannerDiv.addEventListener("click", () => {
        bannerHidden = true;
        bannerDiv.style.display = "none";
        if (tickerInterval) clearInterval(tickerInterval);
        if (typewriterInterval) clearInterval(typewriterInterval);
      });

      if (style === "ticker") {
        startTicker(innerSpan);
      } else {
        startTypewriter(innerSpan);
      }

      container.appendChild(bannerDiv);
    }
  }

  const { started = [], overdue = [], ready = [] } = sections;
  const totalTasks =
    (tasks?.length || 0) + started.length + overdue.length + ready.length;
  if (totalTasks === 0) {
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

  // Build display map including checklist members (calculated after rendering)
  // For now, set to tasks; will be updated after rendering with members
  const { wrapper, tbody } = createTableStruct();

  // Helper to render a checklist member row (indented, with checkbox)
  const renderChecklistMemberRow = (t, displayIndex) => {
    const tr = document.createElement("tr");
    tr.className = "checklist-member-row";

    // Check if waiting/scheduled (should be dimmed)
    const now = Date.now();
    const isWaiting = t.wait && t.wait > now;
    const isScheduled = t.sched && t.sched > now;
    const isDimmed = isWaiting || isScheduled;
    if (isDimmed) tr.classList.add("checklist-dimmed");

    // Cell 1: ID (members get their own ID for editing)
    const tdId = document.createElement("td");
    tdId.className = "row-id";
    tdId.textContent = displayIndex + 1;
    tr.appendChild(tdId);

    // Cell 2: Checkbox + Description
    const tdDesc = document.createElement("td");
    tdDesc.className = "row-desc checklist-member-desc";

    // Checkbox icon based on status
    const checkbox = document.createElement("i");
    if (t.status === "completed") {
      checkbox.className = "ph-fill ph-check-square";
      checkbox.style.color = "var(--green)";
    } else if (t.status === "skipped") {
      checkbox.className = "ph-light ph-prohibit";
      checkbox.style.color = "var(--base01)";
    } else if (isDimmed) {
      checkbox.className = "ph-light ph-clock";
      checkbox.style.color = "var(--base01)";
    } else {
      checkbox.className = "ph-light ph-square";
      checkbox.style.color = "var(--base0)";
    }
    checkbox.style.marginRight = "6px";
    tdDesc.appendChild(checkbox);

    // Task icon (if any)
    if (t.icon) {
      const i = document.createElement("i");
      i.className = iconClass(t.icon);
      i.style.marginRight = "5px";
      if (t.color?.icon && colorMap[t.color.icon]) {
        i.style.color = colorMap[t.color.icon];
      }
      tdDesc.appendChild(i);
    }

    // Description
    const descSpan = document.createElement("span");
    descSpan.innerHTML = formatInlineCode(t.description);
    tdDesc.appendChild(descSpan);

    // Show wait time if waiting
    if (isWaiting) {
      tdDesc.appendChild(document.createTextNode(" "));
      const waitSpan = document.createElement("span");
      waitSpan.className = "date-pill date-wait";
      waitSpan.innerHTML = `wait:${formatDateHtml(t.wait)}`;
      tdDesc.appendChild(waitSpan);
    }

    // Recur indicator
    if (t.recur) {
      tdDesc.appendChild(document.createTextNode(" "));
      const recurSpan = document.createElement("span");
      recurSpan.className = "recur-icon";
      recurSpan.textContent = `↻${t.recur}`;
      tdDesc.appendChild(recurSpan);
    }

    tr.appendChild(tdDesc);

    // Cell 3: Empty urgency cell
    const tdUrg = document.createElement("td");
    tdUrg.className = "row-urgency";
    tr.appendChild(tdUrg);

    return tr;
  };

  // Helper to render a single task row
  const renderTaskRow = (t, index, checklistSummary = null) => {
    const tr = document.createElement("tr");
    if (t.start && t.status === "pending") tr.className = "row-active";
    if (isChecklistParent(t)) tr.classList.add("checklist-parent-row");

    // Cell 1: ID
    const tdId = document.createElement("td");
    tdId.className = "row-id";
    tdId.textContent = index + 1;
    tr.appendChild(tdId);

    // Cell 2: Description + Metadata
    const tdDesc = document.createElement("td");
    tdDesc.className = "row-desc";

    // Order (only shown in today view)
    if (isTodayView && t.order != null) {
      const orderSpan = document.createElement("span");
      orderSpan.className = "order-badge";
      orderSpan.textContent = t.order;
      tdDesc.appendChild(orderSpan);
    }

    // Checklist parent icon
    if (isChecklistParent(t)) {
      const i = document.createElement("i");
      i.className = "ph-light ph-list-checks";
      i.style.marginRight = "5px";
      i.style.color = "var(--cyan)";
      tdDesc.appendChild(i);
    }
    // Task icon (in addition to checklist icon if present)
    else if (t.icon) {
      const i = document.createElement("i");
      i.className = iconClass(t.icon);
      i.style.marginRight = "5px";
      if (t.color?.icon && colorMap[t.color.icon]) {
        i.style.color = colorMap[t.color.icon];
      }
      tdDesc.appendChild(i);
    }

    // Description (handles inline code)
    const descSpan = document.createElement("span");
    descSpan.innerHTML = formatInlineCode(t.description); // formatInlineCode still returns HTML string
    tdDesc.appendChild(descSpan);

    // Checklist summary (for next view)
    if (checklistSummary) {
      tdDesc.appendChild(document.createTextNode(" "));
      const summarySpan = document.createElement("span");
      summarySpan.className = "checklist-summary";
      summarySpan.style.color = "var(--cyan)";
      summarySpan.style.fontSize = "0.9em";
      summarySpan.textContent = `(${checklistSummary.done}/${checklistSummary.total})`;
      tdDesc.appendChild(summarySpan);
    }

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
    // Blocker count (how many pending tasks does this task block?)
    const blocksCount = allTasks.filter(
      (tsk) =>
        tsk.status === "pending" && tsk.depends && tsk.depends.includes(t.uuid),
    ).length;
    if (blocksCount > 0) {
      tdDesc.appendChild(document.createTextNode(" "));
      const blockerSpan = document.createElement("span");
      blockerSpan.className = "blocker-pill";
      blockerSpan.innerHTML = `<i class="ph-light ph-prohibit blocker-icon"></i>${blocksCount}`;
      tdDesc.appendChild(blockerSpan);
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
    // Due (skip 0d in today view since it's redundant)
    if (t.due) {
      const daysCheck = getDaysRemaining(t.due);
      if (!(isTodayView && daysCheck === 0)) {
        tdDesc.appendChild(document.createTextNode(" "));
        const dateSpan = document.createElement("span");
        let cls = "date-far";
        if (daysCheck < C.daysWarning) cls = "date-urgent";
        else if (daysCheck < C.daysSoon) cls = "date-soon";
        dateSpan.className = `date-pill ${cls}`;
        dateSpan.textContent = `(${daysCheck}d)`;
        tdDesc.appendChild(dateSpan);
      }
    }
    // Wait
    if (t.wait && t.wait > Date.now()) {
      tdDesc.appendChild(document.createTextNode(" "));
      const waitSpan = document.createElement("span");
      waitSpan.className = "date-pill date-wait";
      waitSpan.innerHTML = `wait:${formatDateHtml(t.wait)}`;
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
    // Tracking Marker
    const trackHtml = getTrackMarker(t);
    if (trackHtml) {
      const trackSpan = document.createElement("span");
      trackSpan.innerHTML = trackHtml;
      tdDesc.appendChild(trackSpan);
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

    return tr;
  };

  // Build display map including checklist members
  const displayOrder = [];
  tasks.forEach((t) => {
    displayOrder.push(t.uuid);
    // In full view, include members in display order after parent
    if (!isNextView && isChecklistParent(t) && checklistGroups.has(t.uuid)) {
      const group = checklistGroups.get(t.uuid);
      group.members.forEach((m) => displayOrder.push(m.uuid));
    }
  });
  // Add sections to display order
  [...started, ...overdue, ...ready].forEach((t) => displayOrder.push(t.uuid));
  // Set displayMapRef for ID resolution
  displayMapRef.value = displayOrder;

  // Render tasks with checklist handling
  let displayIndex = 0;
  tasks.forEach((t) => {
    const group = checklistGroups.get(t.uuid);

    if (isChecklistParent(t) && group) {
      if (isNextView) {
        // Next view: show summary count
        const done = group.doneMembers || 0;
        const total = (group.totalPending || 0) + done;
        tbody.appendChild(renderTaskRow(t, displayIndex, { done, total }));
        displayIndex++;
      } else {
        // Full view: expand checklist
        tbody.appendChild(renderTaskRow(t, displayIndex, null));
        displayIndex++;
        // Render members
        group.members.forEach((member) => {
          tbody.appendChild(renderChecklistMemberRow(member, displayIndex));
          displayIndex++;
        });
      }
    } else {
      tbody.appendChild(renderTaskRow(t, displayIndex, null));
      displayIndex++;
    }
  });

  container.appendChild(wrapper);

  // Helper to render a section with a separator
  const renderSection = (sectionTasks, name, startIndex) => {
    if (sectionTasks.length === 0) return startIndex;

    const separator = document.createElement("div");
    separator.className = `${name}-separator`;
    separator.innerHTML = `<span class="${name}-label">${name}</span>`;
    container.appendChild(separator);

    const sectionWrapper = document.createElement("div");
    sectionWrapper.className = "table-wrapper";
    const sectionTable = document.createElement("table");
    const sectionTbody = document.createElement("tbody");
    sectionTable.appendChild(sectionTbody);
    sectionWrapper.appendChild(sectionTable);
    sectionTasks.forEach((t, index) => {
      sectionTbody.appendChild(renderTaskRow(t, startIndex + index));
    });
    container.appendChild(sectionWrapper);

    return startIndex + sectionTasks.length;
  };

  // Render sections in order: started, overdue, ready
  // Use displayIndex (which includes checklist members) not tasks.length
  let nextIndex = displayIndex;
  nextIndex = renderSection(started, "started", nextIndex);
  nextIndex = renderSection(overdue, "overdue", nextIndex);
  nextIndex = renderSection(ready, "ready", nextIndex);

  const footer = document.createElement("div");
  footer.style.fontSize = "0.8em";
  footer.style.color = "var(--base01)";

  // Build footer text
  const parts = [];
  if (tasks.length > 0) parts.push(`${tasks.length} today`);
  if (started.length > 0) parts.push(`${started.length} started`);
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (ready.length > 0) parts.push(`${ready.length} ready`);

  if (parts.length > 1) {
    footer.textContent = `${parts.join(" + ")} = ${totalTasks} tasks shown.`;
  } else {
    footer.textContent = `${totalTasks} tasks shown.`;
  }
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
