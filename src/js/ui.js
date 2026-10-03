import { getDaysRemaining, C, hasVirtualTag } from "./logic.js";
import { isChecklistParent } from "./commands-checklist.js";
import { formatDateHtml } from "./utils.js";
import { hasContext, formatContextDisplay, getContext } from "./context.js";
import { zippedUuids, wideColumns } from "./state.js";

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

const highlightBgMap = {
  yellow:  "rgba(181, 137,   0, 0.18)",
  orange:  "rgba(203,  75,  22, 0.18)",
  red:     "rgba(220,  50,  47, 0.18)",
  magenta: "rgba(211,  54, 130, 0.18)",
  violet:  "rgba(108, 113, 196, 0.18)",
  blue:    "rgba( 38, 139, 210, 0.18)",
  cyan:    "rgba( 42, 161, 152, 0.18)",
  green:   "rgba(133, 153,   0, 0.18)",
};

const highlightFgMap = {
  yellow:  "#b58900",
  orange:  "#cb4b16",
  red:     "#dc322f",
  magenta: "#d33682",
  violet:  "#6c71c4",
  blue:    "#268bd2",
  cyan:    "#2aa198",
  green:   "#859900",
};

const HIGHLIGHT_COLORS = ["yellow", "orange", "red", "magenta", "violet", "blue", "cyan", "green"];
const LONG_PRESS_MS = 500;

let highlightCallbackRef = null;
export const setHighlightCallback = (fn) => {
  highlightCallbackRef = fn;
};

const applyHighlight = (uuid, color) => {
  document.querySelectorAll(`tr[data-uuid="${uuid}"]`).forEach((tr) => {
    tr.style.backgroundColor = color ? (highlightBgMap[color] || "") : "";
    tr.dataset.highlight = color || "";
  });
  if (highlightCallbackRef) highlightCallbackRef(uuid, color);
};

const showHighlightPopup = (tr, uuid) => {
  const existing = document.getElementById("highlight-popup");
  if (existing) existing.remove();

  const rect = tr.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.id = "highlight-popup";
  const popupWidth = 220;
  const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
  const top = Math.min(rect.top, window.innerHeight - 50);
  popup.style.cssText = [
    "position:fixed",
    `top:${top}px`,
    `left:${left}px`,
    "z-index:1000",
    "background:var(--base02)",
    "border:1px solid var(--base01)",
    "border-radius:4px",
    "padding:5px 8px",
    "display:flex",
    "gap:6px",
    "align-items:center",
    "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
  ].join(";");

  const current = tr.dataset.highlight || "";
  HIGHLIGHT_COLORS.forEach((color) => {
    const swatch = document.createElement("span");
    swatch.style.cssText = [
      "width:16px",
      "height:16px",
      "border-radius:50%",
      `background:${highlightFgMap[color]}`,
      "cursor:pointer",
      "display:inline-block",
      `outline:2px solid ${color === current ? "var(--base1)" : "transparent"}`,
      "outline-offset:2px",
      "flex-shrink:0",
    ].join(";");
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.remove();
      applyHighlight(uuid, color);
    });
    popup.appendChild(swatch);
  });

  const clearBtn = document.createElement("span");
  clearBtn.textContent = "✕";
  clearBtn.style.cssText =
    "cursor:pointer;color:var(--base01);font-size:0.85em;padding:0 2px;margin-left:2px;";
  clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.remove();
    applyHighlight(uuid, null);
  });
  popup.appendChild(clearBtn);

  document.body.appendChild(popup);

  setTimeout(() => {
    const dismiss = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener("click", dismiss);
        document.removeEventListener("touchstart", dismiss);
      }
    };
    document.addEventListener("click", dismiss);
    document.addEventListener("touchstart", dismiss);
  }, 0);
};

