const { expect } = chai;
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";
import { handleAdd } from "../src/js/commands-tasks.js";
import { handleDone, handleUndone } from "../src/js/commands-state.js";
import { handleChecklist } from "../src/js/commands-checklist.js";

// Mock print function
let lastPrint = "";
const mockPrint = (html) => {
  lastPrint = html;
};

// Mock ctx factory
const createMockCtx = () => ({
  args: [],
  targetId: null,
  print: mockPrint,
  dbOps: dbOps,
  displayMapRef: displayMapRef,
  markDirty: () => {},
  runListRefresh: async () => {},
});

describe("Undone Command Tests", function () {
  beforeEach(async function () {
    await initDB();
    await dbOps.purgeAll(); // Start fresh before each test
    displayMapRef.value = [];
  });

  it("should revert a completed task to pending", async function () {
    const ctx = createMockCtx();

    // 1. Add Task
    ctx.args = ["Test Task"];
    await handleAdd(ctx);
    let all = await dbOps.getAll();
    expect(all).to.have.lengthOf(1);
    const taskUuid = all[0].uuid;
    displayMapRef.value = [taskUuid];

    // 2. Complete Task
    ctx.args = ["1"];
    await handleDone(ctx);
    let task = await dbOps.get(taskUuid);
    expect(task.status).to.equal("completed");
    expect(task.end).to.not.be.null;

    // 3. Undone Task
    ctx.args = ["1"];
    await handleUndone(ctx);
    task = await dbOps.get(taskUuid);
    expect(task.status).to.equal("pending");
    expect(task.end).to.be.null;
  });

  it("should delete future instance for recurring tasks", async function () {
    const ctx = createMockCtx();

    // 1. Add Recurring Task
    ctx.args = ["Rec Task", "recur:1d", "due:today"];
    await handleAdd(ctx);
    let all = await dbOps.getAll();
    const originalUuid = all[0].uuid;
    displayMapRef.value = [originalUuid];

    // 2. Complete Task
    ctx.args = ["1"];
    await handleDone(ctx);
    
    // Verify recurrence
    all = await dbOps.getAll();
    expect(all).to.have.lengthOf(2);
    const completedTask = all.find(t => t.uuid === originalUuid);
    const futureTask = all.find(t => t.uuid !== originalUuid);
    expect(completedTask.status).to.equal("completed");
    expect(futureTask.status).to.equal("pending");

    // 3. Undone Task - Target the FUTURE task
    // This simulates the user selecting the only task they see (the new pending recurring one)
    // and expecting the previous completed one to be restored
    displayMapRef.value = [originalUuid, futureTask.uuid];
    ctx.args = ["2"]; // Index 2 is the future task
    await handleUndone(ctx);

    // Verify deletion of future task and restoration of original
    all = await dbOps.getAll();
    expect(all).to.have.lengthOf(1); 
    const revertedTask = await dbOps.get(originalUuid);
    expect(revertedTask.status).to.equal("pending");
  });

  it("should revert parent if checklist member is undone", async function () {
    const ctx = createMockCtx();

    // 1. Add Parent and Child
    ctx.args = ["Parent"];
    await handleAdd(ctx);
    ctx.args = ["Child"];
    await handleAdd(ctx);
    
    let all = await dbOps.getAll();
    const parentUuid = all[0].uuid;
    const childUuid = all[1].uuid;
    displayMapRef.value = [parentUuid, childUuid];

    // 2. Create Checklist
    ctx.args = ["1", "2"];
    await handleChecklist(ctx);

    // 3. Complete Child (triggers parent completion)
    ctx.args = ["2"];
    await handleDone(ctx);
    
    let parent = await dbOps.get(parentUuid);
    let child = await dbOps.get(childUuid);
    expect(child.status).to.equal("completed");
    expect(parent.status).to.equal("completed");

    // 4. Undone Child
    ctx.args = ["2"];
    await handleUndone(ctx);

    parent = await dbOps.get(parentUuid);
    child = await dbOps.get(childUuid);
    expect(child.status).to.equal("pending");
    expect(parent.status).to.equal("pending"); // Auto-reverted
  });
});
