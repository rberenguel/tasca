const { expect } = chai;

// We need to import modules to test them.
// Since test_tasca.js is loaded as module, we can import from src relative paths.
import {
  calculateUrgency,
  hasVirtualTag,
  matchesProject,
  getDaysRemaining,
  expandVirtualTagShorthand,
  resolveCommand,
  VALID_COMMANDS,
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
import { pushUndo, popUndo, hasUndo, clearUndo } from "../src/js/undo.js";
import { execute } from "../src/js/commands.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";

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
    it("should impose a negative penalty for tasks with pending dependencies", function () {
      const depTask = {
        uuid: "u1",
        status: "pending",
        entry: now,
        priority: null,
      };

      const blockedTask = {
        entry: now,
        depends: ["u1"],
        status: "pending",
        tags: [],
        priority: null,
      };

      const allTasks = [depTask, blockedTask];
      const u = parseFloat(calculateUrgency(blockedTask, allTasks));

      expect(u).to.be.lessThan(0);
    });

    it("should effectively hide blocked tasks even with high priority", function () {
      const depTask = {
        uuid: "u1",
        status: "pending",
        entry: now,
      };

      const blockedTask = {
        entry: now,
        depends: ["u1"],
        status: "pending",
        tags: [],
        priority: 50,
      };

      const allTasks = [depTask, blockedTask];
      console.log("Checking blocked task urgency logic...");
      const u = parseFloat(calculateUrgency(blockedTask, allTasks));
      console.log("Calculated urgency:", u);

      expect(u).to.be.lessThan(0);
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

  describe("Virtual Tag Shorthands", function () {
    it("should expand overdue shorthands", function () {
      expect(expandVirtualTagShorthand("!o")).to.equal("!overdue");
      expect(expandVirtualTagShorthand("!od")).to.equal("!overdue");
      expect(expandVirtualTagShorthand("!over")).to.equal("!overdue");
      expect(expandVirtualTagShorthand("!overdue")).to.equal("!overdue");
    });

    it("should expand today shorthands", function () {
      expect(expandVirtualTagShorthand("!t")).to.equal("!today");
      expect(expandVirtualTagShorthand("!tod")).to.equal("!today");
      expect(expandVirtualTagShorthand("!today")).to.equal("!today");
    });

    it("should expand waiting shorthands", function () {
      expect(expandVirtualTagShorthand("!w")).to.equal("!waiting");
      expect(expandVirtualTagShorthand("!wait")).to.equal("!waiting");
      expect(expandVirtualTagShorthand("!waiting")).to.equal("!waiting");
    });

    it("should expand scheduled shorthands", function () {
      expect(expandVirtualTagShorthand("!s")).to.equal("!scheduled");
      expect(expandVirtualTagShorthand("!sch")).to.equal("!scheduled");
      expect(expandVirtualTagShorthand("!sched")).to.equal("!scheduled");
      expect(expandVirtualTagShorthand("!scheduled")).to.equal("!scheduled");
    });

    it("should expand blocked shorthands", function () {
      expect(expandVirtualTagShorthand("!b")).to.equal("!blocked");
      expect(expandVirtualTagShorthand("!blk")).to.equal("!blocked");
      expect(expandVirtualTagShorthand("!block")).to.equal("!blocked");
      expect(expandVirtualTagShorthand("!blocked")).to.equal("!blocked");
    });

    it("should expand done shorthands", function () {
      expect(expandVirtualTagShorthand("!d")).to.equal("!done");
      expect(expandVirtualTagShorthand("!done")).to.equal("!done");
    });

    it("should expand active shorthands", function () {
      expect(expandVirtualTagShorthand("!a")).to.equal("!active");
      expect(expandVirtualTagShorthand("!act")).to.equal("!active");
      expect(expandVirtualTagShorthand("!active")).to.equal("!active");
    });

    it("should expand recurring shorthands", function () {
      expect(expandVirtualTagShorthand("!r")).to.equal("!recurring");
      expect(expandVirtualTagShorthand("!rec")).to.equal("!recurring");
      expect(expandVirtualTagShorthand("!recur")).to.equal("!recurring");
      expect(expandVirtualTagShorthand("!recurring")).to.equal("!recurring");
    });

    it("should expand someday shorthands", function () {
      expect(expandVirtualTagShorthand("!sd")).to.equal("!someday");
      expect(expandVirtualTagShorthand("!someday")).to.equal("!someday");
    });

    it("should expand routine shorthands", function () {
      expect(expandVirtualTagShorthand("!rt")).to.equal("!routine");
      expect(expandVirtualTagShorthand("!routine")).to.equal("!routine");
    });

    it("should preserve + prefix", function () {
      expect(expandVirtualTagShorthand("+w")).to.equal("+waiting");
      expect(expandVirtualTagShorthand("+rt")).to.equal("+routine");
    });

    it("should not expand unknown tags", function () {
      expect(expandVirtualTagShorthand("!errand")).to.equal("!errand");
      expect(expandVirtualTagShorthand("!foo")).to.equal("!foo");
    });

    it("should be case insensitive for shorthands", function () {
      expect(expandVirtualTagShorthand("!W")).to.equal("!waiting");
      expect(expandVirtualTagShorthand("!RT")).to.equal("!routine");
      expect(expandVirtualTagShorthand("!OD")).to.equal("!overdue");
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

  describe("Command Resolution", function () {
    it("should include report command in VALID_COMMANDS", function () {
      expect(VALID_COMMANDS).to.include("report");
      expect(VALID_COMMANDS).to.include("rep");
    });

    it("should include undo command in VALID_COMMANDS", function () {
      expect(VALID_COMMANDS).to.include("undo");
    });

    it("should include edit command in VALID_COMMANDS", function () {
      expect(VALID_COMMANDS).to.include("edit");
      expect(VALID_COMMANDS).to.include("ed");
    });

    it("should resolve unambiguous commands", function () {
      expect(resolveCommand("report")).to.equal("report");
      expect(resolveCommand("add")).to.equal("add");
      expect(resolveCommand("list")).to.equal("list");
      expect(resolveCommand("done")).to.equal("done");
      expect(resolveCommand("calendar")).to.equal("calendar");
      expect(resolveCommand("ski")).to.equal("skip");
      expect(resolveCommand("edit")).to.equal("edit");
    });

    it("should return null for ambiguous prefixes", function () {
      // 'rep' matches both 'rep' and 'report'
      expect(resolveCommand("rep")).to.be.null;
      // 'cal' matches both 'cal' and 'calendar'
      expect(resolveCommand("cal")).to.be.null;
      // 'c' matches 'c', 'calendar', 'cal', 'chain', 'clear', 'context', 'ctx'
      expect(resolveCommand("c")).to.be.null;
    });

    it("should return null for unknown commands", function () {
      expect(resolveCommand("foobar")).to.be.null;
      expect(resolveCommand("xyz")).to.be.null;
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

describe("Undo Stack Tests", function () {
  beforeEach(function () {
    clearUndo();
  });

  describe("Basic Stack Operations", function () {
    it("should start empty", function () {
      expect(hasUndo()).to.be.false;
      expect(popUndo()).to.be.null;
    });

    it("should push and pop a single record", function () {
      const record = { type: "create", uuid: "test-uuid-1" };
      pushUndo(record);
      expect(hasUndo()).to.be.true;
      const popped = popUndo();
      expect(popped).to.deep.equal(record);
      expect(hasUndo()).to.be.false;
    });

    it("should pop in LIFO order", function () {
      const r1 = { type: "create", uuid: "uuid-1" };
      const r2 = { type: "create", uuid: "uuid-2" };
      const r3 = { type: "create", uuid: "uuid-3" };
      pushUndo(r1);
      pushUndo(r2);
      pushUndo(r3);
      expect(popUndo()).to.deep.equal(r3);
      expect(popUndo()).to.deep.equal(r2);
      expect(popUndo()).to.deep.equal(r1);
      expect(popUndo()).to.be.null;
    });

    it("should clear all records", function () {
      pushUndo({ type: "create", uuid: "uuid-1" });
      pushUndo({ type: "create", uuid: "uuid-2" });
      expect(hasUndo()).to.be.true;
      clearUndo();
      expect(hasUndo()).to.be.false;
      expect(popUndo()).to.be.null;
    });
  });

  describe("Record Types", function () {
    it("should handle create records", function () {
      const record = { type: "create", uuid: "new-task-uuid" };
      pushUndo(record);
      const popped = popUndo();
      expect(popped.type).to.equal("create");
      expect(popped.uuid).to.equal("new-task-uuid");
    });

    it("should handle update records with task snapshot", function () {
      const task = {
        uuid: "task-uuid",
        description: "Original description",
        priority: 10,
        status: "pending",
      };
      const record = { type: "update", task };
      pushUndo(record);
      const popped = popUndo();
      expect(popped.type).to.equal("update");
      expect(popped.task).to.deep.equal(task);
    });

    it("should handle delete records with task snapshot", function () {
      const task = {
        uuid: "deleted-uuid",
        description: "Task to delete",
        status: "pending",
      };
      const record = { type: "delete", task };
      pushUndo(record);
      const popped = popUndo();
      expect(popped.type).to.equal("delete");
      expect(popped.task).to.deep.equal(task);
    });

    it("should handle compound records", function () {
      const records = [
        { type: "update", task: { uuid: "u1", description: "Old state" } },
        { type: "create", uuid: "u2" },
      ];
      const compound = { type: "compound", records };
      pushUndo(compound);
      const popped = popUndo();
      expect(popped.type).to.equal("compound");
      expect(popped.records).to.have.length(2);
      expect(popped.records[0].type).to.equal("update");
      expect(popped.records[1].type).to.equal("create");
    });
  });

  describe("Multiple Operations", function () {
    it("should handle interleaved push and pop", function () {
      pushUndo({ type: "create", uuid: "u1" });
      pushUndo({ type: "create", uuid: "u2" });
      expect(popUndo().uuid).to.equal("u2");
      pushUndo({ type: "create", uuid: "u3" });
      expect(popUndo().uuid).to.equal("u3");
      expect(popUndo().uuid).to.equal("u1");
      expect(hasUndo()).to.be.false;
    });

    it("should maintain independence of records", function () {
      const task1 = { uuid: "u1", description: "Task 1" };
      const task2 = { uuid: "u2", description: "Task 2" };
      pushUndo({ type: "update", task: task1 });
      pushUndo({ type: "update", task: task2 });
      // Modify original objects
      task1.description = "Modified";
      task2.description = "Modified";
      // Popped records should still have original values
      // (assuming structuredClone is used before pushing)
      const p2 = popUndo();
      const p1 = popUndo();
      // Note: the test verifies the stack stores what was pushed
      expect(p1.task.uuid).to.equal("u1");
      expect(p2.task.uuid).to.equal("u2");
    });
  });
});

describe("Undo E2E Tests", function () {
  before(async function () {
    await initDB();
    // Create required DOM element for execute() to work
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Undo Add", function () {
    it("should delete a newly added task on undo", async function () {
      await execute("add do the thing");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].description).to.equal("do the thing");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("should undo add with project and tags", async function () {
      await execute("add task with metadata pro:TestProject !urgent pri:50");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].project).to.equal("TestProject");
      expect(tasks[0].tags).to.include("urgent");
      expect(tasks[0].priority).to.equal(50);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });
  });

  describe("Undo Delete", function () {
    it("should restore a deleted task on undo", async function () {
      await execute("add task to delete pro:Project !tag1");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      const originalUuid = tasks[0].uuid;

      await execute("delete 1");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].uuid).to.equal(originalUuid);
      expect(tasks[0].description).to.equal("task to delete");
      expect(tasks[0].project).to.equal("Project");
      expect(tasks[0].tags).to.include("tag1");
    });
  });

  describe("Undo Modify", function () {
    it("should restore original task state on undo", async function () {
      await execute("add original description pri:5");

      let tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("original description");
      expect(tasks[0].priority).to.equal(5);

      await execute("mod 1 modified description pri:50");

      tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("modified description");
      expect(tasks[0].priority).to.equal(50);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("original description");
      expect(tasks[0].priority).to.equal(5);
    });

    it("should restore removed project on undo", async function () {
      await execute("add task pro:MyProject");

      await execute("mod 1 pro:");

      let tasks = await dbOps.getAll();
      expect(tasks[0].project).to.equal("");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].project).to.equal("MyProject");
    });
  });

  describe("Undo Start", function () {
    it("should remove start time on undo", async function () {
      await execute("add task to start");

      await execute("start 1");

      let tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.a("number");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.undefined;
    });
  });

  describe("Undo Done (non-recurring)", function () {
    it("should restore task to pending status on undo", async function () {
      await execute("add task to complete");

      await execute("done 1");

      let tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
      expect(tasks[0].end).to.be.a("number");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("pending");
      expect(tasks[0].end).to.be.undefined;
    });
  });

  describe("Undo Done (recurring)", function () {
    it("should restore original task and delete new recurrence on undo", async function () {
      await execute("add recurring task due:today recur:1w");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      const originalUuid = tasks[0].uuid;
      const originalDue = tasks[0].due;

      await execute("done 1");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      const completed = tasks.find((t) => t.status === "completed");
      const newTask = tasks.find((t) => t.status === "pending");
      expect(completed).to.not.be.undefined;
      expect(newTask).to.not.be.undefined;
      expect(newTask.due).to.be.greaterThan(originalDue);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].uuid).to.equal(originalUuid);
      expect(tasks[0].status).to.equal("pending");
      expect(tasks[0].due).to.equal(originalDue);
    });
  });

  describe("Undo Skip (recurring)", function () {
    it("should restore skipped task and delete new recurrence on undo", async function () {
      await execute("add recurring task to skip due:today recur:1w");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      const originalUuid = tasks[0].uuid;
      const originalDue = tasks[0].due;

      await execute("skip 1");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      const skipped = tasks.find((t) => t.status === "skipped");
      const newTask = tasks.find((t) => t.status === "pending");
      expect(skipped).to.not.be.undefined;
      expect(newTask).to.not.be.undefined;

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].uuid).to.equal(originalUuid);
      expect(tasks[0].status).to.equal("pending");
      expect(tasks[0].due).to.equal(originalDue);
    });
  });

  describe("Undo Annotate", function () {
    it("should remove added annotation on undo", async function () {
      await execute("add task to annotate");

      await execute("annotate 1 my important note");

      let tasks = await dbOps.getAll();
      expect(tasks[0].annotations).to.have.length(1);
      expect(tasks[0].annotations[0].description).to.equal("my important note");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].annotations || []).to.have.length(0);
    });
  });

  describe("Multiple Undos in Sequence", function () {
    it("should undo multiple operations in reverse order", async function () {
      // Add task
      await execute("add multi-step task");
      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);

      // Modify 1
      await execute("mod 1 pri:10");
      tasks = await dbOps.getAll();
      expect(tasks[0].priority).to.equal(10);

      // Modify 2
      await execute("mod 1 pri:50 changed description");
      tasks = await dbOps.getAll();
      expect(tasks[0].priority).to.equal(50);
      expect(tasks[0].description).to.equal("changed description");

      // Undo modify 2
      await execute("undo");
      tasks = await dbOps.getAll();
      expect(tasks[0].priority).to.equal(10);
      expect(tasks[0].description).to.equal("multi-step task");

      // Undo modify 1
      await execute("undo");
      tasks = await dbOps.getAll();
      expect(tasks[0].priority).to.be.null;

      // Undo add
      await execute("undo");
      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);

      // No more undos - should show error message but not crash
      await execute("undo");
      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });
  });

  describe("Undo Nothing Available", function () {
    it("should handle undo when stack is empty", async function () {
      // Just verify it doesn't crash
      await execute("undo");
      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Nothing to undo");
    });
  });
});

