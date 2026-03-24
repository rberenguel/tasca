import { dbOps } from "./db.js";
import {
  calculateUrgency,
  hasVirtualTag,
  matchesProject,
  expandVirtualTagShorthand,
  C,
} from "./logic.js";
import { renderTable, print } from "./ui.js";
import { handleStreams } from "./commands-streams.js";
import { parseRelativeTime, formatDateOnly } from "./utils.js";
import {
  displayMapRef,
  iconResultsRef,
  setLastFilterArgs,
  setLastLimit,
  updateCache,
} from "./state.js";
import { mergeFilters, hasContext } from "./context.js";
import {
  collectStartedTasks,
  collectOverdueTasks,
  collectReadyTasks,
  sortTodayTasks,
} from "./today.js";
import {
  isChecklistParent,
  isChecklistMember,
  getChecklistParentUuid,
} from "./commands-checklist.js";
import { fuzzySearchTasks } from "./search.js";
import { renderChainView } from "./commands-views.js";

export const runList = async (
  args,
  limit = Infinity,
  headerHtml = null,
  preserveFilter = false,
) => {
  // Clear icon results so copy N works for tasks
  iconResultsRef.value = [];

  // Detect if args contain filter terms (not just modifiers)
  // If filter terms present, bypass context to allow ad-hoc search
  const isModifier = (token) =>
    token.startsWith("sort:") ||
    token.startsWith("s:") ||
    token.startsWith("lim:") ||
    token.startsWith("l:");
  const hasFilterTerms = args.some((token) => !isModifier(token));

  // Apply context filters only if no filter terms present
  const effectiveArgs = hasFilterTerms ? args : mergeFilters(args);
  if (!preserveFilter) {
    setLastFilterArgs(effectiveArgs);
    setLastLimit(limit);
  }

  // Pre-scan args to see if we can optimize
  let showWaiting = false,
    showDone = false,
    showSkipped = false;
  let forceAll = false;
  let isTodayView = false;
  let isStreamView = false;

  // Check effectiveArgs for virtual tags (works from both command and context)
  let showModified = false;
  for (let token of effectiveArgs) {
    if (token.startsWith("!")) {
      const expanded = expandVirtualTagShorthand(token);
      const tag = expanded.substring(1).toUpperCase();
      if (["WAITING", "SCHEDULED", "RECURRING", "ALL"].includes(tag))
        showWaiting = true;
      if (["DONE", "COMPLETED", "ENDED"].includes(tag)) showDone = true;
      if (["SKIPPED", "ENDED"].includes(tag)) showSkipped = true;
      if (tag === "TODAY") isTodayView = true;
      if (tag === "STREAM") isStreamView = true;
      if (tag === "MODIFIED") {
        showModified = true;
        showWaiting = true;
        showDone = true;
        showSkipped = true;
        forceAll = true;
      }
    } else if (token.startsWith("end:")) {
      forceAll = true; // might need completed tasks
    }
  }

  // Stream view: delegate to custom renderer (context already persisted above)
  if (isStreamView) {
    await handleStreams([], print);
    return;
  }

  // Check original args (not context) for search terms - ad-hoc search should find waiting tasks
  for (let token of args) {
    if (
      !token.startsWith("!") &&
      !token.startsWith("sort:") &&
      !token.startsWith("s:") &&
      !token.startsWith("pro:") &&
      !token.startsWith("p:") &&
      !token.startsWith("proj:") &&
      !token.startsWith("project:") &&
      !token.startsWith("end:") &&
      !token.startsWith("lim:")
    ) {
      // Search term in direct command - include waiting/scheduled tasks
      showWaiting = true;
      break;
    }
  }

  let all;
  if (!showDone && !showSkipped && !forceAll) {
    // Optimization: fetch only pending if we don't need completed/skipped
    all = await dbOps.getByStatus("pending");
    // We might need to fetch waiting/scheduled? No, they are "pending" in status, usually.
    // Wait, let's verify if "waiting" tasks have status="pending".
    // DB schema has status index. logic.js says WAITING regex returns t.wait > now && t.status === "pending".
    // So yes, pending includes waiting/scheduled.
  } else {
    all = await dbOps.getAll();
  }

  updateCache(all);
  const projects = await dbOps.getAllProjects();
  let search = [],
    fProj = null,
    fTarget = null,
    fTags = [],
    endAfter = null,
    sortFields = null;
  // showWaiting/showDone already init above

  for (let token of effectiveArgs) {
    if (
      token.startsWith("p:") ||
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      fProj = token.split(":")[1];
    else if (token.startsWith("x:") || token.startsWith("target:")) {
      fTarget = token.split(":")[1];
    } else if (token.startsWith("end:")) {
      const val = token.split(":")[1];
      endAfter = parseRelativeTime(val);
    } else if (token.startsWith("sort:") || token.startsWith("s:")) {
      sortFields = token.split(":")[1].split(",");
    } else if (token.startsWith("!")) {
      const expanded = expandVirtualTagShorthand(token);
      const tag = expanded.substring(1).toUpperCase();
      if (["WAITING", "SCHEDULED", "RECURRING", "ALL"].includes(tag))
        showWaiting = true;
      if (["DONE", "COMPLETED", "ENDED"].includes(tag)) showDone = true;
      if (["SKIPPED", "ENDED"].includes(tag)) showSkipped = true;
      if (tag !== "ALL" && tag !== "MODIFIED") fTags.push(expanded);
    } else search.push(token.toLowerCase());
  }

  // Start with appropriate base set
  // Start with appropriate base set
  let tasks = showModified
    ? all // modified shows all tasks regardless of status
    : all.filter((t) => {
        if (showDone && showSkipped)
          return t.status === "completed" || t.status === "skipped";
        if (showDone) return t.status === "completed";
        if (showSkipped) return t.status === "skipped";
        return t.status === "pending";
      });
  if (!showWaiting && !showDone) {
    const today = formatDateOnly(Date.now());
    tasks = tasks.filter((t) => {
      // In today view, include waiting tasks that are due today
      if (isTodayView && t.due && formatDateOnly(t.due) === today) {
        if (
          isChecklistMember(t) &&
          t.wait > Date.now() &&
          formatDateOnly(t.wait) > today
        )
          return false;
        return true;
      }
      // Otherwise apply normal waiting/scheduled filter
      return (
        (!t.wait || t.wait <= Date.now()) && (!t.sched || t.sched <= Date.now())
      );
    });
  }
  // Exclude stream tasks from list by default; next (limit !== Infinity) keeps them (they sink to bottom)
  if (!isStreamView && limit === Infinity) {
    tasks = tasks.filter(
      (t) => !t.tags?.some((tg) => tg.toLowerCase() === "stream"),
    );
  }

  if (fProj) tasks = tasks.filter((t) => matchesProject(t.project, fProj));
  if (fTarget) tasks = tasks.filter((t) => t.target === fTarget);
  if (endAfter) tasks = tasks.filter((t) => t.end && t.end >= endAfter);
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
  if (showModified) {
    const lastSave = await dbOps.getSetting("lastSave");
    if (lastSave) {
      tasks = tasks.filter((t) => t.modified && t.modified > lastSave);
    }
    // If never saved, all tasks are "modified"
  }

  // Calculate urgency before search filtering (needed for relevance ranking)
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, all, projects)));

  // Apply fuzzy search if search terms present
  if (search.length) {
    tasks = fuzzySearchTasks(tasks, search);
  }

  // Sorting
  if (sortFields) {
    const fieldMap = {
      start: "start",
      st: "start",
      end: "end",
      e: "end",
      pri: "priority",
      priority: "priority",
      pro: "project",
      project: "project",
      due: "due",
      urg: "urgency",
      urgency: "urgency",
      desc: "description",
      description: "description",
      alpha: "description",
      entry: "entry",
      create: "entry",
      created: "entry",
      c: "entry",
      modified: "modified",
      mod: "modified",
      m: "modified",
    };
    tasks.sort((a, b) => {
      for (const field of sortFields) {
        const desc = field.startsWith("-");
        const key = desc ? field.slice(1) : field;
        const mapped = fieldMap[key] || key;
        let av = a[mapped],
          bv = b[mapped];
        // Treat non-numeric priorities as null for sorting
        if (mapped === "priority") {
          if (typeof av !== "number") av = null;
          if (typeof bv !== "number") bv = null;
        }
        const isDate = ["start", "end", "due", "entry", "modified"].includes(
          mapped,
        );
        const isNum = ["urgency", "priority"].includes(mapped) || isDate;
        let dir = isDate || mapped === "priority" ? -1 : 1;
        if (desc) dir = -dir;
        if (av == null && bv == null) continue;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (isNum) {
          const diff = (parseFloat(av) - parseFloat(bv)) * dir;
          if (diff !== 0) return diff;
        } else {
          const cmp = String(av).localeCompare(String(bv)) * dir;
          if (cmp !== 0) return cmp;
        }
      }
      return 0;
    });
  } else if (isTodayView) {
    // Today view: sort by order (ascending, nulls last), then urgency
    sortTodayTasks(tasks);
  } else {
    tasks.sort((a, b) => {
      const urgDiff = parseFloat(b.urgency) - parseFloat(a.urgency);
      if (urgDiff !== 0) return urgDiff;
      // Tiebreaker: older tasks first (FIFO within same urgency)
      const entryDiff = (a.entry || 0) - (b.entry || 0);
      if (entryDiff !== 0) return entryDiff;
      // Final tiebreaker: UUID for deterministic order when entry times match
      return (a.uuid || "").localeCompare(b.uuid || "");
    });
  }

  // In "next" view (limit !== Infinity), hide tasks with negative urgency
  // (blocked, someday, reference, etc.) - these are not actionable
  // Exceptions: today waiting tasks, and streams (appear at bottom via -1000 urgency)
  if (limit !== Infinity) {
    const today = formatDateOnly(Date.now());
    tasks = tasks.filter((t) => {
      if (parseFloat(t.urgency) >= 0) return true;
      // Keep streams in next (they sink to the bottom)
      if (t.tags?.some((tg) => tg.toLowerCase() === "stream")) return true;
      // In today view, keep waiting tasks due today even with negative urgency
      if (isTodayView && t.due && formatDateOnly(t.due) === today) return true;
      return false;
    });
  }

  if (limit !== Infinity && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  // In today view, collect additional sections
  let sections = { started: [], overdue: [], ready: [] };
  // Only show sections for pending tasks (standard dashboard view)
  // If showing done tasks, we want a flat list
  if (isTodayView && !showDone) {
    const filterOpts = { project: fProj, search };
    sections.started = collectStartedTasks(all, projects, filterOpts);
    sections.overdue = collectOverdueTasks(all, projects, filterOpts);
    sections.ready = collectReadyTasks(all, projects, filterOpts);
  }

  // Group checklist members under their parents
  // In "next" view (limited, not today), show summary; in full view or today, expand members
  const isNextView = limit !== Infinity && limit > 0 && !isTodayView;
  const checklistGroups = new Map(); // parentUuid -> { parent, members: [] }

  // Separate parents, members, and regular tasks
  const parentTasks = tasks.filter((t) => isChecklistParent(t));
  const memberTasks = tasks.filter((t) => isChecklistMember(t));
  const regularTasks = tasks.filter(
    (t) => !isChecklistParent(t) && !isChecklistMember(t),
  );

  // Collect parent UUIDs from both: parents in filtered list AND parents of members in filtered list
  const parentUuidsToShow = new Set();

  // Parents that passed the filter
  for (const parent of parentTasks) {
    parentUuidsToShow.add(parent.uuid);
  }

  // Parents of members that passed the filter (even if parent didn't pass filter)
  for (const member of memberTasks) {
    const parentUuid = getChecklistParentUuid(member);
    if (parentUuid) parentUuidsToShow.add(parentUuid);
  }

  // Build checklist groups - fetch ALL pending members from `all`, not just filtered ones
  for (const parentUuid of parentUuidsToShow) {
    let parent = parentTasks.find((t) => t.uuid === parentUuid);
    if (!parent) {
      parent = all.find((t) => t.uuid === parentUuid);
    }
    if (!parent) continue;

    // Calculate urgency for parent if not set
    if (!parent.urgency) {
      parent.urgency = calculateUrgency(parent, all, projects);
    }

    // Fetch ALL pending members for this parent (not just filtered ones)
    let allPendingMembers = all.filter(
      (t) => t.checklist === parentUuid && t.status === "pending",
    );

    // In Today view, hide members waiting for future dates (tomorrow+)
    if (isTodayView) {
      const now = Date.now();
      const todayStr = formatDateOnly(now);
      allPendingMembers = allPendingMembers.filter((t) => {
        if (t.wait && t.wait > now && formatDateOnly(t.wait) > todayStr)
          return false;
        if (t.sched && t.sched > now && formatDateOnly(t.sched) > todayStr)
          return false;
        return true;
      });
    }

    // Calculate urgency for members
    allPendingMembers.forEach((m) => {
      if (!m.urgency) m.urgency = calculateUrgency(m, all, projects);
    });

    // Sort by order
    allPendingMembers.sort((a, b) => (a.order || 999) - (b.order || 999));

    // Count for summary view
    const doneMembers = all.filter(
      (t) => t.checklist === parentUuid && t.status === "completed",
    ).length;

    checklistGroups.set(parentUuid, {
      parent,
      members: allPendingMembers,
      totalPending: allPendingMembers.length,
      doneMembers,
    });
  }

  // Regular tasks only (parents and members handled via checklistGroups)
  const filteredTasks = regularTasks;

  // Add parent tasks back in their urgency order position
  const tasksWithChecklists = [...filteredTasks];
  for (const group of checklistGroups.values()) {
    tasksWithChecklists.push(group.parent);
  }

  // Re-sort to maintain order (urgency or today sort)
  if (isTodayView) {
    sortTodayTasks(tasksWithChecklists);
  } else if (!sortFields) {
    tasksWithChecklists.sort((a, b) => {
      const urgDiff = parseFloat(b.urgency) - parseFloat(a.urgency);
      if (urgDiff !== 0) return urgDiff;
      const entryDiff = (a.entry || 0) - (b.entry || 0);
      if (entryDiff !== 0) return entryDiff;
      return (a.uuid || "").localeCompare(b.uuid || "");
    });
  }

  renderTable(
    tasksWithChecklists,
    all,
    displayMapRef,
    projects,
    headerHtml,
    isTodayView,
    sections,
    checklistGroups,
    isNextView,
  );

  // Auto-show chain if all tasks are part of dependency chains
  await autoShowChainIfRelevant(tasksWithChecklists, all);
};

