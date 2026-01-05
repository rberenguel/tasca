import { dbOps } from "./db.js";
import {
  calculateUrgency,
  hasVirtualTag,
  matchesProject,
  expandVirtualTagShorthand,
  C,
} from "./logic.js";
import { renderTable } from "./ui.js";
import { parseRelativeTime } from "./utils.js";
import {
  displayMapRef,
  iconResultsRef,
  setLastFilterArgs,
  setLastLimit,
  updateCache,
} from "./state.js";
import { mergeFilters, hasContext } from "./context.js";

export const runList = async (args, limit = Infinity) => {
  // Clear icon results so copy N works for tasks
  iconResultsRef.value = [];
  // Apply context filters
  const effectiveArgs = mergeFilters(args);
  setLastFilterArgs(effectiveArgs);
  setLastLimit(limit);

  // Pre-scan args to see if we can optimize
  let showWaiting = false,
    showDone = false;
  let forceAll = false;

  for (let token of effectiveArgs) {
    if (token.startsWith("!")) {
      const expanded = expandVirtualTagShorthand(token);
      const tag = expanded.substring(1).toUpperCase();
      if (["WAITING", "SCHEDULED", "RECURRING", "ALL"].includes(tag))
        showWaiting = true;
      if (["DONE", "COMPLETED"].includes(tag)) showDone = true;
    } else if (token.startsWith("sort:")) {
      // safe
    } else if (token.startsWith("pro:") || token.startsWith("p:")) {
      // safe
    } else if (token.startsWith("end:")) {
      forceAll = true; // might need completed tasks
    }
  }

  let all;
  if (!showDone && !forceAll) {
    // Optimization: fetch only pending if we don't need completed
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
    else if (token.startsWith("end:")) {
      const val = token.split(":")[1];
      endAfter = parseRelativeTime(val);
    } else if (token.startsWith("sort:")) {
      sortFields = token.split(":")[1].split(",");
    } else if (token.startsWith("!")) {
      const expanded = expandVirtualTagShorthand(token);
      const tag = expanded.substring(1).toUpperCase();
      if (["WAITING", "SCHEDULED", "RECURRING", "ALL"].includes(tag))
        showWaiting = true;
      if (["DONE", "COMPLETED"].includes(tag)) showDone = true;
      if (tag !== "ALL") fTags.push(expanded);
    } else search.push(token.toLowerCase());
  }

  // Start with appropriate base set
  let tasks = showDone
    ? all.filter((t) => t.status === "completed")
    : all.filter((t) => t.status === "pending");
  if (!showWaiting && !showDone)
    tasks = tasks.filter(
      (t) =>
        (!t.wait || t.wait <= Date.now()) &&
        (!t.sched || t.sched <= Date.now()),
    );
  if (fProj) tasks = tasks.filter((t) => matchesProject(t.project, fProj));
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
  if (search.length)
    tasks = tasks.filter((t) =>
      search.every((s) => t.description.toLowerCase().includes(s)),
    );
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, all, projects)));

  // Sorting
  if (sortFields) {
    const fieldMap = {
      start: "start",
      st: "start",
      end: "end",
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
        const isDate = ["start", "end", "due", "entry"].includes(mapped);
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
  } else {
    tasks.sort((a, b) => {
      const urgDiff = parseFloat(b.urgency) - parseFloat(a.urgency);
      if (urgDiff !== 0) return urgDiff;
      // Tiebreaker: older tasks first (FIFO within same urgency)
      return (a.entry || 0) - (b.entry || 0);
    });
  }

  // In "next" view (limit !== Infinity), hide tasks with negative urgency
  // But show all tasks when a context is set
  // Using C.ageThreshold to ensure consistency though logic mainly uses it for urgency
  if (limit !== Infinity && !hasContext()) {
    tasks = tasks.filter((t) => parseFloat(t.urgency) >= 0);
  }

  if (limit !== Infinity && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  renderTable(tasks, all, displayMapRef, projects);
};
