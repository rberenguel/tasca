export const generateUUID = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const parseDate = (str) => {
  if (!/^\d{8}$/.test(str)) return null;
  const y = parseInt(str.substring(0, 4));
  const m = parseInt(str.substring(4, 6)) - 1;
  const d = parseInt(str.substring(6, 8));
  const date = new Date(y, m, d);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
};

export const formatDate = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

export const addDays = (ts, days) => {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
};
export const addMonths = (ts, months) => {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
};

// Parse relative time like "7d", "1w", "2m" and return timestamp for (now - duration)
export const parseRelativeTime = (str) => {
  const match = str.match(/^(\d+)([dwm])$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const now = Date.now();
  if (unit === "d") return now - n * 24 * 60 * 60 * 1000;
  if (unit === "w") return now - n * 7 * 24 * 60 * 60 * 1000;
  if (unit === "m") return now - n * 30 * 24 * 60 * 60 * 1000; // approximate month
  return null;
};

// Calculate next recurrence dates based on recur pattern
// Returns { nextDue, nextWait, nextSched } or null if pattern not recognized
export const calculateNextRecurrence = (task) => {
  if (!task.recur || !task.due) return null;

  let nextDue = null;
  const recur = task.recur.toLowerCase();

  if (recur.startsWith("dai")) nextDue = addDays(task.due, 1);
  else if (recur.startsWith("wee")) nextDue = addDays(task.due, 7);
  else if (recur.startsWith("mon")) nextDue = addMonths(task.due, 1);
  else if (recur.startsWith("yea")) nextDue = addMonths(task.due, 12);

  if (!nextDue) return null;

  const result = { nextDue };

  // Preserve offset from due date for wait and sched
  if (task.wait) result.nextWait = nextDue - (task.due - task.wait);
  if (task.sched) result.nextSched = nextDue - (task.due - task.sched);

  return result;
};
