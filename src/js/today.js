import { calculateUrgency, matchesProject } from "./logic.js";
import { formatDateOnly } from "./utils.js";
import { isChecklistMember } from "./commands-checklist.js";

// Detect if args indicate a today view
export const isTodayViewFromArgs = (args) => {
  for (const token of args) {
    if (token.startsWith("!")) {
      const tag = token.substring(1).toUpperCase();
      if (tag === "TODAY" || tag === "T" || tag === "TOD") return true;
    }
  }
  return false;
};

// Apply project and search filters to a task
const matchesFilters = (task, filters) => {
  const { project, search } = filters;
  if (project && !matchesProject(task.project, project)) return false;
  if (
    search?.length &&
    !search.every((s) => task.description.toLowerCase().includes(s))
  )
    return false;
  return true;
};

// Sort tasks by order (ascending, nulls last), then urgency (descending)
export const sortTodayTasks = (tasks) => {
  return tasks.sort((a, b) => {
    // Order first (ascending, nulls/undefined last)
    const aOrder = a.order != null ? a.order : Infinity;
    const bOrder = b.order != null ? b.order : Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Then urgency (descending)
    const urgDiff = parseFloat(b.urgency) - parseFloat(a.urgency);
    if (urgDiff !== 0) return urgDiff;
    // Tiebreaker: older tasks first
    const entryDiff = (a.entry || 0) - (b.entry || 0);
    if (entryDiff !== 0) return entryDiff;
    return (a.uuid || "").localeCompare(b.uuid || "");
  });
};

// Collect main today tasks (due today)
export const collectTodayTasks = (
  allTasks,
  projects,
  { project, search, showWaiting = false },
) => {
  const today = formatDateOnly(Date.now());
  const tasks = allTasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (!t.due) return false;
    if (formatDateOnly(t.due) !== today) return false;
    // Apply filters
    if (!matchesFilters(t, { project, search })) return false;

    // In today view, hide checklist members if waiting for tomorrow+
    if (
      isChecklistMember(t) &&
      t.wait > Date.now() &&
      formatDateOnly(t.wait) > today
    )
      return false;

    return true;
  });
  // Calculate urgency
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, allTasks, projects)));
  return sortTodayTasks(tasks);
};

// Collect started tasks (active tasks not due today)
export const collectStartedTasks = (
  allTasks,
  projects,
  { project, search, today },
) => {
  const todayStr = today || formatDateOnly(Date.now());

  const tasks = allTasks.filter((t) => {
    if (!t.start || t.status !== "pending") return false;
    // Exclude tasks already due today (they appear in main section)
    if (t.due && formatDateOnly(t.due) === todayStr) return false;
    // Apply filters
    if (!matchesFilters(t, { project, search })) return false;

    // In today view, hide checklist members if waiting for tomorrow+
    if (
      isChecklistMember(t) &&
      t.wait > Date.now() &&
      formatDateOnly(t.wait) > todayStr
    )
      return false;

    return true;
  });
  // Calculate urgency
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, allTasks, projects)));
  return sortTodayTasks(tasks);
};

// Collect overdue tasks (past due, not started)
export const collectOverdueTasks = (
  allTasks,
  projects,
  { project, search, today },
) => {
  const todayStr = today || formatDateOnly(Date.now());
  const now = Date.now();

  const tasks = allTasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (!t.due) return false;
    if (formatDateOnly(t.due) >= todayStr) return false; // not overdue
    // Exclude if started (appears in started section)
    if (t.start) return false;
    // Respect waiting/scheduled
    if (t.wait && t.wait > now) return false;
    if (t.sched && t.sched > now) return false;
    // Apply filters
    if (!matchesFilters(t, { project, search })) return false;
    return true;
  });
  // Calculate urgency
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, allTasks, projects)));
  return sortTodayTasks(tasks);
};

// Collect ready tasks (wait ended today, not due today, not started, not overdue)
export const collectReadyTasks = (
  allTasks,
  projects,
  { project, search, today },
) => {
  const todayStr = today || formatDateOnly(Date.now());
  const now = Date.now();

  const tasks = allTasks.filter((t) => {
    if (t.status !== "pending") return false;
    if (!t.wait) return false;
    // Wait must have passed (not still waiting)
    if (t.wait > now) return false;
    // Wait date is today (just became available)
    if (formatDateOnly(t.wait) !== todayStr) return false;
    // Exclude if already in today (due today)
    if (t.due && formatDateOnly(t.due) === todayStr) return false;
    // Exclude if started (appears in started section)
    if (t.start) return false;
    // Exclude if overdue (appears in overdue section)
    if (t.due && formatDateOnly(t.due) < todayStr) return false;
    // Apply filters
    if (!matchesFilters(t, { project, search })) return false;
    return true;
  });
  // Calculate urgency
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, allTasks, projects)));
  return sortTodayTasks(tasks);
};
