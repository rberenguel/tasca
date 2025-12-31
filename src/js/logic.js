import { formatDate } from "./utils.js";

export const C = {
  next: 15.0,
  due: 12.0,
  blocking: 8.0,
  active: 4.0,
  blocked: -5.0,
  priority: { H: 6.0, M: 3.9, L: 1.8, B: -20.0 },
  age: 2.0,
  project: 1.0,
  someday: -100.0,
  reference: -100.0,
};

export const calculateUrgency = (t, allTasks, projectsMeta = []) => {
  if (t.wait && t.wait > Date.now()) return -10.0;
  // Someday tag - very low urgency (excluded from next)
  if (t.tags && t.tags.some((tag) => tag.toLowerCase() === "someday"))
    return C.someday;
  // Reference project - very low urgency (excluded from next)
  if (t.project && projectsMeta.length > 0) {
    const projMeta = projectsMeta.find((p) => p.name === t.project);
    if (
      projMeta?.tags?.some((tag) =>
        ["reference", "ref"].includes(tag.toLowerCase()),
      )
    )
      return C.reference;
  }
  let u = 0.0;
  if (t.tags && t.tags.includes("next")) u += C.next;
  if (t.start) u += C.active; // Started tasks get priority
  if (t.priority && C.priority[t.priority]) u += C.priority[t.priority];
  if (t.project) u += C.project;
  const ageDays = (Date.now() - t.entry) / (1000 * 60 * 60 * 24);
  u += ageDays > 100 ? C.age : (ageDays / 100) * C.age;
  if (t.due) {
    const daysLeft = (t.due - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 2) u += C.due;
    else if (daysLeft <= 14) u += C.due * (1 - (daysLeft - 2) / 12);
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

export const hasVirtualTag = (t, tag, allTasks) => {
  const now = Date.now();
  const tagClean = tag.replace(/^[!+]/, "").toUpperCase();
  if (tagClean === "OVERDUE")
    return t.due && t.due < now && t.status === "pending";
  if (tagClean === "TODAY")
    return t.due && formatDate(t.due) === formatDate(now);
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
    return t.tags?.some((tag) => tag.toLowerCase() === "someday");
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
  "sync",
  "unlink",
  "start",
  "st",
  "context",
  "ctx",
  "c",
  "calendar",
  "cal",
  "skip",
];

export const resolveCommand = (str) => {
  const matches = VALID_COMMANDS.filter((c) => c.startsWith(str));
  return matches.length === 1 ? matches[0] : null;
};
