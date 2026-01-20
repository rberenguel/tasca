const { expect } = chai;
import { runList } from "../src/js/list.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";
import { handleChecklist } from "../src/js/commands-checklist.js";

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
  runListRefresh: async () => {},
};

describe("Today View Checklist Tests", function () {
  before(async function () {
    await initDB();
    await dbOps.purgeAll(); // Start fresh
  });

  it("should hide recurring checklist member waiting for tomorrow in today view", async function () {
    // 1. Create Parent
    const parent = {
      uuid: "parent-uuid",
      description: "Parent Task",
      status: "pending",
      entry: Date.now(),
      project: "TestProject",
    };
    await dbOps.add(parent);

    // 2. Create Child
    const child = {
      uuid: "child-uuid",
      description: "Child Task",
      status: "pending",
      entry: Date.now(),
      project: "TestProject",
      recur: "1d",
    };
    await dbOps.add(child);

    // 3. Make them a checklist
    displayMapRef.value = ["parent-uuid", "child-uuid"];
    mockCtx.args = ["1", "2"];
    await handleChecklist(mockCtx);

    // Verify checklist structure
    const p = await dbOps.get("parent-uuid");
    const c = await dbOps.get("child-uuid");
    expect(p.checklist).to.equal("parent");
    expect(c.checklist).to.equal("parent-uuid");

    // 4. Set Child to waiting tomorrow (simulate completed recurring task)
    // In a real scenario, completing a recurring task would set status to pending
    // and wait/due to future. We simulate that state here.
    const tomorrow = Date.now() + 86400000;
    c.wait = tomorrow;
    c.due = tomorrow;
    await dbOps.update(c);

    // 5. Run List with !today context
    mockCtx.args = ["!today"];
    let capturedHtml = "";
    // We need to capture the renderTable output.
    // runList calls renderTable, which calls print.
    // We can spy on print.

    // Reset print buffer
    lastPrint = "";

    // Run list command
    await runList(["!today"], Infinity, null, false);

    // Check output.
    // If the bug exists, "Child Task" will be present in the output.
    // If fixed, it should NOT be present.

    // Note: renderTable uses displayMapRef to map IDs.
    // The HTML output contains the description.

    const outputContainsChild =
      String(displayMapRef.value).includes("child-uuid") ||
      lastPrint.includes("Child Task");

    // To confirm the bug exists, we expect the child to be present.
    // If this test passes, it means we have successfully reproduced the bug.
    // After fixing, we will flip this to expect false.
    expect(outputContainsChild).to.be.false;
  });
});
