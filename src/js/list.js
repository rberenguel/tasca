import { dbOps } from "./db.js";
import { calculateUrgency, hasVirtualTag, matchesProject } from "./logic.js";
import { renderTable } from "./ui.js";
import { parseRelativeTime } from "./utils.js";
import { displayMapRef, setLastFilterArgs, setLastLimit } from "./state.js";
import { mergeFilters } from "./context.js";

export const runList = async (args, limit = Infinity) => {
  // Apply context filters
  const effectiveArgs = mergeFilters(args);
  setLastFilterArgs(effectiveArgs);
  setLastLimit(limit);
  const all = await dbOps.getAll();
  const projects = await dbOps.getAllProjects();
  let search = [],
    fProj = null,
    fTags = [],
    endAfter = null,
    sortFields = null;
  let showWaiting = false,
    showDone = false;

  for (let token of effectiveArgs) {
    if (
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
      const tag = token.substring(1).toUpperCase();
      if (tag === "WAITING" || tag === "SCHEDULED" || tag === "ALL")
        showWaiting = true;
      if (tag === "DONE" || tag === "COMPLETED") showDone = true;
      if (tag !== "ALL") fTags.push(token);
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
        if (hasVirtualTag(t, ft, all)) return true;
        return false;
      }),
    );
  }
  if (search.length)
    tasks = tasks.filter((t) =>
      search.every((s) => t.description.toLowerCase().includes(s)),
    );
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, all)));

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
    };
    const priOrder = { H: 3, M: 2, L: 1 };
    tasks.sort((a, b) => {
      for (const field of sortFields) {
        const desc = field.startsWith("-");
        const key = desc ? field.slice(1) : field;
        const mapped = fieldMap[key] || key;
        let av = a[mapped],
          bv = b[mapped];
        if (mapped === "priority") {
          av = priOrder[av] || 0;
          bv = priOrder[bv] || 0;
        }
        const isDate = ["start", "end", "due", "entry"].includes(mapped);
        const isNum = ["urgency"].includes(mapped) || isDate;
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
    tasks.sort((a, b) => parseFloat(b.urgency) - parseFloat(a.urgency));
  }

  if (limit !== Infinity && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  renderTable(tasks, all, displayMapRef, projects);
};
