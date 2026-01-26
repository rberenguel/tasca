const { expect } = chai;

import { execute } from "../src/js/commands.js";
import { initDB, dbOps } from "../src/js/db.js";
import { displayMapRef } from "../src/js/state.js";

describe("Reference Search E2E Tests", function () {
  beforeEach(async function () {
    await initDB();
    await dbOps.purgeAll();
  });

  it("should find tasks by description match in .ref projects", async function () {
    // Create tasks in .ref project
    await execute("add Python programming guide pro:books.ref");
    await execute("add JavaScript best practices pro:books.ref");
    await execute("add Cooking recipes pro:recipes");

    await execute("ref python");

    // Should find task 1
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Python programming guide");
  });

  it("should search annotations", async function () {
    await execute("add Some article pro:refs.ref");
    await execute("list"); // Populate displayMapRef
    await execute("annotate 1 Contains important machine learning concepts");

    // Verify annotation was added
    const tasks = await dbOps.getAll();
    expect(tasks[0].annotations).to.have.lengthOf(1);
    expect(tasks[0].annotations[0].description).to.include("machine learning");

    await execute("ref machine learning");

    expect(displayMapRef.value).to.have.lengthOf(1);
  });

  it("should search URLs", async function () {
    await execute("add API docs pro:docs.ref url:https://docs.python.org/api");

    await execute("ref python");

    expect(displayMapRef.value).to.have.lengthOf(1);
  });

  it("should only search reference project tasks", async function () {
    // Reference project (.ref suffix)
    await execute("add Python reference pro:refs.ref");
    // Normal project
    await execute("add Python task pro:work");

    await execute("ref python");

    // Should only find task 1 (from reference project)
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Python reference");
  });

  it("should rank exact matches higher", async function () {
    await execute("add Python programming pro:refs.ref");
    await execute("add Intro to pyt language pro:refs.ref");

    await execute("ref python");

    // Task 1 should be ranked first (exact match)
    expect(displayMapRef.value).to.have.lengthOf(2);
    const tasks = await dbOps.getAll();
    const firstTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(firstTask.description).to.equal("Python programming");
  });

  it("should handle short queries with substring matching", async function () {
    await execute("add Python guide pro:refs.ref");

    await execute("ref py");

    expect(displayMapRef.value).to.have.lengthOf(1);
  });

  it("should handle fuzzy matching with trigrams", async function () {
    await execute("add Machine learning fundamentals pro:refs.ref");

    await execute("ref machine learn");

    // Should find the task even though "learn" vs "learning"
    expect(displayMapRef.value).to.have.lengthOf(1);
  });

  it("should search tasks in subprojects of tagged reference projects", async function () {
    // Create tasks in subprojects
    await execute("add Python guide pro:books.programming.python");
    await execute("add JavaScript tutorial pro:books.programming.javascript");

    // Tag parent project as reference
    await execute("mod pro:books !ref");

    await execute("ref python");

    // Should find task because parent "books" is tagged as reference
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Python guide");
  });

  it("should treat projects ending in .ref as reference projects", async function () {
    await execute("add GB Studio Central pro:games.gb.ref");
    await execute("add ZGB Library pro:games.gb.ref");
    await execute("add Godot tutorial pro:games.godot");

    await execute("ref GB");

    // Should find both tasks in games.gb.ref but not games.godot
    expect(displayMapRef.value).to.have.lengthOf(2);
  });

  it("should search tasks in subprojects of .ref projects", async function () {
    // Create task in deep subproject
    await execute("add GB Studio guide pro:games.gb.ref.tutorials");
    await execute("add Unreal tutorial pro:games.unreal");

    await execute("ref studio");

    // Should find task because ancestor "games.gb.ref" ends with .ref
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("GB Studio guide");
  });
  it("should filter out done tasks by default", async function () {
    await execute("add Pending task pro:refs.ref");
    await execute("add Done task pro:refs.ref");
    await execute("done 2");

    await execute("ref task");

    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Pending task");
  });

  it("should show done tasks with !done override", async function () {
    await execute("add Pending task pro:refs.ref");
    await execute("add Done task pro:refs.ref");
    await execute("list"); // Ensure both items are visible
    await execute("done 2"); // Done task should be #2

    await execute("ref task !done");

    // Expecting ONLY done task (exclusive behavior)
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Done task");
  });

  it("should show skipped tasks with !skipped override", async function () {
    await execute("add Pending task pro:refs.ref");
    await execute("add Skipped task pro:refs.ref");
    await execute("list"); // Ensure visibility
    await execute("skip 2");

    await execute("ref task !skipped");

    // Expecting ONLY Skipped
    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Skipped task");
  });

  it("should show ended tasks with !ended override", async function () {
    await execute("add Pending task pro:refs.ref");
    await execute("add Done task pro:refs.ref");
    await execute("add Skipped task pro:refs.ref");
    await execute("list"); // Ensure visibility of 1, 2, 3
    await execute("done 2");
    await execute("list !all"); // Need to see them to act on them? Or just use known IDs if they persist?
    // After 'done 2', user usually sees updated list. ID 2 is gone from default list.
    // If we run `skip 3`, we assume 'Skipped task' was ID 3 in the PREVIOUS list?
    // Tasca commands normally re-render list.
    // 'Skipped task' (prev ID 3) might become ID 2 if 'Done task' (ID 2) is hidden.
    // To be safe: Use `add ...`, `skip 1` (since it's the new task shown/available).

    // Better strategy: Add, act immediately when it's the focus or clearly identifiable.
  });

  it("should respect context !done override", async function () {
    await execute("add Done task pro:refs.ref");
    await execute("done 1");

    await execute("context !done");
    await execute("ref task");

    expect(displayMapRef.value).to.have.lengthOf(1);

    // Cleanup context
    await execute("context");
  });

  it("should not use virtual tags as search query", async function () {
    // Regression test: "ref !end" was searching for "!end" string
    await execute("add Finished task pro:refs.ref");
    await execute("done 1");

    // Should show the completed task, NOT search for "!end" literal
    await execute("ref !end");

    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Finished task");
  });

  it("should show ended tasks with !ended override", async function () {
    await execute("add Pending task pro:refs.ref");

    await execute("add Done task pro:refs.ref");
    await execute("done 1"); // Completes 'Done task' (it's the only one shown after add? check behavior)
    // Actually, safer to add all then list.

    // Resetting for safety in this test block
    await dbOps.purgeAll();
    await execute("add Pending task pro:refs.ref");
    await execute("add Done task pro:refs.ref");
    await execute("add Skipped task pro:refs.ref");

    await execute("list");
    // 1: Pending, 2: Done, 3: Skipped
    await execute("done 2");

    await execute("list");
    // Now 1: Pending, 2: Skipped (since Done is hidden)
    await execute("skip 2");

    await execute("ref task !ended");

    // Expecting Done + Skipped (no Pending)
    expect(displayMapRef.value).to.have.lengthOf(2);
    const tasks = await dbOps.getAll();
    const descriptions = displayMapRef.value.map(
      (uuid) => tasks.find((t) => t.uuid === uuid).description,
    );
    expect(descriptions).to.include("Done task");
    expect(descriptions).to.include("Skipped task");
    expect(descriptions).to.not.include("Pending task");
  });

  it("should exclude pending tasks when using !end", async function () {
    await execute("add Pending task pro:refs.ref");
    await execute("add Done task pro:refs.ref");

    await execute("list");
    await execute("done 2");

    // !end should show ONLY done/skipped, NOT pending
    await execute("ref !end");

    expect(displayMapRef.value).to.have.lengthOf(1);
    const tasks = await dbOps.getAll();
    const foundTask = tasks.find((t) => t.uuid === displayMapRef.value[0]);
    expect(foundTask.description).to.equal("Done task");
  });
});