const addLongPress = (el, uuid) => {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let suppressNextClick = false;

  el.addEventListener("click", (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopPropagation();
    }
  });

  const start = (e) => {
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    timer = setTimeout(() => {
      timer = null;
      suppressNextClick = true;
      showHighlightPopup(el, uuid);
    }, LONG_PRESS_MS);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const move = (e) => {
    const point = e.touches ? e.touches[0] : e;
    if (
      Math.abs(point.clientX - startX) > 5 ||
      Math.abs(point.clientY - startY) > 5
    )
      cancel();
  };

  el.addEventListener("mousedown", start);
  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("mousemove", move);
  el.addEventListener("touchmove", move, { passive: true });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
};

// Format text between backticks as inline code
export const formatInlineCode = (text) => {
  if (!text) return text;
  return text.replace(/`([^`]+)`/g, '<span class="inline-code">$1</span>');
};

// Format task description with inline code and priority-based effects
export const formatTaskDescription = (task) => {
  const formatted = formatInlineCode(task.description);
  if (task.priority === 100) {
    return `<span class="priority-100-text">${formatted}</span>`;
  } else if (task.priority === 500) {
    return `<span class="priority-500-text">${formatted}</span>`;
  } else if (task.priority === 1000) {
    return `<span class="priority-1000-text">${formatted}</span>`;
  }
  return formatted;
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

const renderZipExpansion = (t) => {
  const tr = document.createElement("tr");
  tr.className = "zip-expansion";

  const tdId = document.createElement("td");
  tr.appendChild(tdId);

  const tdContent = document.createElement("td");
  tdContent.colSpan = 2;
  tdContent.style.cssText =
    "padding: 1px 4px 6px 16px; color: var(--base01); font-size: 0.9em; line-height: 1.6;";

  (t.annotations || []).forEach((ann) => {
    const div = document.createElement("div");
    const date = new Date(ann.entry).toISOString().slice(0, 10);
    div.innerHTML = `<span style="opacity:0.5; margin-right:10px;">${date}</span>${formatInlineCode(ann.description)}`;
    tdContent.appendChild(div);
  });

  tr.appendChild(tdContent);
  return tr;
};

const renderCompactTaskRow = (t, index, allTasks, checklistSummary = null) => {
  const tr = document.createElement("tr");
  if (t.start && t.status === "pending") tr.className = "row-active";
  if (isChecklistParent(t)) tr.classList.add("checklist-parent-row");
  tr.dataset.uuid = t.uuid;
  tr.dataset.highlight = t.highlight || "";
  if (t.highlight && highlightBgMap[t.highlight])
    tr.style.backgroundColor = highlightBgMap[t.highlight];
  addLongPress(tr, t.uuid);

  const tdId = document.createElement("td");
  tdId.className = "row-id";
  tdId.textContent = index + 1;
  tr.appendChild(tdId);

  const tdDesc = document.createElement("td");
  tdDesc.className = "row-desc";

  if (isChecklistParent(t)) {
    const i = document.createElement("i");
    i.className = "ph-light ph-list-checks";
    i.style.marginRight = "5px";
    i.style.color = "var(--cyan)";
    tdDesc.appendChild(i);
  } else if (t.icon) {
    const i = document.createElement("i");
    i.className = iconClass(t.icon);
    i.style.marginRight = "5px";
    if (t.color?.icon && colorMap[t.color.icon]) {
      i.style.color = colorMap[t.color.icon];
    }
    tdDesc.appendChild(i);
  }

  const descSpan = document.createElement("span");
  descSpan.innerHTML = formatTaskDescription(t);
  tdDesc.appendChild(descSpan);

  if (checklistSummary) {
    tdDesc.appendChild(document.createTextNode(" "));
    const summarySpan = document.createElement("span");
    summarySpan.className = "checklist-summary";
    summarySpan.style.color = "var(--cyan)";
    summarySpan.style.fontSize = "0.9em";
    summarySpan.textContent = `(${checklistSummary.done}/${checklistSummary.total})`;
    tdDesc.appendChild(summarySpan);
  }

  if (t.url) {
    const a = document.createElement("a");
    a.href = t.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "task-link";
    a.style.marginLeft = "4px";
    a.innerHTML = '<i class="ph-light ph-link"></i>';
    tdDesc.appendChild(a);
  }

  if (t.project) {
    tdDesc.appendChild(document.createTextNode(" "));
    const projSpan = document.createElement("span");
    projSpan.innerHTML = formatProject(t.project);
    tdDesc.appendChild(projSpan);
  }

  if (t.due) {
    const daysCheck = getDaysRemaining(t.due, t.end || Date.now());
    tdDesc.appendChild(document.createTextNode(" "));
    const dateSpan = document.createElement("span");
    let cls = "date-far";
    if (t.end) {
      if (daysCheck < 0) cls = "date-urgent";
    } else {
      if (daysCheck < C.daysWarning) cls = "date-urgent";
      else if (daysCheck < C.daysSoon) cls = "date-soon";
    }
    dateSpan.className = `date-pill ${cls}`;
    dateSpan.textContent = `(${daysCheck}d)`;
    tdDesc.appendChild(dateSpan);
  }

  if (t.tags && t.tags.length > 0) {
    t.tags.forEach((tag) => {
      tdDesc.appendChild(document.createTextNode(" "));
      const tagSpan = document.createElement("span");
      tagSpan.className = "tag-pill";
      tagSpan.textContent = tag;
      tdDesc.appendChild(tagSpan);
    });
  }

  if (t.annotations && t.annotations.length > 0) {
    tdDesc.appendChild(document.createTextNode(" "));
    const annoSpan = document.createElement("span");
    annoSpan.className = "anno-count";
    annoSpan.textContent = `msg:${t.annotations.length}`;
    tdDesc.appendChild(annoSpan);
  }

  if (zippedUuids.has(t.uuid) && t.annotations && t.annotations.length > 0) {
    const zipDiv = document.createElement("div");
    zipDiv.style.cssText =
      "padding: 1px 4px 6px 0; color: var(--base01); font-size: 0.9em; line-height: 1.6;";
    t.annotations.forEach((ann) => {
      const div = document.createElement("div");
      const date = new Date(ann.entry).toISOString().slice(0, 10);
      div.innerHTML = `<span style="opacity:0.5; margin-right:10px;">${date}</span>${formatInlineCode(ann.description)}`;
      zipDiv.appendChild(div);
    });
    tdDesc.appendChild(zipDiv);
  }

  tr.appendChild(tdDesc);
  return tr;
};

const renderWideColumns = (
  container,
  tasks,
  allTasks,
  displayMapRef,
  checklistGroups,
  n,
) => {
  if (tasks.length === 0) {
    displayMapRef.value = [];
    const footer = document.createElement("div");
    footer.style.fontSize = "0.8em";
    footer.style.color = "var(--base01)";
    footer.textContent = "0 tasks shown.";
    container.appendChild(footer);
    return;
  }

  displayMapRef.value = tasks.map((t) => t.uuid);

  // Build all rows first so we can measure their rendered heights
  const rows = tasks.map((t, globalIndex) => {
    const group = checklistGroups.get(t.uuid);
    if (isChecklistParent(t) && group) {
      const done = group.doneMembers || 0;
      const total = (group.totalPending || 0) + done;
      return renderCompactTaskRow(t, globalIndex, allTasks, { done, total });
    }
    return renderCompactTaskRow(t, globalIndex, allTasks, null);
  });

  // Measure row heights inside #terminal-output at actual column width
  // so font inheritance and text wrapping match the real render
  const termEl = document.getElementById("terminal-output");
  const termWidth = termEl ? termEl.clientWidth : 800;
  const colWidth = Math.floor((termWidth - (n - 1) * 16) / n);

  const probeTable = document.createElement("table");
  probeTable.style.cssText = `position:absolute; visibility:hidden; width:${colWidth}px;`;
  const probeTbody = document.createElement("tbody");
  probeTable.appendChild(probeTbody);
  rows.forEach((tr) => probeTbody.appendChild(tr));
  const probeTarget = termEl || document.body;
  probeTarget.appendChild(probeTable);

  const rowHeights = rows.map((tr) => tr.offsetHeight || 24);

  probeTarget.removeChild(probeTable);

  // Available column height: viewport minus the terminal top offset (input bar etc.)
  const termTop = termEl ? termEl.getBoundingClientRect().top : 80;
  const emPx = termEl ? parseFloat(getComputedStyle(termEl).fontSize) : 16;
  const availableHeight = window.innerHeight - termTop - emPx * 3.7;

  // Greedily assign rows to columns based on cumulative height
  const colAssignments = Array.from({ length: n }, () => []);
  let col = 0;
  let colHeight = 0;
  rows.forEach((tr, i) => {
    if (col < n - 1 && colHeight + rowHeights[i] > availableHeight) {
      col++;
      colHeight = 0;
    }
    colAssignments[col].push(tr);
    colHeight += rowHeights[i];
  });

  const flexWrapper = document.createElement("div");
  flexWrapper.style.cssText = "display:flex; gap:16px; align-items:flex-start;";

  for (let c = 0; c < n; c++) {
    const colDiv = document.createElement("div");
    colDiv.style.cssText = "flex:1; min-width:0;";
    if (c < n - 1) {
      colDiv.style.borderRight = "1px solid var(--base02)";
      colDiv.style.paddingRight = "12px";
    }

    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    colAssignments[c].forEach((tr) => tbody.appendChild(tr));
    table.appendChild(tbody);
    colDiv.appendChild(table);
    flexWrapper.appendChild(colDiv);
  }

  container.appendChild(flexWrapper);

  const footer = document.createElement("div");
  footer.style.fontSize = "0.8em";
  footer.style.color = "var(--base01)";
  footer.textContent = `${tasks.length} tasks shown.`;
  container.appendChild(footer);
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

  if (wideColumns > 0 && !isTodayView) {
    const wideBanner = document.createElement("div");
    wideBanner.className = "wide-banner";
    wideBanner.textContent = `⊞ ${wideColumns} col`;
    container.appendChild(wideBanner);
    renderWideColumns(
      container,
      tasks,
      allTasks,
      displayMapRef,
      checklistGroups,
      wideColumns,
    );
    return print(container, false);
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
    descSpan.innerHTML = formatTaskDescription(t);
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
    tr.dataset.uuid = t.uuid;
    tr.dataset.highlight = t.highlight || "";
    if (t.highlight && highlightBgMap[t.highlight])
      tr.style.backgroundColor = highlightBgMap[t.highlight];
    addLongPress(tr, t.uuid);

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
    descSpan.innerHTML = formatTaskDescription(t);
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
      const daysCheck = getDaysRemaining(t.due, t.end || Date.now());
      if (!(isTodayView && daysCheck === 0)) {
        tdDesc.appendChild(document.createTextNode(" "));
        const dateSpan = document.createElement("span");
        let cls = "date-far";
        if (t.end) {
          // Done tasks: only show as urgent (red) if they were actually late
          if (daysCheck < 0) cls = "date-urgent";
        } else {
          // Pending tasks: show warnings for soon/urgent
          if (daysCheck < C.daysWarning) cls = "date-urgent";
          else if (daysCheck < C.daysSoon) cls = "date-soon";
        }
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
  [...overdue, ...started, ...ready].forEach((t) => displayOrder.push(t.uuid));
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
        if (zippedUuids.has(t.uuid)) tbody.appendChild(renderZipExpansion(t));
        // Render members
        group.members.forEach((member) => {
          tbody.appendChild(renderChecklistMemberRow(member, displayIndex));
          displayIndex++;
        });
      }
    } else {
      tbody.appendChild(renderTaskRow(t, displayIndex, null));
      displayIndex++;
      if (zippedUuids.has(t.uuid)) tbody.appendChild(renderZipExpansion(t));
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

  // Render sections in order: overdue, started, ready
  // Use displayIndex (which includes checklist members) not tasks.length
  let nextIndex = displayIndex;
  nextIndex = renderSection(overdue, "overdue", nextIndex);
  nextIndex = renderSection(started, "started", nextIndex);
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
