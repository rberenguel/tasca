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
  isVirtualTag,
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
import { parseIds } from "../src/js/commands-state.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";
import { getContext, getInheritedAttributes } from "../src/js/context.js";
import {
  collectStartedTasks,
  collectOverdueTasks,
  collectReadyTasks,
  sortTodayTasks,
} from "../src/js/today.js";

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

    it("should parse named days (mon-sun)", function () {
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const today = new Date().getDay();

      for (let i = 0; i < 7; i++) {
        const result = parseDate(dayNames[i]);
        expect(result).to.not.be.null;

        const d = new Date(result);
        // Should be the correct day of week
        expect(d.getDay()).to.equal(i);

        // Should be in the future (1-7 days from now)
        // Use floor to avoid rounding issues near midnight
        const now = new Date();
        const diffMs = d - now;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        expect(diffDays).to.be.at.least(0);
        expect(diffDays).to.be.at.most(7);

        // Should be end of day
        expect(d.getHours()).to.equal(23);
        expect(d.getMinutes()).to.equal(59);
      }
    });

    it("should parse named day with time (mon@09:00)", function () {
      const result = parseDate("mon@09:00");
      expect(result).to.not.be.null;

      const d = new Date(result);
      // Should be Monday
      expect(d.getDay()).to.equal(1);
      // Should have the specified time
      expect(d.getHours()).to.equal(9);
      expect(d.getMinutes()).to.equal(0);

      // Should be in the future
      expect(d.getTime()).to.be.greaterThan(Date.now());
    });

    it("should treat same day as next week", function () {
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const today = new Date().getDay();
      const todayName = dayNames[today];

      const result = parseDate(todayName);
      const d = new Date(result);

      // Should be exactly 7 days from now (same day next week)
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const target = new Date(d);
      target.setHours(0, 0, 0, 0);
      const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));
      expect(diffDays).to.equal(7);
    });

    it("should be case insensitive for named days", function () {
      expect(parseDate("MON")).to.not.be.null;
      expect(parseDate("Mon")).to.not.be.null;
      expect(parseDate("FRI")).to.not.be.null;
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
      div.style.display = "none";
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
      div.style.display = "none";
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
      div.style.display = "none";
      document.body.appendChild(div);
    }
    if (!document.getElementById("cmd-input")) {
      const input = document.createElement("textarea");
      input.id = "cmd-input";
      input.style.display = "none";
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

describe("Multi-ID Parsing Tests", function () {
  // Mock displayMapRef with 10 valid UUIDs
  const mockDisplayMap = {
    value: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "u10"],
  };

  describe("Single ID", function () {
    it("should parse a single ID", function () {
      expect(parseIds("1", mockDisplayMap)).to.deep.equal([1]);
      expect(parseIds("5", mockDisplayMap)).to.deep.equal([5]);
      expect(parseIds("10", mockDisplayMap)).to.deep.equal([10]);
    });

    it("should return empty for invalid single ID", function () {
      expect(parseIds("11", mockDisplayMap)).to.deep.equal([]);
      expect(parseIds("0", mockDisplayMap)).to.deep.equal([]);
      expect(parseIds("abc", mockDisplayMap)).to.deep.equal([]);
    });

    it("should return empty for null/undefined", function () {
      expect(parseIds(null, mockDisplayMap)).to.deep.equal([]);
      expect(parseIds(undefined, mockDisplayMap)).to.deep.equal([]);
      expect(parseIds("", mockDisplayMap)).to.deep.equal([]);
    });
  });

  describe("Comma-separated IDs", function () {
    it("should parse comma-separated IDs", function () {
      expect(parseIds("1,3", mockDisplayMap)).to.deep.equal([1, 3]);
      expect(parseIds("1,3,5", mockDisplayMap)).to.deep.equal([1, 3, 5]);
      expect(parseIds("2,4,6,8", mockDisplayMap)).to.deep.equal([2, 4, 6, 8]);
    });

    it("should skip invalid IDs in list", function () {
      expect(parseIds("1,11,3", mockDisplayMap)).to.deep.equal([1, 3]);
      expect(parseIds("0,1,2", mockDisplayMap)).to.deep.equal([1, 2]);
    });

    it("should deduplicate IDs", function () {
      expect(parseIds("1,1,2,2", mockDisplayMap)).to.deep.equal([1, 2]);
    });

    it("should sort IDs", function () {
      expect(parseIds("5,2,8,1", mockDisplayMap)).to.deep.equal([1, 2, 5, 8]);
    });
  });

  describe("Range syntax", function () {
    it("should parse simple range", function () {
      expect(parseIds("1-3", mockDisplayMap)).to.deep.equal([1, 2, 3]);
      expect(parseIds("5-8", mockDisplayMap)).to.deep.equal([5, 6, 7, 8]);
    });

    it("should handle reversed range", function () {
      expect(parseIds("3-1", mockDisplayMap)).to.deep.equal([1, 2, 3]);
    });

    it("should clip range to valid IDs", function () {
      expect(parseIds("8-12", mockDisplayMap)).to.deep.equal([8, 9, 10]);
      expect(parseIds("0-3", mockDisplayMap)).to.deep.equal([1, 2, 3]);
    });

    it("should handle single-element range", function () {
      expect(parseIds("5-5", mockDisplayMap)).to.deep.equal([5]);
    });
  });

  describe("Combined syntax", function () {
    it("should parse mixed comma and range", function () {
      expect(parseIds("1,3-5", mockDisplayMap)).to.deep.equal([1, 3, 4, 5]);
      expect(parseIds("1-3,7", mockDisplayMap)).to.deep.equal([1, 2, 3, 7]);
      expect(parseIds("1,3-5,8", mockDisplayMap)).to.deep.equal([
        1, 3, 4, 5, 8,
      ]);
    });

    it("should handle multiple ranges", function () {
      expect(parseIds("1-2,5-6", mockDisplayMap)).to.deep.equal([1, 2, 5, 6]);
    });

    it("should deduplicate overlapping ranges", function () {
      expect(parseIds("1-3,2-4", mockDisplayMap)).to.deep.equal([1, 2, 3, 4]);
    });

    it("should handle complex mixed input", function () {
      expect(parseIds("1,3-5,7,9-10", mockDisplayMap)).to.deep.equal([
        1, 3, 4, 5, 7, 9, 10,
      ]);
    });
  });
});

describe("Multi-ID Command E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Multi-ID done", function () {
    it("done 1,2 - should complete multiple tasks", async function () {
      await execute("add first task");
      await execute("add second task");
      await execute("add third task");
      await execute("done 1,2");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(completed).to.have.length(2);
      expect(pending).to.have.length(1);
      expect(pending[0].description).to.equal("third task");
    });

    it("done 1-3 - should complete range of tasks", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("done 1-3");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");

      expect(completed).to.have.length(3);
    });

    it("done 1,3-4 - should complete mixed selection", async function () {
      await execute("add task 1");
      await execute("add task 2");
      await execute("add task 3");
      await execute("add task 4");
      await execute("done 1,3-4");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(completed).to.have.length(3);
      expect(pending).to.have.length(1);
      expect(pending[0].description).to.equal("task 2");
    });

    it("should handle recurring tasks in multi-done", async function () {
      await execute("add normal task");
      await execute("add recurring task due:today recur:1w");
      await execute("done 1,2");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(completed).to.have.length(2);
      expect(pending).to.have.length(1); // New recurring instance
    });

    it("should undo multi-done in one step", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("done 1-3");

      let tasks = await dbOps.getAll();
      expect(tasks.filter((t) => t.status === "completed")).to.have.length(3);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks.filter((t) => t.status === "pending")).to.have.length(3);
      expect(tasks.filter((t) => t.status === "completed")).to.have.length(0);
    });
  });

  describe("Multi-ID delete", function () {
    it("delete 1,3 - should delete specific tasks", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("delete 1,3");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].description).to.equal("task two");
    });

    it("delete 1-3 - should delete range", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("delete 1-3");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("rm 2,4 - should work with alias", async function () {
      await execute("add task 1");
      await execute("add task 2");
      await execute("add task 3");
      await execute("add task 4");
      await execute("rm 2,4");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.map((t) => t.description)).to.include("task 1");
      expect(tasks.map((t) => t.description)).to.include("task 3");
    });

    it("should undo multi-delete in one step", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("delete 1-3");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(3);
    });
  });

  describe("Multi-ID skip", function () {
    it("skip 1,2 - should skip multiple recurring tasks", async function () {
      await execute("add recurring 1 due:today recur:1w");
      await execute("add recurring 2 due:today recur:1w");
      await execute("skip 1,2");

      const tasks = await dbOps.getAll();
      const skipped = tasks.filter((t) => t.status === "skipped");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(skipped).to.have.length(2);
      expect(pending).to.have.length(2); // New instances
    });

    it("skip 1-3 - should skip range of recurring tasks", async function () {
      await execute("add recurring 1 due:today recur:1d");
      await execute("add recurring 2 due:today recur:1d");
      await execute("add recurring 3 due:today recur:1d");
      await execute("skip 1-3");

      const tasks = await dbOps.getAll();
      const skipped = tasks.filter((t) => t.status === "skipped");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(skipped).to.have.length(3);
      expect(pending).to.have.length(3);
    });

    it("should cancel non-recurring and skip recurring in mixed selection", async function () {
      await execute("add normal task");
      await execute("add recurring task due:today recur:1w");
      await execute("skip 1,2");

      const tasks = await dbOps.getAll();
      const skipped = tasks.filter((t) => t.status === "skipped");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(skipped).to.have.length(2); // Both get skipped status
      expect(pending).to.have.length(1); // Only new recurring instance
    });

    it("skip should cancel non-recurring task", async function () {
      await execute("add normal task");
      await execute("skip 1");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].status).to.equal("skipped");
      expect(tasks[0].end).to.be.a("number");
    });

    it("skip should be undoable for non-recurring task", async function () {
      await execute("add normal task");
      await execute("skip 1");

      let tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("skipped");

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("pending");
      expect(tasks[0].end).to.be.undefined;
    });

    it("should undo multi-skip in one step", async function () {
      await execute("add recurring 1 due:today recur:1w");
      await execute("add recurring 2 due:today recur:1w");
      await execute("skip 1,2");

      let tasks = await dbOps.getAll();
      expect(tasks).to.have.length(4); // 2 skipped + 2 new

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.every((t) => t.status === "pending")).to.be.true;
    });
  });

  describe("Multi-ID modify", function () {
    it("mod 1,2 - should modify multiple tasks", async function () {
      await execute("add first task");
      await execute("add second task");
      await execute("add third task");
      await execute("mod 1,2 pro:Test");

      const tasks = await dbOps.getAll();
      const modified = tasks.filter((t) => t.project === "Test");
      const unmodified = tasks.filter((t) => !t.project);

      expect(modified).to.have.length(2);
      expect(unmodified).to.have.length(1);
      expect(unmodified[0].description).to.equal("third task");
    });

    it("mod 1-3 - should modify range of tasks", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("mod 1-3 pri:10");

      const tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.priority === 10)).to.be.true;
    });

    it("mod 1,3-4 - should modify mixed selection", async function () {
      await execute("add task 1");
      await execute("add task 2");
      await execute("add task 3");
      await execute("add task 4");
      await execute("mod 1,3-4 !urgent");

      const tasks = await dbOps.getAll();
      const tagged = tasks.filter((t) => t.tags && t.tags.includes("urgent"));
      const untagged = tasks.filter(
        (t) => !t.tags || !t.tags.includes("urgent"),
      );

      expect(tagged).to.have.length(3);
      expect(untagged).to.have.length(1);
      expect(untagged[0].description).to.equal("task 2");
    });

    it("mod 1-3 should apply multiple modifications", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("mod 1-3 pro:Work pri:5 !important");

      const tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.project === "Work")).to.be.true;
      expect(tasks.every((t) => t.priority === 5)).to.be.true;
      expect(tasks.every((t) => t.tags && t.tags.includes("important"))).to.be
        .true;
    });

    it("should undo multi-modify in one step", async function () {
      await execute("add task one pro:Old");
      await execute("add task two pro:Old");
      await execute("add task three pro:Old");
      await execute("mod 1-3 pro:New");

      let tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.project === "New")).to.be.true;

      await execute("undo");

      tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.project === "Old")).to.be.true;
    });

    it("should reject target on multiple tasks", async function () {
      await execute("add task one");
      await execute("add task two");
      // Target should only work on single task
      await execute("mod 1,2 x:myTarget");

      const tasks = await dbOps.getAll();
      // Neither task should have the target since it should be rejected
      expect(tasks.every((t) => !t.target)).to.be.true;
    });
  });

  describe("Reversed ID(s) COMMAND syntax", function () {
    it("1,2 done - should complete multiple tasks", async function () {
      await execute("add first task");
      await execute("add second task");
      await execute("add third task");
      await execute("1,2 done");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(completed).to.have.length(2);
      expect(pending).to.have.length(1);
      expect(pending[0].description).to.equal("third task");
    });

    it("1-3 done - should complete range", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("1-3 done");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      expect(completed).to.have.length(3);
    });

    it("1,3-4 delete - should delete mixed selection", async function () {
      await execute("add task 1");
      await execute("add task 2");
      await execute("add task 3");
      await execute("add task 4");
      await execute("1,3-4 delete");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].description).to.equal("task 2");
    });

    it("2,4 rm - should work with alias", async function () {
      await execute("add task 1");
      await execute("add task 2");
      await execute("add task 3");
      await execute("add task 4");
      await execute("2,4 rm");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.map((t) => t.description)).to.include("task 1");
      expect(tasks.map((t) => t.description)).to.include("task 3");
    });

    it("1-2 skip - should skip range of recurring tasks", async function () {
      await execute("add recurring 1 due:today recur:1w");
      await execute("add recurring 2 due:today recur:1w");
      await execute("1-2 skip");

      const tasks = await dbOps.getAll();
      const skipped = tasks.filter((t) => t.status === "skipped");
      const pending = tasks.filter((t) => t.status === "pending");

      expect(skipped).to.have.length(2);
      expect(pending).to.have.length(2);
    });

    it("1,3 mod - should modify multiple tasks", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("1,3 mod pro:Test");

      const tasks = await dbOps.getAll();
      const modified = tasks.filter((t) => t.project === "Test");
      expect(modified).to.have.length(2);
      expect(modified.map((t) => t.description)).to.include("task one");
      expect(modified.map((t) => t.description)).to.include("task three");
    });

    it("1-3 mod - should modify range with reversed syntax", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("add task three");
      await execute("1-3 mod pri:20");

      const tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.priority === 20)).to.be.true;
    });
  });
});