// Helper to check if all tasks are part of dependency chains
const autoShowChainIfRelevant = async (tasks, allTasks) => {
  // Skip if no tasks or showing done/skipped tasks
  if (tasks.length === 0) return;
  if (tasks.some((t) => t.status !== "pending")) return;

  // Build blocking map to check if tasks are in chains
  const blocking = {};
  allTasks
    .filter((t) => t.status === "pending")
    .forEach((t) => {
      if (t.depends) {
        t.depends.forEach((dep) => {
          if (!blocking[dep]) blocking[dep] = [];
          blocking[dep].push(t.uuid);
        });
      }
    });

  // Check if ALL displayed tasks are part of dependency chains
  const allInChain = tasks.every((t) => {
    const hasDepends = t.depends && t.depends.length > 0;
    const isBlocking = blocking[t.uuid] && blocking[t.uuid].length > 0;
    return hasDepends || isBlocking;
  });

  if (!allInChain) return;

  // Render chain view for all tasks - preserve original display map
  const originalDisplayMap = [...displayMapRef.value];
  const pending = allTasks.filter((t) => t.status === "pending");
  const startingUuids = tasks.map((t) => t.uuid);
  const wrapperStyle =
    "margin-top: 16px; border-top: 1px solid var(--base01); padding-top: 8px; line-height: 1.5; font-family: monospace;";

  const chainHtml =
    '<div style="color: var(--base01); margin-bottom: 8px;">Dependencies:</div>' +
    renderChainView(pending, startingUuids, null, wrapperStyle);

  print(chainHtml, true); // APPEND, don't replace

  // Restore original display map so task IDs remain correct
  displayMapRef.value = originalDisplayMap;
};
