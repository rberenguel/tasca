const { expect } = chai;
import { handleTrack, handleInfo } from "../src/js/commands-tasks.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";

// Mock print function
let lastPrint = "";
const mockPrint = (html) => {
  lastPrint = html;
};

// Mock ctx
const mockCtx = {
  args: [],
  targetId: null,
  print: mockPrint,
  dbOps: dbOps,
  displayMapRef: displayMapRef,
  markDirty: () => {},
  runListRefresh: async () => {
    mockCtx.refreshCalled = true;
  },
  refreshCalled: false,
};

describe("Track Command Tests", function () {
  before(async function () {
    await initDB();
    await dbOps.purgeAll(); // Start fresh
  });

  let taskUuid;

  it("should create a task", async function () {
    const task = {
      uuid: "test-uuid-1",
      description: "Test Task",
      status: "pending",
      entry: Date.now(),
      project: "TestProject", // Adding project for completeness
      tags: [],
    };
    await dbOps.add(task);

    // Verify it exists immediately
    const check = await dbOps.get("test-uuid-1");
    expect(check).to.not.be.undefined;
    expect(check.uuid).to.equal("test-uuid-1");

    taskUuid = "test-uuid-1";
    displayMapRef.value = [taskUuid];
  });

  it("should track minutes", async function () {
    mockCtx.targetId = "1";
    mockCtx.args = ["30m"];

    // Debug
    const taskBefore = await dbOps.get(taskUuid);
    if (!taskBefore) console.error("Task missing before track minutes test");

    await handleTrack(mockCtx);

    // Check if print called with success
    if (!lastPrint.includes("Tracked min")) {
      console.error("handleTrack output:", lastPrint);
    }
    expect(lastPrint).to.include("Tracked min");

    const t = await dbOps.get(taskUuid);
    expect(t).to.not.be.undefined;
    expect(t.track).to.have.lengthOf(1);
    expect(t.track[0].type).to.equal("min");
    expect(t.track[0].value).to.equal(30);
    expect(mockCtx.refreshCalled).to.be.true;
  });

  it("should track percentage", async function () {
    mockCtx.targetId = "1";
    mockCtx.args = ["50%"];

    await handleTrack(mockCtx);
    expect(lastPrint).to.include("Tracked pct");

    const t = await dbOps.get(taskUuid);
    expect(t.track).to.have.lengthOf(2);
    expect(t.track[1].type).to.equal("pct");
    expect(t.track[1].value).to.equal(50);
  });

  it("should track daily (nothing)", async function () {
    mockCtx.targetId = "1";
    mockCtx.args = [];

    await handleTrack(mockCtx);
    expect(lastPrint).to.include("Tracked day");

    const t = await dbOps.get(taskUuid);
    expect(t.track).to.have.lengthOf(3);
    expect(t.track[2].type).to.equal("day");
    expect(t.track[2].value).to.be.null;
  });

  it("should show tracking in info", async function () {
    mockCtx.targetId = "1";
    mockCtx.args = [];

    // mockCtx must have a valid displayMapRef for handleInfo
    // The previous tests shouldn't have mutated it, but let's ensure
    displayMapRef.value = [taskUuid];

    await handleInfo(mockCtx);
    expect(lastPrint).to.include("Tracking:");
    expect(lastPrint).to.include("30m");
    expect(lastPrint).to.include("50%");
    expect(lastPrint).to.include("worked");
  });
});
