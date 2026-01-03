import { calculateUrgency } from "../src/js/logic.js";

// Mock C constant to verify values if needed, but we import from logic.js
// Mock Date.now
const now = 1700000000000;
const originalDateNow = Date.now;
Date.now = () => now;

const runTest = () => {
  console.log("Running Urgency Reproduction Test");

  const taskBlocked = {
    uuid: "t1",
    description: "Blocked Task",
    status: "pending",
    entry: now - 100000,
    depends: ["t2"],
    project: "TestProj", // +1.0
  };

  const taskBlocker = {
    uuid: "t2",
    description: "Blocker Task",
    status: "pending",
    entry: now,
  };

  const allTasks = [taskBlocked, taskBlocker];

  const urgency = calculateUrgency(taskBlocked, allTasks, []);
  console.log(`Blocked Task Urgency: ${urgency}`);

  // Expected:
  // Project: +1.0
  // Blocked: -5.0
  // Age: small positive
  // Total should be negative around -4.0

  if (parseFloat(urgency) < 0) {
    console.log("PASS: Urgency is negative");
  } else {
    console.log("FAIL: Urgency is NOT negative");
  }

  // Test with High Priority
  taskBlocked.priority = 50; // +6.0
  // Urgency should now be around +2.0
  const urgencyPri = calculateUrgency(taskBlocked, allTasks, []);
  console.log(`Blocked High Priority Task Urgency: ${urgencyPri}`);

  // If the user wants blocked tasks to NEVER show, this should probably be negative too.
};

runTest();
Date.now = originalDateNow;