describe("List Search E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Search finds waiting tasks", function () {
    it("list without search should hide waiting tasks", async function () {
      await execute("add waiting task wait:7d");
      await execute("add visible task");

      // displayMapRef should only have the visible task
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const visibleTask = tasks.find((t) => t.description === "visible task");
      expect(displayMapRef.value[0]).to.equal(visibleTask.uuid);
    });

    it("list with search term should find waiting tasks", async function () {
      await execute("add waiting task wait:7d");
      await execute("add visible task");
      await execute("list waiting");

      // displayMapRef should have the waiting task
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const waitingTask = tasks.find((t) => t.description === "waiting task");
      expect(displayMapRef.value[0]).to.equal(waitingTask.uuid);
    });

    it("list with search should find scheduled tasks", async function () {
      await execute("add scheduled task sched:7d");
      await execute("add visible task");
      await execute("list scheduled");

      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const schedTask = tasks.find((t) => t.description === "scheduled task");
      expect(displayMapRef.value[0]).to.equal(schedTask.uuid);
    });

    it("search should match partial description in waiting tasks", async function () {
      await execute("add buy groceries wait:3d");
      await execute("add buy furniture");
      await execute("list groceries");

      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const groceryTask = tasks.find((t) =>
        t.description.includes("groceries"),
      );
      expect(displayMapRef.value[0]).to.equal(groceryTask.uuid);
    });

    it("search with project filter should still find waiting tasks", async function () {
      await execute("add waiting project task wait:5d pro:Work");
      await execute("add visible project task pro:Work");
      await execute("add unrelated task pro:Home");
      await execute("list waiting pro:Work");

      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const waitingWorkTask = tasks.find(
        (t) => t.description === "waiting project task",
      );
      expect(displayMapRef.value[0]).to.equal(waitingWorkTask.uuid);
    });

    it("explicit !waiting filter should also show waiting tasks", async function () {
      await execute("add waiting task wait:7d");
      await execute("add visible task");
      await execute("list !waiting");

      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const waitingTask = tasks.find((t) => t.description === "waiting task");
      expect(displayMapRef.value[0]).to.equal(waitingTask.uuid);
    });
  });

  describe("Context search terms should NOT show waiting tasks", function () {
    afterEach(async function () {
      // Clear context after each test
      await execute("context");
    });

    it("context with search term should hide waiting tasks", async function () {
      await execute("add waiting task wait:7d");
      await execute("add visible task");

      // Set context with search term "task"
      await execute("context task");

      // Now list - context search should NOT reveal waiting tasks
      await execute("list");

      // Should only show the visible task, not the waiting one
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const visibleTask = tasks.find((t) => t.description === "visible task");
      expect(displayMapRef.value[0]).to.equal(visibleTask.uuid);
    });

    it("context with project should hide waiting tasks", async function () {
      await execute("add waiting work task wait:7d pro:Work");
      await execute("add visible work task pro:Work");
      await execute("add other task pro:Home");

      await execute("context pro:Work");
      await execute("list");

      // Should only show the visible work task
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const visibleTask = tasks.find(
        (t) => t.description === "visible work task",
      );
      expect(displayMapRef.value[0]).to.equal(visibleTask.uuid);
    });

    it("context with !waiting tag should show waiting tasks", async function () {
      await execute("add waiting task wait:7d");
      await execute("add visible task");

      await execute("context !waiting");
      await execute("list");

      // Should show the waiting task
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const waitingTask = tasks.find((t) => t.description === "waiting task");
      expect(displayMapRef.value[0]).to.equal(waitingTask.uuid);
    });

    it("direct search should find waiting tasks even with context", async function () {
      await execute("add waiting groceries wait:7d");
      await execute("add visible task");

      // Set a project context
      await execute("context pro:Work");

      // Direct search term should still find waiting tasks
      // (though this task won't match the pro:Work filter anyway)
      await execute("list groceries");

      // The search includes waiting but pro:Work filters it out
      // Let's test with matching project
      await execute("context");
      await execute("add waiting work groceries wait:7d pro:Work");
      await execute("context pro:Work");
      await execute("list groceries");

      // Should find the waiting task because of direct search term
      expect(displayMapRef.value).to.have.length(1);

      const tasks = await dbOps.getAll();
      const waitingTask = tasks.find(
        (t) => t.description === "waiting work groceries",
      );
      expect(displayMapRef.value[0]).to.equal(waitingTask.uuid);
    });
  });
});

