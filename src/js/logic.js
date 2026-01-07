import { formatDateOnly } from "./utils.js";

export const C = {
  next: 15.0,
  due: 12.0,
  blocking: 8.0,
  active: 4.0,
  blocked: -20.0,
  priorityScale: 0.12, // pri:50 → 6 urgency (like old H)
  age: 2.0,
  project: 1.0,
  someday: -100.0,
  reference: -100.0,
  routine: -10.0,
  overdueScale: 1.5, // extra urgency per day overdue
  // Thresholds
  ageThreshold: 100,
  daysWarning: 2,
  daysSoon: 7,
  priHigh: 50,
  priMed: 25,
  priLow: 10,
};

export const calculateUrgency = (t, allTasks, projectsMeta = []) => {
  if (t.wait && t.wait > Date.now()) return -10.0;

  // Priority contribution (used for sorting within low-urgency categories)
  const priorityContrib =
    t.priority != null && typeof t.priority === "number"
      ? t.priority * C.priorityScale
      : 0;

  // Someday tag - very low urgency (excluded from next), but priority still affects sort
  if (t.tags && t.tags.some((tag) => tag.toLowerCase() === "someday"))
    return (C.someday + priorityContrib).toFixed(1);
  // Reference project - very low urgency (excluded from next), but priority still affects sort
  if (t.project && projectsMeta.length > 0) {
    const projMeta = projectsMeta.find((p) => p.name === t.project);
    if (
      projMeta?.tags?.some((tag) =>
        ["reference", "ref"].includes(tag.toLowerCase()),
      )
    )
      return (C.reference + priorityContrib).toFixed(1);
  }
  let u = 0.0;
  if (t.tags && t.tags.includes("next")) u += C.next;
  if (t.start) u += C.active; // Started tasks get priority
  if (t.priority != null && typeof t.priority === "number")
    u += t.priority * C.priorityScale;
  if (t.project) u += C.project;
  const ageDays = (Date.now() - t.entry) / (1000 * 60 * 60 * 24);
  u += ageDays > C.ageThreshold ? C.age : (ageDays / C.ageThreshold) * C.age;
  if (t.due) {
    const daysLeft = (t.due - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) {
      // Overdue: base due urgency + extra per day overdue
      const daysOverdue = Math.abs(daysLeft);
      u += C.due + daysOverdue * C.overdueScale;
    } else if (daysLeft <= C.daysWarning) {
      u += C.due;
    } else if (daysLeft <= 14) {
      u += C.due * (1 - (daysLeft - C.daysWarning) / 12);
    }
  }
  // Check blocking (t blocks o) - if any 'o' is pending and depends on 't'
  const isBlocking = allTasks.some(
    (o) => o.status === "pending" && o.depends?.includes(t.uuid),
  );
  if (isBlocking) u += C.blocking;

  // Check blocked (t depends on d) - if any 'd' is pending
  if (t.depends?.length > 0) {
    if (
      allTasks
        .filter((d) => t.depends.includes(d.uuid))
        .some((d) => d.status === "pending")
    )
      u += C.blocked;
  }

  // Routine tag reduces urgency but doesn't hide from next
  if (t.tags && t.tags.some((tag) => tag.toLowerCase() === "routine"))
    u += C.routine;

  return u.toFixed(1);
};

export const getDaysRemaining = (due, now = Date.now()) => {
  return Math.floor((due - now) / (1000 * 60 * 60 * 24));
};

export const matchesProject = (taskProj, filterProj) => {
  if (!filterProj) return true;
  if (!taskProj) return false;
  if (taskProj === filterProj) return true;
  return taskProj.startsWith(filterProj + ".");
};

const VIRTUAL_TAG_SHORTHANDS = {
  O: "OVERDUE",
  OD: "OVERDUE",
  OVER: "OVERDUE",
  T: "TODAY",
  TOD: "TODAY",
  W: "WAITING",
  WAIT: "WAITING",
  S: "SCHEDULED",
  SCH: "SCHEDULED",
  SCHED: "SCHEDULED",
  B: "BLOCKED",
  BLK: "BLOCKED",
  BLOCK: "BLOCKED",
  D: "DONE",
  A: "ACTIVE",
  ACT: "ACTIVE",
  R: "RECURRING",
  REC: "RECURRING",
  RECUR: "RECURRING",
  SD: "SOMEDAY",
  RT: "ROUTINE",
};

export const expandVirtualTagShorthand = (tag) => {
  const clean = tag.replace(/^[!+]/, "").toUpperCase();
  const expanded = VIRTUAL_TAG_SHORTHANDS[clean];
  if (expanded) {
    const prefix = tag.startsWith("!") ? "!" : tag.startsWith("+") ? "+" : "";
    return prefix + expanded.toLowerCase();
  }
  return tag;
};

export const hasVirtualTag = (t, tag, allTasks, projectsMeta = []) => {
  const now = Date.now();
  const tagClean = tag.replace(/^[!+]/, "").toUpperCase();
  if (tagClean === "OVERDUE")
    return t.due && t.due < now && t.status === "pending";
  if (tagClean === "TODAY")
    return t.due && formatDateOnly(t.due) === formatDateOnly(now);
  if (tagClean === "WAITING")
    return t.wait && t.wait > now && t.status === "pending";
  if (tagClean === "SCHEDULED")
    return t.sched && t.sched > now && t.status === "pending";
  if (tagClean === "BLOCKED")
    return (
      t.depends?.length > 0 &&
      allTasks
        .filter((d) => t.depends.includes(d.uuid))
        .some((d) => d.status === "pending")
    );
  if (tagClean === "DONE" || tagClean === "COMPLETED")
    return t.status === "completed";
  if (tagClean === "ACTIVE" || tagClean === "STARTED")
    return t.start && t.status === "pending";
  if (tagClean === "RECURRING" || tagClean === "RECUR")
    return !!t.recur && t.status === "pending";
  if (tagClean === "SOMEDAY")
    return t.tags?.some((tg) => tg.toLowerCase() === "someday");
  if (tagClean === "ROUTINE")
    return t.tags?.some((tg) => tg.toLowerCase() === "routine");
  if (["REF", "REFS", "REFERENCE", "REFERENCES"].includes(tagClean)) {
    if (!t.project || projectsMeta.length === 0) return false;
    const projMeta = projectsMeta.find((p) => p.name === t.project);
    return (
      projMeta?.tags?.some((tag) =>
        ["reference", "ref"].includes(tag.toLowerCase()),
      ) ?? false
    );
  }
  return false;
};

export const VALID_COMMANDS = [
  "add",
  "a",
  "log",
  "list",
  "ls",
  "l",
  "next",
  "done",
  "delete",
  "rm",
  "modify",
  "mod",
  "edit",
  "ed",
  "export",
  "exp",
  "import",
  "imp",
  "help",
  "clear",
  "annotate",
  "info",
  "i",
  "chain",
  "projects",
  "proj",
  "about",
  "link",
  "load",
  "save",
  "unlink",
  "start",
  "st",
  "context",
  "ctx",
  "c",
  "calendar",
  "cal",
  "skip",
  "report",
  "rep",
  "dependencies",
  "tree",
  "copy",
  "cp",
  "paste",
  "undo",
  "icon",
];

export const resolveCommand = (str) => {
  const matches = VALID_COMMANDS.filter((c) => c.startsWith(str));
  return matches.length === 1 ? matches[0] : null;
};