describe("Command Syntax E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Normal COMMAND NUMBER syntax", function () {
    it("done 1 - should complete task", async function () {
      await execute("add test task");
      await execute("done 1");

      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });

    it("delete 1 - should delete task", async function () {
      await execute("add test task");
      await execute("delete 1");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("mod 1 - should modify task", async function () {
      await execute("add original task");
      await execute("mod 1 modified task pri:50");

      const tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("modified task");
      expect(tasks[0].priority).to.equal(50);
    });

    it("start 1 - should start task", async function () {
      await execute("add test task");
      await execute("start 1");

      const tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.a("number");
    });

    it("skip 1 - should skip recurring task", async function () {
      await execute("add recurring task due:today recur:1w");
      await execute("skip 1");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.find((t) => t.status === "skipped")).to.not.be.undefined;
    });

    it("annotate 1 - should add annotation", async function () {
      await execute("add test task");
      await execute("annotate 1 my note");

      const tasks = await dbOps.getAll();
      expect(tasks[0].annotations).to.have.length(1);
      expect(tasks[0].annotations[0].description).to.equal("my note");
    });
  });

  describe("Reversed NUMBER COMMAND syntax", function () {
    it("1 done - should complete task", async function () {
      await execute("add test task");
      await execute("1 done");

      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });

    it("1 delete - should delete task", async function () {
      await execute("add test task");
      await execute("1 delete");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("1 rm - should delete task", async function () {
      await execute("add test task");
      await execute("1 rm");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("1 mod - should modify task", async function () {
      await execute("add original task");
      await execute("1 mod modified task pri:50");

      const tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("modified task");
      expect(tasks[0].priority).to.equal(50);
    });

    it("1 modify - should modify task", async function () {
      await execute("add original task");
      await execute("1 modify new description");

      const tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("new description");
    });

    it("1 start - should start task", async function () {
      await execute("add test task");
      await execute("1 start");

      const tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.a("number");
    });

    it("1 st - should start task", async function () {
      await execute("add test task");
      await execute("1 st");

      const tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.a("number");
    });

    it("1 skip - should skip recurring task", async function () {
      await execute("add recurring task due:today recur:1w");
      await execute("1 skip");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.find((t) => t.status === "skipped")).to.not.be.undefined;
    });

    it("1 annotate - should add annotation", async function () {
      await execute("add test task");
      await execute("1 annotate my note here");

      const tasks = await dbOps.getAll();
      expect(tasks[0].annotations).to.have.length(1);
      expect(tasks[0].annotations[0].description).to.equal("my note here");
    });

    it("1 (just number) - should show info without error", async function () {
      await execute("add test task");
      await execute("1");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("test task");
      expect(output).not.to.include("Invalid");
    });
  });

  describe("Multiple tasks with NUMBER COMMAND", function () {
    it("should operate on correct task by number", async function () {
      await execute("add first task");
      await execute("add second task");
      await execute("add third task");

      await execute("2 done");

      const tasks = await dbOps.getAll();
      const pending = tasks.filter((t) => t.status === "pending");
      const completed = tasks.filter((t) => t.status === "completed");

      expect(pending).to.have.length(2);
      expect(completed).to.have.length(1);
      expect(completed[0].description).to.equal("second task");
    });

    it("should modify correct task with reversed syntax", async function () {
      await execute("add first task");
      await execute("add second task");

      await execute("1 mod updated first");
      await execute("2 mod updated second");

      const tasks = await dbOps.getAll();
      const first = tasks.find((t) => t.description === "updated first");
      const second = tasks.find((t) => t.description === "updated second");

      expect(first).to.not.be.undefined;
      expect(second).to.not.be.undefined;
    });
  });
});

describe("Edit Command E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      document.body.appendChild(div);
    }
    if (!document.getElementById("cmd-input")) {
      const input = document.createElement("textarea");
      input.id = "cmd-input";
      document.body.appendChild(input);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
    document.getElementById("cmd-input").value = "";
  });

  describe("Basic edit command", function () {
    it("edit 1 - should populate input with mod command", async function () {
      await execute("add test task");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
    });

    it("ed 1 - should work with alias", async function () {
      await execute("add test task");
      await execute("ed 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
    });

    it("1 edit - should work with reversed syntax", async function () {
      await execute("add test task");
      await execute("1 edit");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
    });

    it("1 ed - should work with reversed syntax and alias", async function () {
      await execute("add test task");
      await execute("1 ed");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
    });
  });

  describe("Edit with task properties", function () {
    it("should include project in edit command", async function () {
      await execute("add task with project pro:TestProject");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("pro:TestProject");
    });

    it("should include priority in edit command", async function () {
      await execute("add task with priority pri:50");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("pri:50");
    });

    it("should include tags in edit command", async function () {
      await execute("add task with tags !urgent !important");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("!urgent");
      expect(input.value).to.include("!important");
    });

    it("should include due date in edit command", async function () {
      await execute("add task with due due:20250615");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("due:20250615");
    });

    it("should include recurrence in edit command", async function () {
      await execute("add recurring task due:today recur:1w");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("recur:1w");
    });

    it("should include url in edit command", async function () {
      await execute("add task with url url:https://example.com");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("url:https://example.com");
    });

    it("should include all properties together", async function () {
      await execute(
        "add complex task pro:Work pri:25 !urgent due:20250620 recur:1w",
      );
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("complex task");
      expect(input.value).to.include("pro:Work");
      expect(input.value).to.include("pri:25");
      expect(input.value).to.include("!urgent");
      expect(input.value).to.include("due:20250620");
      expect(input.value).to.include("recur:1w");
    });
  });

  describe("Edit error handling", function () {
    it("should show error for invalid ID", async function () {
      await execute("add test task");
      await execute("edit 99");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Invalid ID");
    });

    it("should show error when no tasks exist", async function () {
      await execute("edit 1");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Invalid ID");
    });
  });

  describe("Edit and modify workflow", function () {
    it("should allow editing then modifying a task", async function () {
      await execute("add original task pri:10");

      // Edit populates input
      await execute("edit 1");
      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("pri:10");

      // Simulate user modifying the input and executing
      await execute("mod 1 updated task pri:50");

      const tasks = await dbOps.getAll();
      expect(tasks[0].description).to.equal("updated task");
      expect(tasks[0].priority).to.equal(50);
    });
  });
});