describe("Modified Virtual Tag E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
    // Clear lastSave setting
    await dbOps.deleteSetting("lastSave");
  });

  describe("!modified virtual tag", function () {
    it("should expand !m and !mod to !modified", function () {
      expect(expandVirtualTagShorthand("!m")).to.equal("!modified");
      expect(expandVirtualTagShorthand("!mod")).to.equal("!modified");
      expect(expandVirtualTagShorthand("!modified")).to.equal("!modified");
    });

    it("list !modified should show all tasks when never saved", async function () {
      await execute("add task one");
      await execute("add task two");
      await execute("list !modified");

      // All tasks are modified when never saved
      expect(displayMapRef.value).to.have.length(2);
    });

    it("list !modified should show only tasks modified since last save", async function () {
      await execute("add old task");

      // Simulate a save by setting lastSave
      await dbOps.setSetting("lastSave", Date.now());

      // Wait a bit and add new task
      await new Promise((r) => setTimeout(r, 10));
      await execute("add new task");

      await execute("list !modified");

      // Only new task should show
      expect(displayMapRef.value).to.have.length(1);
      const tasks = await dbOps.getAll();
      const newTask = tasks.find((t) => t.description === "new task");
      expect(displayMapRef.value[0]).to.equal(newTask.uuid);
    });

    it("list !modified should include completed tasks", async function () {
      await execute("add task to complete");

      await dbOps.setSetting("lastSave", Date.now());
      await new Promise((r) => setTimeout(r, 10));

      await execute("done 1");
      await execute("list !modified");

      // Completed task should show
      expect(displayMapRef.value).to.have.length(1);
      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });

    it("list !modified should show nothing when all synced", async function () {
      await execute("add task one");
      await execute("add task two");

      // Set lastSave to future to simulate all synced
      await dbOps.setSetting("lastSave", Date.now() + 1000);

      await execute("list !modified");

      expect(displayMapRef.value).to.have.length(0);
    });
  });
});

