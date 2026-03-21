const { expect } = chai;
import { handleStart, handleStop } from "../src/js/commands-state.js";
import { handleInfo } from "../src/js/commands-tasks.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";

let lastPrint = "";
const mockPrint = (html) => { lastPrint = html; };

const mockCtx = {
  args: [],
  targetId: null,
  print: mockPrint,
  dbOps: dbOps,
  displayMapRef: displayMapRef,
  markDirty: () => {},
  runListRefresh: async () => {},
};

const TASK_UUID = "test-stop-uuid-1";

describe("Stop Command Tests", function () {
  before(async function () {
    await initDB();
    await dbOps.purgeAll();
    await dbOps.add({
      uuid: TASK_UUID,
      description: "Stop test task",
      status: "pending",
      entry: Date.now(),
      tags: [],
    });
    displayMapRef.value = [TASK_UUID];
  });

  it("should silently skip if task is not active", async function () {
    mockCtx.targetId = "1";
    mockCtx.args = [];
    await handleStop(mockCtx);
    const t = await dbOps.get(TASK_UUID);
    expect(t.touches).to.be.undefined; // no touches incremented
  });

  it("should start a task", async function () {
    mockCtx.targetId = "1";
    await handleStart(mockCtx);
    expect(lastPrint).to.include("Started");
    const t = await dbOps.get(TASK_UUID);
    expect(t.start).to.be.a("number");
  });

  it("should stop a task and increment touches to 1", async function () {
    mockCtx.targetId = "1";
    await handleStop(mockCtx);
    expect(lastPrint).to.include("Stopped");
    const t = await dbOps.get(TASK_UUID);
    expect(t.start).to.be.undefined;
    expect(t.touches).to.equal(1);
  });

  it("should not be active after stop", async function () {
    const t = await dbOps.get(TASK_UUID);
    expect(t.start).to.be.undefined;
  });

  it("should accumulate touches across multiple start/stop cycles", async function () {
    mockCtx.targetId = "1";

    await handleStart(mockCtx);
    await handleStop(mockCtx);
    let t = await dbOps.get(TASK_UUID);
    expect(t.touches).to.equal(2);

    await handleStart(mockCtx);
    await handleStop(mockCtx);
    t = await dbOps.get(TASK_UUID);
    expect(t.touches).to.equal(3);
  });

  it("should show touches in info", async function () {
    mockCtx.targetId = "1";
    await handleInfo(mockCtx);
    expect(lastPrint).to.include("Touches:</b> 3");
  });

  it("touches should survive undo of stop", async function () {
    // Start then stop (touches becomes 4)
    mockCtx.targetId = "1";
    await handleStart(mockCtx);
    await handleStop(mockCtx);
    const t = await dbOps.get(TASK_UUID);
    expect(t.touches).to.equal(4);
  });
});
