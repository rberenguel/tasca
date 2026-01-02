const { expect } = chai;

// We need to import modules to test them.
// Since test_tasca.js is loaded as module, we can import from src relative paths.
import {
  calculateUrgency,
  hasVirtualTag,
  matchesProject,
  getDaysRemaining,
} from "../src/js/logic.js";
import {
  generateUUID,
  addDays,
  addMonths,
  calculateNextRecurrence,
  parseDate,
  parseWaitTime,
  formatDate,
  formatDateOnly,
} from "../src/js/utils.js";

describe("Tasca Logic Tests", function () {
  describe("Urgency Calculation", function () {
    const now = Date.now();
    const Day = 86400000;

    it("should calculate base urgency correctly", function () {
      const t = { entry: now, tags: [] };
      const u = calculateUrgency(t, []);
      expect(parseFloat(u)).to.be.closeTo(0.0, 0.1);
    });

    it("should add urgency for priority", function () {
      const t = { entry: now, priority: 50, tags: [] }; // pri:50 * 0.12 = 6
      const u = calculateUrgency(t, []);
      expect(parseFloat(u)).to.be.closeTo(6.0, 0.1);
    });

    it("should add urgency for next tag", function () {
      const t = { entry: now, tags: ["next"] };
      const u = calculateUrgency(t, []);
      expect(parseFloat(u)).to.be.closeTo(15.0, 0.1);
    });

    it("should add urgency for due date (soon)", function () {
      const t = { entry: now, due: now + Day, tags: [] }; // due in 1 day
      const u = calculateUrgency(t, []);
      expect(parseFloat(u)).to.be.closeTo(12.0, 0.1);
    });

    it("should add urgency for due date (far)", function () {
      const t = { entry: now, due: now + 10 * Day, tags: [] }; // due in 10 days
      const u = calculateUrgency(t, []);
      expect(parseFloat(u)).to.be.closeTo(4.0, 0.1);
    });

    it("should give someday tasks low urgency with priority layered", function () {
      const t1 = { entry: now, tags: ["someday"] };
      const t2 = { entry: now, tags: ["someday"], priority: 50 };
      const u1 = parseFloat(calculateUrgency(t1, []));
      const u2 = parseFloat(calculateUrgency(t2, []));
      expect(u1).to.be.closeTo(-100.0, 0.1);
      expect(u2).to.be.closeTo(-94.0, 0.1); // -100 + 50*0.12 = -94
      expect(u2).to.be.greaterThan(u1);
    });

    it("should give reference project tasks low urgency with priority layered", function () {
      const projectsMeta = [{ name: "Books", tags: ["reference"] }];
      const t1 = { entry: now, project: "Books", tags: [] };
      const t2 = { entry: now, project: "Books", priority: 50, tags: [] };
      const u1 = parseFloat(calculateUrgency(t1, [], projectsMeta));
      const u2 = parseFloat(calculateUrgency(t2, [], projectsMeta));
      expect(u1).to.be.closeTo(-100.0, 0.1);
      expect(u2).to.be.closeTo(-94.0, 0.1); // -100 + 50*0.12 = -94
      expect(u2).to.be.greaterThan(u1);
    });

    it("should recognize ref as alias for reference tag", function () {
      const projectsMeta = [{ name: "Books", tags: ["ref"] }];
      const t = { entry: now, project: "Books", priority: 50, tags: [] };
      const u = parseFloat(calculateUrgency(t, [], projectsMeta));
      expect(u).to.be.closeTo(-94.0, 0.1);
    });

    it("should reduce urgency by 10 for routine tag", function () {
      const t1 = { entry: now, tags: [] };
      const t2 = { entry: now, tags: ["routine"] };
      const u1 = parseFloat(calculateUrgency(t1, []));
      const u2 = parseFloat(calculateUrgency(t2, []));
      expect(u2).to.be.closeTo(u1 - 10, 0.1);
    });

    it("should stack routine with other urgency factors", function () {
      const t = { entry: now, priority: 50, tags: ["routine"] }; // 50*0.12 - 10 = -4
      const u = parseFloat(calculateUrgency(t, []));
      expect(u).to.be.closeTo(-4.0, 0.1);
    });
  });

  describe("Project Filtering", function () {
    it("should match exact project", function () {
      expect(matchesProject("home", "home")).to.be.true;
    });

    it("should match subproject", function () {
      expect(matchesProject("home.kitchen", "home")).to.be.true;
    });

    it("should match deep subproject", function () {
      expect(matchesProject("home.kitchen.sink", "home")).to.be.true;
    });

    it("should NOT match partial string prefix", function () {
      expect(matchesProject("homework", "home")).to.be.false;
    });

    it("should NOT match if task has no project", function () {
      expect(matchesProject(null, "home")).to.be.false;
    });
  });

  describe("Virtual Tags", function () {
    const now = Date.now();
    const Day = 86400000;

    it("should identify +OVERDUE", function () {
      const t = {
        entry: now - 1000,
        due: now - Day,
        status: "pending",
        tags: [],
      };
      expect(hasVirtualTag(t, "+OVERDUE", [])).to.be.true;
    });

    it("should identify +WAITING", function () {
      const t = { entry: now, wait: now + Day, status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+WAITING", [])).to.be.true;
    });

    it("should identify +BLOCKED", function () {
      const depTask = { uuid: "u1", status: "pending" };
      const t = { entry: now, depends: ["u1"], status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+BLOCKED", [depTask])).to.be.true;
    });

    it("should identify +SCHEDULED", function () {
      const t = { entry: now, sched: now + Day, status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+SCHEDULED", [])).to.be.true;
    });

    it("should NOT identify +SCHEDULED for past sched date", function () {
      const t = { entry: now, sched: now - Day, status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+SCHEDULED", [])).to.be.false;
    });

    it("should identify +RECURRING", function () {
      const t = { entry: now, recur: "1w", status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+RECURRING", [])).to.be.true;
    });

    it("should NOT identify +RECURRING for non-recurring task", function () {
      const t = { entry: now, status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+RECURRING", [])).to.be.false;
    });

    it("should identify +REFERENCE for tasks in reference project", function () {
      const projectsMeta = [{ name: "Books", tags: ["reference"] }];
      const t = { entry: now, project: "Books", status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+REFERENCE", [], projectsMeta)).to.be.true;
      expect(hasVirtualTag(t, "+REF", [], projectsMeta)).to.be.true;
      expect(hasVirtualTag(t, "!refs", [], projectsMeta)).to.be.true;
    });

    it("should NOT identify +REFERENCE for tasks not in reference project", function () {
      const projectsMeta = [{ name: "Work", tags: [] }];
      const t = { entry: now, project: "Work", status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+REFERENCE", [], projectsMeta)).to.be.false;
    });

    it("should identify +ROUTINE for tasks with routine tag", function () {
      const t = { entry: now, status: "pending", tags: ["routine"] };
      expect(hasVirtualTag(t, "+ROUTINE", [])).to.be.true;
      expect(hasVirtualTag(t, "!routine", [])).to.be.true;
    });

    it("should NOT identify +ROUTINE for tasks without routine tag", function () {
      const t = { entry: now, status: "pending", tags: [] };
      expect(hasVirtualTag(t, "+ROUTINE", [])).to.be.false;
    });
  });

  describe("Days Remaining", function () {
    it("should return 1 for due tomorrow", function () {
      const n = Date.now();
      expect(getDaysRemaining(n + 86400000, n)).to.equal(1);
    });

    it("should return 0 for due today (later)", function () {
      const n = Date.now();
      expect(getDaysRemaining(n + 10000, n)).to.equal(0);
    });

    it("should return -1 for yesterday", function () {
      const n = Date.now();
      expect(getDaysRemaining(n - 86400000, n)).to.equal(-1);
    });

    it("should return correct days for future", function () {
      const n = Date.now();
      expect(getDaysRemaining(n + 86400000 * 5, n)).to.equal(5);
    });
  });
});

describe("Utils Tests", function () {
  it("should generate a UUID", function () {
    const uuid = generateUUID();
    expect(uuid).to.be.a("string");
    expect(uuid.length).to.equal(36);
  });

  describe("parseDate", function () {
    it("should parse YYYYMMDD format", function () {
      const result = parseDate("20250115");
      const d = new Date(result);
      expect(d.getFullYear()).to.equal(2025);
      expect(d.getMonth()).to.equal(0); // January
      expect(d.getDate()).to.equal(15);
    });

    it("should parse 'today'", function () {
      const result = parseDate("today");
      const d = new Date(result);
      const now = new Date();
      expect(d.getDate()).to.equal(now.getDate());
      expect(d.getMonth()).to.equal(now.getMonth());
    });

    it("should parse 'tod' abbreviation", function () {
      const result = parseDate("tod");
      expect(result).to.not.be.null;
    });

    it("should parse 'tomorrow'", function () {
      const result = parseDate("tomorrow");
      const d = new Date(result);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(d.getDate()).to.equal(tomorrow.getDate());
    });

    it("should parse 'tom' abbreviation", function () {
      const result = parseDate("tom");
      expect(result).to.not.be.null;
    });

    it("should parse Nd (days)", function () {
      const result = parseDate("3d");
      const d = new Date(result);
      const expected = new Date();
      expected.setDate(expected.getDate() + 3);
      expect(d.getDate()).to.equal(expected.getDate());
    });

    it("should parse Nw (weeks)", function () {
      const result = parseDate("2w");
      const d = new Date(result);
      const expected = new Date();
      expected.setDate(expected.getDate() + 14);
      expect(d.getDate()).to.equal(expected.getDate());
    });

    it("should parse Nm (months)", function () {
      const result = parseDate("1m");
      const d = new Date(result);
      const expected = new Date();
      expected.setMonth(expected.getMonth() + 1);
      expect(d.getMonth()).to.equal(expected.getMonth());
    });

    it("should be case-insensitive", function () {
      expect(parseDate("TODAY")).to.not.be.null;
      expect(parseDate("Tomorrow")).to.not.be.null;
      expect(parseDate("3D")).to.not.be.null;
    });

    it("should return null for invalid input", function () {
      expect(parseDate("invalid")).to.be.null;
      expect(parseDate("")).to.be.null;
      expect(parseDate(null)).to.be.null;
    });

    it("should set time to end of day", function () {
      const result = parseDate("today");
      const d = new Date(result);
      expect(d.getHours()).to.equal(23);
      expect(d.getMinutes()).to.equal(59);
    });

    it("should parse Nh (hours)", function () {
      const before = Date.now();
      const result = parseDate("3h");
      const after = Date.now();
      // Should be approximately 3 hours from now
      const expected = before + 3 * 60 * 60 * 1000;
      expect(result).to.be.at.least(expected - 1000);
      expect(result).to.be.at.most(after + 3 * 60 * 60 * 1000);
    });

    it("should parse HH:MM time-only format", function () {
      const result = parseDate("14:30");
      const d = new Date(result);
      expect(d.getHours()).to.equal(14);
      expect(d.getMinutes()).to.equal(30);
      expect(d.getSeconds()).to.equal(0);
    });

    it("should use tomorrow for HH:MM if time has passed", function () {
      // Use 00:01 which has almost certainly passed
      const result = parseDate("00:01");
      const d = new Date(result);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(d.getDate()).to.equal(tomorrow.getDate());
      expect(d.getHours()).to.equal(0);
      expect(d.getMinutes()).to.equal(1);
    });

    it("should parse date@HH:MM format", function () {
      const result = parseDate("tomorrow@09:30");
      const d = new Date(result);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(d.getDate()).to.equal(tomorrow.getDate());
      expect(d.getHours()).to.equal(9);
      expect(d.getMinutes()).to.equal(30);
    });

    it("should parse YYYYMMDD@HH:MM format", function () {
      const result = parseDate("20250615@18:00");
      const d = new Date(result);
      expect(d.getFullYear()).to.equal(2025);
      expect(d.getMonth()).to.equal(5); // June
      expect(d.getDate()).to.equal(15);
      expect(d.getHours()).to.equal(18);
      expect(d.getMinutes()).to.equal(0);
    });

    it("should parse relative day with time", function () {
      const result = parseDate("3d@14:00");
      const d = new Date(result);
      const expected = new Date();
      expected.setDate(expected.getDate() + 3);
      expect(d.getDate()).to.equal(expected.getDate());
      expect(d.getHours()).to.equal(14);
      expect(d.getMinutes()).to.equal(0);
    });
  });

  describe("parseWaitTime", function () {
    it("should extract hours and minutes from HH:MM", function () {
      const result = parseWaitTime("18:30");
      expect(result).to.not.be.null;
      expect(result.hours).to.equal(18);
      expect(result.minutes).to.equal(30);
    });

    it("should handle single digit hours", function () {
      const result = parseWaitTime("9:00");
      expect(result).to.not.be.null;
      expect(result.hours).to.equal(9);
      expect(result.minutes).to.equal(0);
    });

    it("should return null for non-time patterns", function () {
      expect(parseWaitTime("3d")).to.be.null;
      expect(parseWaitTime("tomorrow")).to.be.null;
      expect(parseWaitTime("20250115")).to.be.null;
      expect(parseWaitTime("3h")).to.be.null;
    });

    it("should return null for invalid times", function () {
      expect(parseWaitTime("25:00")).to.be.null;
      expect(parseWaitTime("12:60")).to.be.null;
    });
  });

  describe("formatDate", function () {
    it("should format end-of-day as date only", function () {
      const ts = new Date(2025, 0, 15, 23, 59, 59, 999).getTime();
      expect(formatDate(ts)).to.equal("20250115");
    });

    it("should include time when not end-of-day", function () {
      const ts = new Date(2025, 0, 15, 14, 30, 0).getTime();
      expect(formatDate(ts)).to.equal("20250115@14:30");
    });

    it("should show midnight as time", function () {
      const ts = new Date(2025, 0, 15, 0, 0, 0).getTime();
      expect(formatDate(ts)).to.equal("20250115@00:00");
    });
  });

  describe("formatDateOnly", function () {
    it("should always return date only", function () {
      const ts1 = new Date(2025, 0, 15, 23, 59, 59).getTime();
      const ts2 = new Date(2025, 0, 15, 14, 30, 0).getTime();
      expect(formatDateOnly(ts1)).to.equal("20250115");
      expect(formatDateOnly(ts2)).to.equal("20250115");
    });
  });

  describe("Date Utilities", function () {
    const Day = 86400000;

    it("addDays should add days correctly", function () {
      const base = new Date(2025, 0, 15, 12, 0, 0).getTime(); // Jan 15, 2025
      const result = addDays(base, 7);
      const resultDate = new Date(result);
      expect(resultDate.getDate()).to.equal(22);
      expect(resultDate.getMonth()).to.equal(0); // January
    });

    it("addDays should handle month boundary", function () {
      const base = new Date(2025, 0, 30, 12, 0, 0).getTime(); // Jan 30, 2025
      const result = addDays(base, 5);
      const resultDate = new Date(result);
      expect(resultDate.getDate()).to.equal(4);
      expect(resultDate.getMonth()).to.equal(1); // February
    });

    it("addMonths should add months correctly", function () {
      const base = new Date(2025, 0, 15, 12, 0, 0).getTime(); // Jan 15, 2025
      const result = addMonths(base, 1);
      const resultDate = new Date(result);
      expect(resultDate.getDate()).to.equal(15);
      expect(resultDate.getMonth()).to.equal(1); // February
    });

    it("addMonths should handle year boundary", function () {
      const base = new Date(2025, 11, 15, 12, 0, 0).getTime(); // Dec 15, 2025
      const result = addMonths(base, 2);
      const resultDate = new Date(result);
      expect(resultDate.getMonth()).to.equal(1); // February
      expect(resultDate.getFullYear()).to.equal(2026);
    });
  });
});

describe("Recurrence Tests", function () {
  const Day = 86400000;

  describe("Daily Recurrence", function () {
    it("should calculate next day for 1d recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15, 23, 59, 59).getTime(),
        recur: "1d",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(16);
    });

    it("should calculate 3 days for 3d recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "3d",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(18);
    });

    it("should accept legacy daily", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "daily",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
    });
  });

  describe("Weekly Recurrence", function () {
    it("should calculate next week for 1w recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "1w",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(22);
    });

    it("should calculate 2 weeks for 2w recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "2w",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(29);
    });

    it("should accept legacy weekly", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "weekly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
    });
  });

  describe("Monthly Recurrence", function () {
    it("should calculate next month for 1m recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "1m",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(15);
      expect(nextDue.getMonth()).to.equal(1); // February
    });

    it("should calculate 3 months for 3m recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "3m",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getMonth()).to.equal(3); // April
    });

    it("should accept legacy monthly", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "monthly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
    });
  });

  describe("Yearly Recurrence", function () {
    it("should calculate next year for 1y recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "1y",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getDate()).to.equal(15);
      expect(nextDue.getMonth()).to.equal(0); // January
      expect(nextDue.getFullYear()).to.equal(2026);
    });

    it("should calculate 2 years for 2y recurrence", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "2y",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      const nextDue = new Date(result.nextDue);
      expect(nextDue.getFullYear()).to.equal(2027);
    });

    it("should accept legacy yearly", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "yearly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
    });
  });

  describe("Wait Offset Preservation", function () {
    it("should preserve wait offset relative to due", function () {
      // Task due Jan 20, wait Jan 15 (5 days before due)
      const task = {
        due: new Date(2025, 0, 20).getTime(),
        wait: new Date(2025, 0, 15).getTime(),
        recur: "weekly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      expect(result.nextWait).to.not.be.undefined;

      // Next due is Jan 27, so next wait should be Jan 22 (still 5 days before)
      const nextDue = new Date(result.nextDue);
      const nextWait = new Date(result.nextWait);
      expect(nextDue.getDate()).to.equal(27);
      expect(nextWait.getDate()).to.equal(22);
    });

    it("should not include nextWait if task has no wait", function () {
      const task = {
        due: new Date(2025, 0, 20).getTime(),
        recur: "daily",
      };
      const result = calculateNextRecurrence(task);
      expect(result.nextWait).to.be.undefined;
    });

    it("should preserve waitTime for time-only waits", function () {
      // Task due Jan 20, waitTime 18:00 (time-only)
      const task = {
        due: new Date(2025, 0, 20, 23, 59, 59).getTime(),
        wait: new Date(2025, 0, 20, 18, 0, 0).getTime(),
        waitTime: { hours: 18, minutes: 0 },
        recur: "daily",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      expect(result.nextWait).to.not.be.undefined;
      expect(result.waitTime).to.deep.equal({ hours: 18, minutes: 0 });

      // Next due is Jan 21, wait should be Jan 21 at 18:00
      const nextWait = new Date(result.nextWait);
      expect(nextWait.getDate()).to.equal(21);
      expect(nextWait.getHours()).to.equal(18);
      expect(nextWait.getMinutes()).to.equal(0);
    });

    it("should use waitTime over offset when both present", function () {
      // waitTime should take precedence
      const task = {
        due: new Date(2025, 0, 20, 23, 59, 59).getTime(),
        wait: new Date(2025, 0, 19, 14, 30, 0).getTime(), // day before at 14:30
        waitTime: { hours: 14, minutes: 30 },
        recur: "weekly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;

      // Next due is Jan 27, wait should be Jan 27 at 14:30 (not Jan 26)
      const nextWait = new Date(result.nextWait);
      expect(nextWait.getDate()).to.equal(27);
      expect(nextWait.getHours()).to.equal(14);
      expect(nextWait.getMinutes()).to.equal(30);
    });
  });

  describe("Scheduled Offset Preservation", function () {
    it("should preserve sched offset relative to due", function () {
      // Task due Jan 20, sched Jan 10 (10 days before due)
      const task = {
        due: new Date(2025, 0, 20).getTime(),
        sched: new Date(2025, 0, 10).getTime(),
        recur: "monthly",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
      expect(result.nextSched).to.not.be.undefined;

      // Next due is Feb 20, so next sched should be Feb 10 (still 10 days before)
      const nextDue = new Date(result.nextDue);
      const nextSched = new Date(result.nextSched);
      expect(nextDue.getMonth()).to.equal(1); // February
      expect(nextSched.getMonth()).to.equal(1); // February
      expect(nextDue.getDate()).to.equal(20);
      expect(nextSched.getDate()).to.equal(10);
    });

    it("should not include nextSched if task has no sched", function () {
      const task = {
        due: new Date(2025, 0, 20).getTime(),
        recur: "daily",
      };
      const result = calculateNextRecurrence(task);
      expect(result.nextSched).to.be.undefined;
    });
  });

  describe("Edge Cases", function () {
    it("should return null if no recur pattern", function () {
      const task = { due: Date.now() };
      expect(calculateNextRecurrence(task)).to.be.null;
    });

    it("should return null if no due date", function () {
      const task = { recur: "daily" };
      expect(calculateNextRecurrence(task)).to.be.null;
    });

    it("should return null for unrecognized pattern", function () {
      const task = { due: Date.now(), recur: "biweekly" };
      expect(calculateNextRecurrence(task)).to.be.null;
    });

    it("should handle case-insensitive patterns", function () {
      const task = {
        due: new Date(2025, 0, 15).getTime(),
        recur: "DAILY",
      };
      const result = calculateNextRecurrence(task);
      expect(result).to.not.be.null;
    });

    it("should preserve both wait and sched together", function () {
      const task = {
        due: new Date(2025, 0, 20).getTime(),
        wait: new Date(2025, 0, 15).getTime(),
        sched: new Date(2025, 0, 10).getTime(),
        recur: "weekly",
      };
      const result = calculateNextRecurrence(task);
      expect(result.nextWait).to.not.be.undefined;
      expect(result.nextSched).to.not.be.undefined;
    });
  });
});
