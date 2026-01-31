// Reference search command - fuzzy search for reference project tasks
// Uses trigram-based matching for tolerant search

import { dbOps } from "./db.js";
import { getContext } from "./context.js";
import { expandVirtualTagShorthand, calculateUrgency } from "./logic.js";
import { renderTable } from "./ui.js";
import { getTrigrams, calculateTrigramScore } from "./search.js";

// Check if task belongs to a reference project (including parent projects)
const isReferenceTask = (task, projectsMeta) => {
  if (!task.project) return false;

  // Check the task's project and all parent projects
  // For "games.gb.ref", check "games.gb.ref", "games.gb", and "games"
  const projectParts = task.project.split(".");
  for (let i = projectParts.length; i > 0; i--) {
    const projectPath = projectParts.slice(0, i).join(".");

    // Check if project name ends with .ref
    if (projectPath.endsWith(".ref")) {
      return true;
    }

    // Check if project is tagged with !ref or !reference
    if (projectsMeta.length > 0) {
      const projMeta = projectsMeta.find((p) => p.name === projectPath);
      if (
        projMeta?.tags?.some((tag) =>
          ["reference", "ref"].includes(tag.toLowerCase()),
        )
      ) {
        return true;
      }
    }
  }

  return false;
};

// Apply custom sorting to task list
const applySorting = (tasks, sortParam) => {
  const fieldMap = {
    start: "start",
    st: "start",
    end: "end",
    e: "end",
    pri: "priority",
    priority: "priority",
    pro: "project",
    project: "project",
    due: "due",
    urg: "urgency",
    urgency: "urgency",
    desc: "description",
    description: "description",
    alpha: "description",
    entry: "entry",
    create: "entry",
    created: "entry",
    c: "entry",
    modified: "modified",
    mod: "modified",
    m: "modified",
  };

  const sortFields = sortParam.split(",");

  tasks.sort((a, b) => {
    for (const field of sortFields) {
      const desc = field.startsWith("-");
      const key = desc ? field.slice(1) : field;
      const mapped = fieldMap[key] || key;
      let av = a[mapped],
        bv = b[mapped];

      // Treat non-numeric priorities as null for sorting
      if (mapped === "priority") {
        if (typeof av !== "number") av = null;
        if (typeof bv !== "number") bv = null;
      }

      const isDate = ["start", "end", "due", "entry", "modified"].includes(
        mapped,
      );
      const isNum = ["urgency", "priority"].includes(mapped) || isDate;
      let dir = isDate || mapped === "priority" ? -1 : 1;
      if (desc) dir = -dir;

      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (isNum) {
        const diff = (parseFloat(av) - parseFloat(bv)) * dir;
        if (diff !== 0) return diff;
      } else {
        const cmp = String(av).localeCompare(String(bv)) * dir;
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  });
};

export const handleRef = async (ctx) => {
  // Separate search terms from virtual tags and sort parameter
  const searchTerms = [];
  const flags = [];
  let sortParam = null;

  for (const arg of ctx.args) {
    if (arg.startsWith("!")) {
      flags.push(arg);
    } else if (arg.startsWith("sort:") || arg.startsWith("s:")) {
      sortParam = arg.split(":")[1];
    } else {
      searchTerms.push(arg);
    }
  }

  const query = searchTerms.join(" ").trim();

  if (!query && flags.length === 0) {
    ctx.print(
      '<span class="msg-error">Usage: ref &lt;search query&gt;</span>',
      false,
      {
        dismissible: true,
      },
    );
    ctx.setPassthrough(true);
    return;
  }

  // Get all tasks and projects
  const allTasks = await dbOps.getAll();
  const projectsMeta = await dbOps.getAllProjects();

  // Filter to reference project tasks only
  let referenceTasks = allTasks.filter((t) => isReferenceTask(t, projectsMeta));

  // Default: Filter to pending only, unless !done, !skipped, !ended or !all is present
  // Check ctx.args and context
  const currentContext = getContext();
  const allArgs = [
    ...ctx.args,
    ...(currentContext ? currentContext.tags.map((t) => "!" + t) : []),
  ];

  let showDone = false;
  let showSkipped = false;
  let showAll = false;

  for (const arg of allArgs) {
    if (arg.startsWith("!")) {
      const expanded = expandVirtualTagShorthand(arg).toUpperCase();
      if (
        expanded === "!DONE" ||
        expanded === "!COMPLETED" ||
        expanded === "!ENDED"
      )
        showDone = true;
      if (expanded === "!SKIPPED" || expanded === "!ENDED") showSkipped = true;
      if (expanded === "!ALL") showAll = true;
    }
  }

  if (!showAll && !showDone && !showSkipped) {
    referenceTasks = referenceTasks.filter((t) => t.status === "pending");
  } else {
    referenceTasks = referenceTasks.filter((t) => {
      if (showAll) return true;
      if (showDone && t.status === "completed") return true;
      if (showSkipped && t.status === "skipped") return true;
      return false;
    });
  }

  if (referenceTasks.length === 0) {
    ctx.print(
      '<span class="msg-warning">No reference projects found. Use "pro:Name.ref" naming or "mod pro:Name !ref" to mark projects as reference.</span>',
      false,
      { dismissible: true },
    );
    ctx.setPassthrough(true);
    return;
  }

  // For very short queries (< 3 chars), use simple substring matching
  if (query.length < 3) {
    const queryLower = query.toLowerCase();
    const matches = referenceTasks.filter((t) => {
      if (t.description?.toLowerCase().includes(queryLower)) return true;
      if (
        t.annotations?.some((a) =>
          a.description?.toLowerCase().includes(queryLower),
        )
      )
        return true;
      if (t.url?.toLowerCase().includes(queryLower)) return true;
      return false;
    });

    // Sort by custom sort field or default (description match, then entry date)
    if (sortParam) {
      applySorting(matches, sortParam);
    } else {
      matches.sort((a, b) => {
        const aDescMatch = a.description?.toLowerCase().includes(queryLower);
        const bDescMatch = b.description?.toLowerCase().includes(queryLower);
        if (aDescMatch && !bDescMatch) return -1;
        if (!aDescMatch && bDescMatch) return 1;
        return b.entry - a.entry;
      });
    }

    if (matches.length === 0) {
      ctx.print(
        `<span class="msg-info">No references found for "${query}"</span>`,
        false,
        { dismissible: true },
      );
      ctx.setPassthrough(true);
      return;
    }

    ctx.displayMapRef.value = matches.map((t) => t.uuid);
    renderTable(matches, allTasks, ctx.displayMapRef, projectsMeta);
    ctx.setPassthrough(true);
    return;
  }

  // Trigram-based fuzzy search for longer queries
  const queryTrigrams = getTrigrams(query);
  const queryLower = query.toLowerCase();

  // Score each task
  const scoredTasks = referenceTasks
    .map((task) => {
      let score = 0;

      // Description: 10x weight
      score += calculateTrigramScore(queryTrigrams, task.description, 10);

      // Annotations: 5x weight (join all annotation descriptions)
      if (task.annotations && task.annotations.length > 0) {
        const annotationsText = task.annotations
          .map((a) => a.description || "")
          .join(" ");
        score += calculateTrigramScore(queryTrigrams, annotationsText, 5);
      }

      // URL: 2x weight
      score += calculateTrigramScore(queryTrigrams, task.url, 2);

      // Bonus for exact substring match in description
      if (task.description?.toLowerCase().includes(queryLower)) {
        score += 50;
      }

      return { task, score };
    })
    .filter((item) => item.score > 0);

  if (scoredTasks.length === 0) {
    ctx.print(
      `<span class="msg-info">No references found for "${query}"</span>`,
      false,
      { dismissible: true },
    );
    ctx.setPassthrough(true);
    return;
  }

  // Extract tasks and sort by custom field or relevance score
  let results;
  if (sortParam) {
    results = scoredTasks.map((item) => item.task);
    applySorting(results, sortParam);
  } else {
    // Sort by score descending
    scoredTasks.sort((a, b) => b.score - a.score);
    results = scoredTasks.map((item) => item.task);
  }

  ctx.displayMapRef.value = results.map((t) => t.uuid);

  // Render table
  renderTable(results, allTasks, ctx.displayMapRef, projectsMeta);
  ctx.setPassthrough(true);
};