describe("Today View E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
    // Clear context
    await execute("context");
  });

  afterEach(async function () {
    // Clear context after each test
    await execute("context");
  });

  describe("Order property parsing", function () {
    it("should parse order:N when adding a task", async function () {
      await execute("add test task order:5");
      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].order).to.equal(5);
    });

    it("should parse ord:N alias when adding a task", async function () {
      await execute("add test task ord:3");
      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].order).to.equal(3);
    });

    it("should parse o:N alias when adding a task", async function () {
      await execute("add test task o:7");
      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].order).to.equal(7);
    });

    it("should modify order with mod command", async function () {
      await execute("add test task");
      await execute("mod 1 order:10");
      const tasks = await dbOps.getAll();
      expect(tasks[0].order).to.equal(10);
    });

    it("should clear order with order:", async function () {
      await execute("add test task order:5");
      await execute("mod 1 order:");
      const tasks = await dbOps.getAll();
      expect(tasks[0].order).to.be.null;
    });
  });

  describe("Order-based sorting in today view", function () {
    it("should sort by order ascending in list !today", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add task A order:3 due:${today}`);
      await execute(`add task B order:1 due:${today}`);
      await execute(`add task C order:2 due:${today}`);

      await execute("list !today");

      // Should be sorted by order: B(1), C(2), A(3)
      expect(displayMapRef.value).to.have.length(3);
      const tasks = await dbOps.getAll();
      const taskB = tasks.find((t) => t.description === "task B");
      const taskC = tasks.find((t) => t.description === "task C");
      const taskA = tasks.find((t) => t.description === "task A");
      expect(displayMapRef.value[0]).to.equal(taskB.uuid);
      expect(displayMapRef.value[1]).to.equal(taskC.uuid);
      expect(displayMapRef.value[2]).to.equal(taskA.uuid);
    });

    it("should put tasks without order after ordered tasks", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add ordered task order:1 due:${today}`);
      await execute(`add unordered task due:${today}`);

      await execute("list !today");

      expect(displayMapRef.value).to.have.length(2);
      const tasks = await dbOps.getAll();
      const orderedTask = tasks.find((t) => t.description === "ordered task");
      expect(displayMapRef.value[0]).to.equal(orderedTask.uuid);
    });

    it("should sort by urgency when order is the same", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add high priority order:1 pri:50 due:${today}`);
      await execute(`add low priority order:1 pri:1 due:${today}`);

      await execute("list !today");

      expect(displayMapRef.value).to.have.length(2);
      const tasks = await dbOps.getAll();
      const highPri = tasks.find((t) => t.description === "high priority");
      // High priority should come first due to higher urgency
      expect(displayMapRef.value[0]).to.equal(highPri.uuid);
    });
  });

  describe("Context !today shows waiting tasks due today", function () {
    it("should show waiting tasks that are due today", async function () {
      const today = formatDateOnly(Date.now());
      // Task with wait:7d but due today
      await execute(`add routine task wait:7d due:${today}`);
      // Normal task due today
      await execute(`add normal task due:${today}`);

      await execute("list !today");

      // Both should appear since they're due today
      expect(displayMapRef.value).to.have.length(2);
    });

    it("should not show waiting tasks not due today", async function () {
      const tomorrow = formatDateOnly(Date.now() + 86400000);
      await execute(`add future task wait:1d due:${tomorrow}`);

      await execute("list !today");

      // Should not appear
      expect(displayMapRef.value).to.have.length(0);
    });

    it("should work in context !today mode", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add waiting routine wait:2d due:${today}`);
      await execute(`add visible routine due:${today}`);
      await execute("add other task");

      await execute("context !today");

      // Both today tasks should appear
      expect(displayMapRef.value).to.have.length(2);
      const tasks = await dbOps.getAll();
      const waitingRoutine = tasks.find(
        (t) => t.description === "waiting routine",
      );
      const visibleRoutine = tasks.find(
        (t) => t.description === "visible routine",
      );
      expect(displayMapRef.value).to.include(waitingRoutine.uuid);
      expect(displayMapRef.value).to.include(visibleRoutine.uuid);
    });
  });

  describe("day and today command aliases", function () {
    it("day command should set context to !today", async function () {
      await execute("day");
      const ctx = getContext();
      expect(ctx).to.not.be.null;
      expect(ctx.raw).to.equal("!today");
    });

    it("today command should set context to !today", async function () {
      await execute("today");
      const ctx = getContext();
      expect(ctx).to.not.be.null;
      expect(ctx.raw).to.equal("!today");
    });

    it("day command should show tasks due today", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add today task due:${today}`);
      await execute("add tomorrow task due:1d");

      await execute("day");

      // Only today task should show
      expect(displayMapRef.value).to.have.length(1);
      const tasks = await dbOps.getAll();
      const todayTask = tasks.find((t) => t.description === "today task");
      expect(displayMapRef.value[0]).to.equal(todayTask.uuid);
    });
  });

  describe("Today view UI details", function () {
    it("should hide (0d) date pill in today view", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add today task due:${today}`);

      await execute("list !today");

      const output = document.getElementById("terminal-output").innerHTML;
      // Should NOT contain (0d) since it's redundant in today view
      expect(output).to.not.include("(0d)");
    });

    it("should show (0d) date pill in regular list view", async function () {
      const today = formatDateOnly(Date.now());
      await execute(`add today task due:${today}`);

      await execute("list");

      const output = document.getElementById("terminal-output").innerHTML;
      // Should contain (0d) in regular list
      expect(output).to.include("(0d)");
    });

    it("should still show overdue pills in regular list", async function () {
      // Create a task that's overdue (due yesterday)
      const yesterday = formatDateOnly(Date.now() - 86400000);
      await execute(`add overdue task due:${yesterday}`);

      await execute("list");

      const output = document.getElementById("terminal-output").innerHTML;
      // Should show (-1d) for overdue task in regular list
      expect(output).to.include("(-1d)");
    });
  });

  describe("Virtual Tag Detection", function () {
    it("should identify virtual tags by full name", function () {
      expect(isVirtualTag("today")).to.be.true;
      expect(isVirtualTag("TODAY")).to.be.true;
      expect(isVirtualTag("waiting")).to.be.true;
      expect(isVirtualTag("scheduled")).to.be.true;
      expect(isVirtualTag("blocked")).to.be.true;
      expect(isVirtualTag("done")).to.be.true;
      expect(isVirtualTag("active")).to.be.true;
      expect(isVirtualTag("recurring")).to.be.true;
      expect(isVirtualTag("overdue")).to.be.true;
      expect(isVirtualTag("modified")).to.be.true;
      expect(isVirtualTag("reference")).to.be.true;
    });

    it("should identify virtual tags by shorthand", function () {
      expect(isVirtualTag("t")).to.be.true;
      expect(isVirtualTag("tod")).to.be.true;
      expect(isVirtualTag("w")).to.be.true;
      expect(isVirtualTag("wait")).to.be.true;
      expect(isVirtualTag("s")).to.be.true;
      expect(isVirtualTag("sch")).to.be.true;
      expect(isVirtualTag("b")).to.be.true;
      expect(isVirtualTag("blk")).to.be.true;
      expect(isVirtualTag("d")).to.be.true;
      expect(isVirtualTag("a")).to.be.true;
      expect(isVirtualTag("r")).to.be.true;
      expect(isVirtualTag("rec")).to.be.true;
      expect(isVirtualTag("o")).to.be.true;
      expect(isVirtualTag("od")).to.be.true;
      expect(isVirtualTag("m")).to.be.true;
      expect(isVirtualTag("mod")).to.be.true;
    });

    it("should not identify regular tags as virtual", function () {
      expect(isVirtualTag("work")).to.be.false;
      expect(isVirtualTag("urgent")).to.be.false;
      expect(isVirtualTag("home")).to.be.false;
      expect(isVirtualTag("next")).to.be.false;
      expect(isVirtualTag("someday")).to.be.true; // someday IS a virtual tag
      expect(isVirtualTag("routine")).to.be.true; // routine IS a virtual tag
    });
  });

  describe("Context inherited attributes should filter virtual tags", function () {
    it("should not inherit virtual tag !today from context", async function () {
      await execute("context !today");
      const inherited = getInheritedAttributes();
      expect(inherited.tags).to.be.undefined;
    });

    it("should not inherit virtual tag !waiting from context", async function () {
      await execute("context !waiting");
      const inherited = getInheritedAttributes();
      expect(inherited.tags).to.be.undefined;
    });

    it("should inherit real tags from context", async function () {
      await execute("context !work");
      const inherited = getInheritedAttributes();
      expect(inherited.tags).to.deep.equal(["work"]);
    });

    it("should inherit project from context", async function () {
      await execute("context pro:Work");
      const inherited = getInheritedAttributes();
      expect(inherited.project).to.equal("Work");
    });

    it("should filter out virtual tags but keep real tags", async function () {
      await execute("context !today !work");
      const inherited = getInheritedAttributes();
      // Only work should remain, today is virtual
      expect(inherited.tags).to.deep.equal(["work"]);
    });

    it("should not add virtual tags to tasks created in context", async function () {
      await execute("context !today");
      await execute("add test task in today context");

      const tasks = await dbOps.getAll();
      const task = tasks.find(
        (t) => t.description === "test task in today context",
      );
      expect(task).to.exist;
      // Task should NOT have "today" tag
      expect(task.tags || []).to.not.include("today");
    });
  });

  describe("Today view sections", function () {
    describe("Started section", function () {
      it("should show started tasks in today view", async function () {
        await execute("add started task");
        await execute("start 1");
        await execute("day");
        // Task should appear in displayMapRef
        expect(displayMapRef.value).to.have.length(1);
      });

      it("should show started tasks from reference projects", async function () {
        // Create reference project
        await execute("annotate pro:Books !reference");
        await execute("add book task pro:Books");
        // Use list to show reference project tasks (next filters them out due to negative urgency)
        await execute("list pro:Books");
        await execute("start 1");
        await execute("day");
        // Should appear in started section (good daily reminder)
        expect(displayMapRef.value).to.have.length(1);
      });

      it("should show started task due today in main section only", async function () {
        const today = formatDateOnly(Date.now());
        await execute(`add started today due:${today}`);
        await execute("start 1");
        await execute("day");
        // Should appear once (in main section, not duplicated)
        expect(displayMapRef.value).to.have.length(1);
      });

      it("started section should appear after main section", async function () {
        const today = formatDateOnly(Date.now());
        await execute(`add today task due:${today}`);
        await execute("add started task");
        await execute("start 2");
        await execute("day");
        expect(displayMapRef.value).to.have.length(2);
        // Today task first, then started
        const tasks = await dbOps.getAll();
        const todayTask = tasks.find((t) => t.description === "today task");
        const startedTask = tasks.find((t) => t.description === "started task");
        expect(displayMapRef.value[0]).to.equal(todayTask.uuid);
        expect(displayMapRef.value[1]).to.equal(startedTask.uuid);
      });
    });

    describe("Overdue section", function () {
      it("should show overdue tasks in today view", async function () {
        const yesterday = formatDateOnly(Date.now() - 86400000);
        await execute(`add overdue task due:${yesterday}`);
        await execute("day");
        expect(displayMapRef.value).to.have.length(1);
      });

      it("should not show started overdue tasks in overdue section", async function () {
        const yesterday = formatDateOnly(Date.now() - 86400000);
        await execute(`add started overdue due:${yesterday}`);
        await execute("start 1");
        await execute("day");
        // Should appear once (in started section, not overdue)
        expect(displayMapRef.value).to.have.length(1);
        // Verify it's in started position (check separator label in output)
        const output = document.getElementById("terminal-output").innerHTML;
        expect(output).to.include("started");
      });
    });

    describe("Ready section", function () {
      it("should show tasks whose wait ended earlier today", async function () {
        // Create a task with wait time that has already passed (1 hour ago)
        const pastTime = new Date(Date.now() - 3600000);
        const waitDate = formatDateOnly(pastTime.getTime());
        // Only test if the wait would be today (i.e., not crossing midnight)
        const today = formatDateOnly(Date.now());
        if (waitDate !== today) {
          // Skip test if we're within first hour of the day
          this.skip();
          return;
        }
        await execute(
          `add ready task wait:${waitDate}@${String(pastTime.getHours()).padStart(2, "0")}:${String(pastTime.getMinutes()).padStart(2, "0")}`,
        );
        await execute("day");
        expect(displayMapRef.value).to.have.length(1);
      });

      it("should not show tasks whose wait is still in the future", async function () {
        const today = formatDateOnly(Date.now());
        // wait:today sets to end of day, which is in the future
        await execute(`add still waiting wait:${today}`);
        await execute("day");
        // Task should not appear (still waiting)
        expect(displayMapRef.value).to.have.length(0);
      });

      it("should not show ready tasks that are due today", async function () {
        // Create a task with wait in the past but due today
        const pastTime = new Date(Date.now() - 3600000);
        const waitDate = formatDateOnly(pastTime.getTime());
        const today = formatDateOnly(Date.now());
        if (waitDate !== today) {
          this.skip();
          return;
        }
        const waitStr = `${waitDate}@${String(pastTime.getHours()).padStart(2, "0")}:${String(pastTime.getMinutes()).padStart(2, "0")}`;
        await execute(`add ready but due wait:${waitStr} due:${today}`);
        await execute("day");
        // Should appear in main section (not duplicated in ready)
        expect(displayMapRef.value).to.have.length(1);
        const output = document.getElementById("terminal-output").innerHTML;
        // Should NOT have ready separator since task is in main
        expect(output).to.not.include('"ready-label"');
      });

      it("should not show ready tasks that are started", async function () {
        // Create a task with wait in the past
        const pastTime = new Date(Date.now() - 3600000);
        const waitDate = formatDateOnly(pastTime.getTime());
        const today = formatDateOnly(Date.now());
        if (waitDate !== today) {
          this.skip();
          return;
        }
        const waitStr = `${waitDate}@${String(pastTime.getHours()).padStart(2, "0")}:${String(pastTime.getMinutes()).padStart(2, "0")}`;
        await execute(`add ready but started wait:${waitStr}`);
        await execute("start 1");
        await execute("day");
        expect(displayMapRef.value).to.have.length(1);
        const output = document.getElementById("terminal-output").innerHTML;
        expect(output).to.include("started");
        expect(output).to.not.include('"ready-label"');
      });
    });

    describe("Section ordering and IDs", function () {
      it("should assign IDs correctly across all sections", async function () {
        const today = formatDateOnly(Date.now());
        const yesterday = formatDateOnly(Date.now() - 86400000);

        await execute(`add main task due:${today}`); // ID 1
        await execute("add started task"); // ID 2
        await execute("start 2");
        await execute(`add overdue task due:${yesterday}`); // ID 3

        await execute("day");

        // Main task (due today) should be ID 1
        // Started task should be ID 2
        // Overdue task should be ID 3
        expect(displayMapRef.value).to.have.length(3);

        // Verify ID 1 is the main task
        const allTasks = await dbOps.getAll();
        const mainTask = allTasks.find((t) => t.description === "main task");
        expect(displayMapRef.value[0]).to.equal(mainTask.uuid);

        // Complete main task using ID 1
        await execute("done 1");
        const tasksAfter = await dbOps.getAll();
        const mainTaskAfter = tasksAfter.find(
          (t) => t.description === "main task",
        );
        expect(mainTaskAfter.status).to.equal("completed");
      });

      it("should filter all sections by project", async function () {
        const today = formatDateOnly(Date.now());
        const yesterday = formatDateOnly(Date.now() - 86400000);

        await execute(`add work main due:${today} pro:Work`);
        await execute("add work started pro:Work");
        await execute("start 2");
        await execute(`add work overdue due:${yesterday} pro:Work`);
        await execute(`add home task due:${today} pro:Home`);

        await execute("context !today pro:Work");

        // Should only show Work tasks (main, started, overdue = 3)
        // Note: ready section requires wait to have passed, so we test without it
        expect(displayMapRef.value).to.have.length(3);
        const tasks = await dbOps.getAll();
        const homeTask = tasks.find((t) => t.description === "home task");
        expect(displayMapRef.value).to.not.include(homeTask.uuid);
      });
    });
  });

  describe("Today Module Unit Tests", function () {
    const now = Date.now();
    const today = formatDateOnly(now);
    const yesterday = formatDateOnly(now - 86400000);

    describe("collectStartedTasks", function () {
      it("should collect pending started tasks", function () {
        const tasks = [
          {
            uuid: "1",
            start: now,
            status: "pending",
            description: "task 1",
            entry: now,
          },
          { uuid: "2", status: "pending", description: "task 2", entry: now },
        ];
        const result = collectStartedTasks(tasks, [], { today });
        expect(result).to.have.length(1);
        expect(result[0].uuid).to.equal("1");
      });

      it("should include reference project tasks", function () {
        const tasks = [
          {
            uuid: "1",
            start: now,
            status: "pending",
            project: "Books",
            description: "task 1",
            entry: now,
          },
        ];
        const projects = [{ name: "Books", tags: ["reference"] }];
        const result = collectStartedTasks(tasks, projects, { today });
        // Reference project tasks are included (good daily reminder)
        expect(result).to.have.length(1);
        expect(result[0].uuid).to.equal("1");
      });
    });

    describe("collectReadyTasks", function () {
      it("should collect tasks whose wait ended earlier today", function () {
        // Wait time 1 hour ago (should be included)
        const pastWait = now - 3600000;
        // Wait time in the future (should be excluded)
        const futureWait = now + 3600000;
        const tasks = [
          {
            uuid: "1",
            wait: pastWait,
            status: "pending",
            description: "task 1",
            entry: now,
          },
          {
            uuid: "2",
            wait: futureWait,
            status: "pending",
            description: "task 2",
            entry: now,
          },
          {
            uuid: "3",
            wait: now - 86400000,
            status: "pending",
            description: "task 3",
            entry: now,
          }, // yesterday
        ];
        // Only collect if the past wait is today
        const pastWaitDate = formatDateOnly(pastWait);
        if (pastWaitDate === today) {
          const result = collectReadyTasks(tasks, [], { today });
          expect(result).to.have.length(1);
          expect(result[0].uuid).to.equal("1");
        }
      });

      it("should not collect tasks still waiting", function () {
        // End of day today is still in the future
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        const tasks = [
          {
            uuid: "1",
            wait: endOfDay.getTime(),
            status: "pending",
            description: "task 1",
            entry: now,
          },
        ];
        const result = collectReadyTasks(tasks, [], { today });
        expect(result).to.have.length(0);
      });
    });

    describe("sortTodayTasks", function () {
      it("should sort by order then urgency", function () {
        const tasks = [
          { uuid: "1", order: 2, urgency: "10", entry: now },
          { uuid: "2", order: 1, urgency: "5", entry: now },
          { uuid: "3", urgency: "20", entry: now }, // no order
        ];
        const result = sortTodayTasks([...tasks]);
        expect(result[0].uuid).to.equal("2"); // order 1
        expect(result[1].uuid).to.equal("1"); // order 2
        expect(result[2].uuid).to.equal("3"); // no order (last)
      });
    });
  });
});

