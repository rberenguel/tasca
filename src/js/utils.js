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
