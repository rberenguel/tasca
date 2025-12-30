const { expect } = chai;

// We need to import modules to test them.
// Since test_tasca.js is loaded as module, we can import from src relative paths.
import {
  calculateUrgency,
  hasVirtualTag,
  matchesProject,
  getDaysRemaining,
} from "../src/js/logic.js";
import { generateUUID } from "../src/js/utils.js";

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
      const t = { entry: now, priority: "H", tags: [] };
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
});