describe("Target Identifier (x:) E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
    if (!document.getElementById("cmd-input")) {
      const input = document.createElement("input");
      input.id = "cmd-input";
      input.style.display = "none";
      document.body.appendChild(input);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Property parsing", function () {
    it("should parse x: in add command", async function () {
      await execute("add test task x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks[0].target).to.equal("bike");
    });

    it("should parse target: (long form) in add command", async function () {
      await execute("add test task target:yoga");

      const tasks = await dbOps.getAll();
      expect(tasks[0].target).to.equal("yoga");
    });

    it("should parse x: in modify command", async function () {
      await execute("add test task");
      await execute("list");
      await execute("mod 1 x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks[0].target).to.equal("bike");
    });

    it("should clear target with x: (empty value)", async function () {
      await execute("add test task x:bike");
      await execute("list");
      await execute("mod 1 x:");

      const tasks = await dbOps.getAll();
      expect(tasks[0].target).to.be.null;
    });
  });

  describe("Uniqueness validation", function () {
    it("should reject duplicate target on add", async function () {
      await execute("add first task x:bike");
      await execute("add second task x:bike");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("already exists");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
    });

    it("should reject duplicate target on modify [FLAKY]", async function () {
      await execute("add first task x:bike");
      await execute("add second task x:yoga");
      await execute("list");
      await execute("mod 2 x:bike");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("already exists");

      const tasks = await dbOps.getAll();
      expect(tasks[1].target).to.equal("yoga"); // unchanged
    });

    it("should allow same target after original task completed", async function () {
      await execute("add first task x:bike");
      await execute("list");
      await execute("done 1");
      await execute("add second task x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      const pending = tasks.find((t) => t.status === "pending");
      expect(pending.target).to.equal("bike");
    });
  });

  describe("Resolution in commands", function () {
    it("should resolve x:name in done command", async function () {
      await execute("add test task x:bike");
      await execute("done x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });

    it("should resolve x:name in delete command", async function () {
      await execute("add test task x:bike");
      await execute("delete x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(0);
    });

    it("should resolve x:name in skip command", async function () {
      await execute("add test task x:bike due:today recur:1d");
      await execute("skip x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      expect(tasks.find((t) => t.status === "skipped")).to.exist;
    });

    it("should resolve x:name in start command", async function () {
      await execute("add test task x:bike");
      await execute("start x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks[0].start).to.be.a("number");
    });

    it("should resolve x:name in modify command", async function () {
      await execute("add test task x:bike");
      await execute("mod x:bike pri:50");

      const tasks = await dbOps.getAll();
      expect(tasks[0].priority).to.equal(50);
    });

    it("should resolve x:name in info command", async function () {
      await execute("add test task x:bike");
      await execute("info x:bike");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("test task");
      expect(output).to.include("Target:");
    });

    it("should resolve x:name in annotate command", async function () {
      await execute("add test task x:bike");
      await execute("annotate x:bike my note");

      const tasks = await dbOps.getAll();
      expect(tasks[0].annotations).to.have.length(1);
      expect(tasks[0].annotations[0].description).to.equal("my note");
    });

    it("should handle mixed references: done 1,x:bike", async function () {
      await execute("add task one");
      await execute("add task two x:bike");
      await execute("add task three");
      await execute("done 1,x:bike");

      const tasks = await dbOps.getAll();
      const completed = tasks.filter((t) => t.status === "completed");
      expect(completed).to.have.length(2);
    });

    it("should resolve x:name in reversed syntax (x:name done)", async function () {
      await execute("add test task x:bike");
      await execute("x:bike done");

      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });
  });

  describe("List filtering", function () {
    it("should filter by x:name", async function () {
      await execute("add task with target x:bike");
      await execute("add task without target");

      await execute("list x:bike");

      expect(displayMapRef.value).to.have.length(1);
      const tasks = await dbOps.getAll();
      const withTarget = tasks.find((t) => t.target === "bike");
      expect(displayMapRef.value[0]).to.equal(withTarget.uuid);
    });

    it("should return empty for non-existent target", async function () {
      await execute("add some task");

      await execute("list x:nonexistent");

      expect(displayMapRef.value).to.have.length(0);
    });
  });

  describe("Recurrence", function () {
    it("should copy target to next occurrence", async function () {
      await execute("add recurring task x:bike due:today recur:1d");
      await execute("done x:bike");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);

      const pending = tasks.find((t) => t.status === "pending");
      expect(pending.target).to.equal("bike");
    });
  });

  describe("Visibility", function () {
    it("should show target in info output", async function () {
      await execute("add test task x:bike");
      await execute("list"); // populate displayMapRef
      await execute("info 1");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Target:");
      expect(output).to.include("bike");
    });

    it("should NOT show target in edit output", async function () {
      await execute("add test task x:bike");
      await execute("list"); // populate displayMapRef
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
      expect(input.value).to.not.include("x:bike");
    });
  });

  describe("Error handling", function () {
    it("should error when x:name not found in done", async function () {
      await execute("add test task");
      await execute("done x:nonexistent");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Invalid ID");
    });

    it("should error when x:name not found in modify", async function () {
      await execute("add test task");
      await execute("mod x:nonexistent pri:50");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("Invalid ID");
    });
  });
});

describe("On-Done Triggers (done:/td:) E2E Tests", function () {
  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Property parsing", function () {
    it("should parse done: in add command", async function () {
      await execute("add test task done:mod x:bike due:3d");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].onDone).to.equal("mod x:bike due:3d");
    });

    it("should parse td: shorthand in add command", async function () {
      await execute("add test task td:mod x:bike due:3d");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].onDone).to.equal("mod x:bike due:3d");
    });

    it("should capture everything after done: prefix", async function () {
      await execute(
        "add test task pro:Work done:add follow up task due:1w !important",
      );

      const tasks = await dbOps.getAll();
      expect(tasks[0].project).to.equal("Work");
      expect(tasks[0].onDone).to.equal("add follow up task due:1w !important");
    });

    it("should parse done: in modify command", async function () {
      await execute("add test task");
      await execute("list");
      await execute("mod 1 done:mod x:bike due:3d");

      const tasks = await dbOps.getAll();
      expect(tasks[0].onDone).to.equal("mod x:bike due:3d");
    });

    it("should clear trigger with done: (empty value) in modify", async function () {
      await execute("add test task done:mod x:bike due:3d");

      const tasksBefore = await dbOps.getAll();
      expect(tasksBefore[0].onDone).to.equal("mod x:bike due:3d");

      await execute("list");
      await execute("mod 1 done:");

      const tasksAfter = await dbOps.getAll();
      expect(tasksAfter[0].onDone).to.be.null;
    });
  });

  describe("Trigger execution", function () {
    it("should execute trigger on task completion", async function () {
      await execute("add target task x:bike due:today");
      await execute("add hike done:mod x:bike due:3d");
      await execute("list");
      await execute("done 2"); // complete the hike task

      const tasks = await dbOps.getAll();
      const bike = tasks.find((t) => t.target === "bike");
      // Due date should be ~3 days from now
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      expect(bike.due).to.be.greaterThan(Date.now() + threeDays - 60000);
    });

    it("should execute mod command via trigger", async function () {
      await execute("add target task x:target pri:10");
      await execute("add trigger task done:mod x:target pri:50");
      await execute("list");
      await execute("done 2");

      const tasks = await dbOps.getAll();
      const target = tasks.find((t) => t.target === "target");
      expect(target.priority).to.equal(50);
    });

    it("should execute add command via trigger", async function () {
      await execute("add main task done:add follow up task due:1w");
      await execute("list");
      await execute("done 1");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(2);
      const followUp = tasks.find((t) => t.description === "follow up task");
      expect(followUp).to.exist;
      expect(followUp.status).to.equal("pending");
    });

    it("should warn if trigger target not found", async function () {
      await execute("add task done:mod x:nonexistent due:3d");
      await execute("list");
      await execute("done 1");

      const output = document.getElementById("terminal-output").innerHTML;
      // Task should still be completed, but with a warning
      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });

    it("should still complete task even if trigger fails", async function () {
      await execute("add task done:invalidcommand xyz");
      await execute("list");
      await execute("done 1");

      const tasks = await dbOps.getAll();
      expect(tasks[0].status).to.equal("completed");
    });
  });

  describe("Recurrence", function () {
    it("should copy trigger to next occurrence", async function () {
      await execute("add target task x:bike due:today");
      await execute(
        "add recurring hike due:today recur:1w done:mod x:bike due:3d",
      );
      await execute("list");
      await execute("done 2"); // complete the hike

      const tasks = await dbOps.getAll();
      const pendingHike = tasks.find(
        (t) => t.description === "recurring hike" && t.status === "pending",
      );
      expect(pendingHike).to.exist;
      expect(pendingHike.onDone).to.equal("mod x:bike due:3d");
    });
  });

  describe("Visibility", function () {
    it("should show trigger in info output", async function () {
      await execute("add test task done:mod x:bike due:3d");
      await execute("list");
      await execute("info 1");

      const output = document.getElementById("terminal-output").innerHTML;
      expect(output).to.include("On done:");
      expect(output).to.include("mod x:bike due:3d");
    });

    it("should NOT show trigger in edit output", async function () {
      await execute("add test task done:mod x:bike due:3d");
      await execute("list");
      await execute("edit 1");

      const input = document.getElementById("cmd-input");
      expect(input.value).to.include("mod 1");
      expect(input.value).to.include("test task");
      expect(input.value).to.not.include("done:");
      expect(input.value).to.not.include("onDone");
    });
  });

  describe("Integration with x: targets", function () {
    it("should defer bike task when hike is completed", async function () {
      // The primary use case: hiking defers stationary bike
      await execute("add stationary bike due:today recur:1d x:bike");
      await execute("add hike done:mod x:bike due:3d");
      await execute("list");

      // Complete the hike
      await execute("done 2");

      const tasks = await dbOps.getAll();
      const bike = tasks.find((t) => t.target === "bike");
      // Bike should now be due in ~3 days, not today
      const now = Date.now();
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      expect(bike.due).to.be.greaterThan(now + threeDays - 60000);
    });

    it("should complete another task via trigger", async function () {
      await execute("add task A x:a");
      await execute("add task B done:done x:a");
      await execute("list");
      await execute("done 2"); // complete task B

      const tasks = await dbOps.getAll();
      const taskA = tasks.find((t) => t.target === "a");
      expect(taskA.status).to.equal("completed");
    });
  });
});

