const { expect } = chai;

import {
  calculateUrgency,
  hasVirtualTag,
  expandVirtualTagShorthand,
  isVirtualTag,
  C,
} from "../src/js/logic.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";
import { execute } from "../src/js/commands.js";

// Sink all terminal output so it doesn't leak into the test page
let outputDiv = document.getElementById("terminal-output");
if (!outputDiv) {
  outputDiv = document.createElement("div");
  outputDiv.id = "terminal-output";
  document.body.appendChild(outputDiv);
}
outputDiv.style.display = "none";

describe("Stream Feature Tests", function () {
  const Day = 86400000;
  const now = Date.now();

  // ── Logic / urgency ──────────────────────────────────────────────────────

  describe("Urgency", function () {
    it("stream task returns hardcoded -1000 urgency", function () {
      const t = { entry: now, tags: ["stream"] };
      expect(parseFloat(calculateUrgency(t, []))).to.equal(-1000.0);
    });

    it("stream urgency is not affected by due date", function () {
      const t = { entry: now, tags: ["stream"], due: now - Day }; // overdue
      expect(parseFloat(calculateUrgency(t, []))).to.equal(-1000.0);
    });

    it("stream urgency is not affected by priority", function () {
      const t = { entry: now, tags: ["stream"], priority: 50 };
      expect(parseFloat(calculateUrgency(t, []))).to.equal(-1000.0);
    });

    it("stream urgency is lower than someday (-100)", function () {
      const stream = { entry: now, tags: ["stream"] };
      const someday = { entry: now, tags: ["someday"] };
      expect(parseFloat(calculateUrgency(stream, []))).to.be.lessThan(
        parseFloat(calculateUrgency(someday, [])),
      );
    });

    it("C.stream constant is -1000", function () {
      expect(C.stream).to.equal(-1000.0);
    });
  });

  // ── Virtual tag ──────────────────────────────────────────────────────────

  describe("Virtual tag !stream", function () {
    it("hasVirtualTag recognises !stream", function () {
      const t = { tags: ["stream"] };
      expect(hasVirtualTag(t, "!stream", [])).to.be.true;
    });

    it("hasVirtualTag returns false for non-stream task", function () {
      const t = { tags: ["work"] };
      expect(hasVirtualTag(t, "!stream", [])).to.be.false;
    });

    it("isVirtualTag identifies STREAM as virtual", function () {
      expect(isVirtualTag("stream")).to.be.true;
      expect(isVirtualTag("STREAM")).to.be.true;
    });

    it("shorthand !str expands to !stream", function () {
      expect(expandVirtualTagShorthand("!str")).to.equal("!stream");
    });

    it("!str shorthand does not collide with !scheduled", function () {
      expect(expandVirtualTagShorthand("!s")).to.equal("!scheduled");
      expect(expandVirtualTagShorthand("!str")).to.equal("!stream");
    });
  });

  // ── End-to-end: stream / s commands ──────────────────────────────────────

  describe("stream / s commands (E2E)", function () {
    before(async function () {
      await initDB();
      await dbOps.purgeAll();
    });

    afterEach(async function () {
      await dbOps.purgeAll();
    });

    it("`stream <desc>` adds a task with !stream tag, started (active)", async function () {
      await execute("stream investigate backpressure");
      const all = await dbOps.getByStatus("pending");
      expect(all).to.have.length(1);
      expect(all[0].tags).to.include("stream");
      expect(all[0].description).to.equal("investigate backpressure");
      expect(all[0].start).to.be.a("number");
    });

    it("`s <desc>` is an alias for stream and also starts the task", async function () {
      await execute("s ping Salim");
      const all = await dbOps.getByStatus("pending");
      expect(all).to.have.length(1);
      expect(all[0].tags).to.include("stream");
      expect(all[0].description).to.equal("ping Salim");
      expect(all[0].start).to.be.a("number");
    });

    it("stream command accepts options like pro:", async function () {
      await execute("stream investigate backpressure pro:Work");
      const all = await dbOps.getByStatus("pending");
      expect(all[0].tags).to.include("stream");
      expect(all[0].project).to.equal("Work");
    });

    it("stream command with additional tags keeps !stream", async function () {
      await execute("stream review auth !urgent");
      const all = await dbOps.getByStatus("pending");
      expect(all[0].tags).to.include("stream");
      expect(all[0].tags).to.include("urgent");
    });
  });

  // ── list exclusion ────────────────────────────────────────────────────────

  describe("list exclusion", function () {
    const STREAM_UUID = "test-stream-excl-uuid";
    const NORMAL_UUID = "test-normal-excl-uuid";

    before(async function () {
      await initDB();
      await dbOps.purgeAll();
      await dbOps.add({
        uuid: STREAM_UUID,
        description: "A stream task",
        status: "pending",
        entry: now,
        tags: ["stream"],
      });
      await dbOps.add({
        uuid: NORMAL_UUID,
        description: "A normal task",
        status: "pending",
        entry: now,
        tags: [],
      });
    });

    after(async function () {
      await dbOps.purgeAll();
    });

    it("list does not show stream tasks by default", async function () {
      // After list executes, displayMapRef should only contain the normal task
      await execute("list");
      const uuids = displayMapRef.value;
      expect(uuids).to.not.include(STREAM_UUID);
      expect(uuids).to.include(NORMAL_UUID);
    });

    it("list !stream shows stream tasks", async function () {
      await execute("list !stream");
      const uuids = displayMapRef.value;
      expect(uuids).to.include(STREAM_UUID);
    });
  });

  // ── ss view sections (active vs yielding) ────────────────────────────────

  describe("ss view ordering (active vs yielding)", function () {
    const ACTIVE_UUID = "test-stream-active-uuid";
    const YIELD_UUID = "test-stream-yield-uuid";

    before(async function () {
      await initDB();
      await dbOps.purgeAll();
      // Yielding stream (no start)
      await dbOps.add({
        uuid: YIELD_UUID,
        description: "yielding stream",
        status: "pending",
        entry: now,
        tags: ["stream"],
      });
      // Active stream (has start)
      await dbOps.add({
        uuid: ACTIVE_UUID,
        description: "active stream",
        status: "pending",
        entry: now + 1,
        tags: ["stream"],
        start: now,
      });
    });

    after(async function () {
      await dbOps.purgeAll();
    });

    it("ss command sets displayMapRef with active streams first", async function () {
      await execute("ss");
      const uuids = displayMapRef.value;
      expect(uuids).to.have.length(2);
      expect(uuids[0]).to.equal(ACTIVE_UUID);
      expect(uuids[1]).to.equal(YIELD_UUID);
    });
  });
});
