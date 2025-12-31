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
  if (!str) return null;
  const s = str.toLowerCase();

  // Helper to set end of day
  const endOfDay = (date) => {
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  };

  // Relative keywords
  if (s === "today" || s === "tod") {
    return endOfDay(new Date());
  }
  if (s === "tomorrow" || s === "tom") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return endOfDay(d);
  }
  if (s === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return endOfDay(d);
  }

  // Relative: Nd (days), Nw (weeks), Nm (months)
  const relMatch = s.match(/^(\d+)([dwm])$/);
  if (relMatch) {
    const n = parseInt(relMatch[1]);
    const unit = relMatch[2];
    const d = new Date();
    if (unit === "d") d.setDate(d.getDate() + n);
    else if (unit === "w") d.setDate(d.getDate() + n * 7);
    else if (unit === "m") d.setMonth(d.getMonth() + n);
    return endOfDay(d);
  }

  // Absolute: YYYYMMDD
  if (/^\d{8}$/.test(str)) {
    const y = parseInt(str.substring(0, 4));
    const m = parseInt(str.substring(4, 6)) - 1;
    const day = parseInt(str.substring(6, 8));
    const date = new Date(y, m, day);
    return endOfDay(date);
  }

  return null;
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
// Supports: Nd (days), Nw (weeks), Nm (months), Ny (years)
// Also supports legacy: daily, weekly, monthly, yearly
// Returns { nextDue, nextWait, nextSched } or null if pattern not recognized
export const calculateNextRecurrence = (task) => {
  if (!task.recur || !task.due) return null;

  let nextDue = null;
  const recur = task.recur.toLowerCase();

  // New syntax: Nd, Nw, Nm, Ny
  const match = recur.match(/^(\d+)([dwmy])$/);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2];
    if (unit === "d") nextDue = addDays(task.due, n);
    else if (unit === "w") nextDue = addDays(task.due, n * 7);
    else if (unit === "m") nextDue = addMonths(task.due, n);
    else if (unit === "y") nextDue = addMonths(task.due, n * 12);
  }
  // Legacy syntax: daily, weekly, monthly, yearly
  else if (recur.startsWith("dai")) nextDue = addDays(task.due, 1);
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