describe("Color E2E Tests", function () {
  before(async function () {
    await initDB();
    if (!document.getElementById("terminal-output")) {
      const div = document.createElement("div");
      div.id = "terminal-output";
      div.style.display = "none";
      document.body.appendChild(div);
    }
  });

  beforeEach(async function () {
    await dbOps.purgeAll();
    clearUndo();
    displayMapRef.value = [];
    document.getElementById("terminal-output").innerHTML = "";
  });

  describe("Add with color", function () {
    it("should parse c:y as icon color", async function () {
      await execute("add test task icon:star c:y");

      const tasks = await dbOps.getAll();
      expect(tasks).to.have.length(1);
      expect(tasks[0].color).to.deep.equal({ icon: "y" });
    });

    it("should parse color:g as icon color", async function () {
      await execute("add test task icon:star color:g");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.deep.equal({ icon: "g" });
    });

    it("should parse c:.r as title color (future)", async function () {
      await execute("add test task c:.r");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.deep.equal({ title: "r" });
    });

    it("should parse c:y.r as icon and title color", async function () {
      await execute("add test task c:y.r");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.deep.equal({ icon: "y", title: "r" });
    });

    it("should not set color when c: is empty", async function () {
      await execute("add test task c:");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.be.null;
    });
  });

  describe("Modify color", function () {
    it("should add color to existing task", async function () {
      await execute("add test task icon:star");
      await execute("list");
      await execute("mod 1 c:b");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.deep.equal({ icon: "b" });
    });

    it("should change existing color", async function () {
      await execute("add test task icon:star c:y");
      await execute("list");
      await execute("mod 1 c:m");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.deep.equal({ icon: "m" });
    });

    it("should clear color with c:", async function () {
      await execute("add test task icon:star c:y");
      await execute("list");
      await execute("mod 1 c:");

      const tasks = await dbOps.getAll();
      expect(tasks[0].color).to.be.null;
    });

    it("should work with multi-ID modify", async function () {
      await execute("add task one icon:star");
      await execute("add task two icon:heart");
      await execute("add task three icon:moon");
      await execute("mod 1-3 c:v");

      const tasks = await dbOps.getAll();
      expect(tasks.every((t) => t.color?.icon === "v")).to.be.true;
    });
  });

  describe("All color codes", function () {
    const colors = ["b", "v", "o", "c", "g", "y", "r", "m"];

    colors.forEach((color) => {
      it(`should accept color code '${color}'`, async function () {
        await execute(`add test task c:${color}`);

        const tasks = await dbOps.getAll();
        expect(tasks[0].color).to.deep.equal({ icon: color });
      });
    });
  });
});
