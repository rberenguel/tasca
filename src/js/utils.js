export const generateUUID = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Helper to set specific time on a date
const setTime = (date, hours, minutes) => {
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
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

  // Relative hours: Nh (e.g., 3h = 3 hours from now)
  const hourMatch = s.match(/^(\d+)h$/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    return Date.now() + hours * 60 * 60 * 1000;
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

  // Time-only: HH:MM (e.g., 18:00 = 6pm today, or tomorrow if past)
  const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const hours = parseInt(timeOnlyMatch[1]);
    const minutes = parseInt(timeOnlyMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const d = new Date();
      const targetTime = setTime(new Date(), hours, minutes);
      // If time has passed today, use tomorrow
      if (targetTime <= Date.now()) {
        d.setDate(d.getDate() + 1);
      }
      return setTime(d, hours, minutes);
    }
  }

  // Date with time: date@HH:MM (e.g., today@18:00, tomorrow@09:00, 3d@14:00, 20250115@10:30)
  const dateTimeMatch = str.match(/^(.+)@(\d{1,2}):(\d{2})$/);
  if (dateTimeMatch) {
    const datePart = dateTimeMatch[1];
    const hours = parseInt(dateTimeMatch[2]);
    const minutes = parseInt(dateTimeMatch[3]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      // Recursively parse the date part (without time)
      const baseTimestamp = parseDate(datePart);
      if (baseTimestamp) {
        const d = new Date(baseTimestamp);
        return setTime(d, hours, minutes);
      }
    }
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

// Extract time-only pattern from a wait string (for recurrence preservation)
// Returns { hours, minutes } if it's a time-only pattern, null otherwise
export const parseWaitTime = (str) => {
  if (!str) return null;
  const timeOnlyMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnlyMatch) {
    const hours = parseInt(timeOnlyMatch[1]);
    const minutes = parseInt(timeOnlyMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }
  return null;
};

// Format date for display - includes time if not end-of-day
export const formatDate = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = `${y}${m}${day}`;

  // Include time if not at end-of-day (23:59:59)
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  if (hours === 23 && minutes === 59 && seconds === 59) {
    return dateStr;
  }
  // Show time component
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${dateStr}@${hh}:${mm}`;
};

// Format date only (YYYYMMDD) - for comparisons
export const formatDateOnly = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

// Format date with HTML styling - dimmed @ and time
export const formatDateHtml = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = `${y}${m}${day}`;

  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  if (hours === 23 && minutes === 59 && seconds === 59) {
    return dateStr;
  }
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `<span style="filter: hue-rotate(90deg) brightness(1.3)">${dateStr}</span>@<span style="filter: hue-rotate(90deg) brightness(1.3)">${hh}:${mm}</span>`;
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
  // Handle "today" explicitly
  if (str.toLowerCase() === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const match = str.match(/^(\d+)([dwm])$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  // Use start-of-day boundaries for cleaner semantics
  // 0d = start of today, 1d = start of yesterday, etc.
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (unit === "d") return d.getTime() - n * 24 * 60 * 60 * 1000;
  if (unit === "w") return d.getTime() - n * 7 * 24 * 60 * 60 * 1000;
  if (unit === "m") return d.getTime() - n * 30 * 24 * 60 * 60 * 1000; // approximate month
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

  // Preserve wait: either time-only (waitTime) or offset from due date
  if (task.waitTime) {
    // Time-only wait: apply same time to next due date
    const nextDueDate = new Date(nextDue);
    nextDueDate.setHours(task.waitTime.hours, task.waitTime.minutes, 0, 0);
    result.nextWait = nextDueDate.getTime();
    result.waitTime = task.waitTime; // preserve for future recurrences
  } else if (task.wait) {
    // Offset-based wait: preserve offset from due date
    result.nextWait = nextDue - (task.due - task.wait);
  }

  if (task.sched) result.nextSched = nextDue - (task.due - task.sched);

  return result;
};
