// Task handlers: add, modify, edit, annotate, info
// Also handles project variants of modify, annotate, info

import {
  generateUUID,
  parseDate,
  parseWaitTime,
  formatDate,
  formatDateHtml,
  uniqueTimestamp,
} from "./utils.js";
import { formatInlineCode } from "./ui.js";
import { getInheritedAttributes } from "./context.js";
import { pushUndo } from "./undo.js";
import { resolveRefs } from "./commands-state.js";

// Convert icon name to full Phosphor class (handles legacy full class format)
const iconClass = (name) => {
  if (!name) return "";
  return name.startsWith("ph-") ? name : `ph-light ph-${name}`;
};

// Parse color syntax: "y" -> { icon: 'y' }, ".y" -> { title: 'y' }, "y.r" -> { icon: 'y', title: 'r' }
const parseColor = (val) => {
  if (!val) return null;
  const parts = val.split(".");
  const color = {};
  if (parts[0]) color.icon = parts[0];
  if (parts[1]) color.title = parts[1];
  return Object.keys(color).length > 0 ? color : null;
};

// Parse task object from args
const createTaskObject = (args, displayMapRef) => {
  let desc = [],
    proj = "",
    priority = null,
    order = null,
    tags = [],
    depends = [],
    due = null,
    wait = null,
    waitTime = null,
    sched = null,
    recur = null,
    url = null,
    icon = null,
    color = null,
    target = null,
    onDone = null;

  // Scan for done:/td: trigger (must be last, captures everything after)
  const argsStr = args.join(" ");
  const triggerMatch = argsStr.match(/\b(done:|td:)(.*)$/i);
  if (triggerMatch) {
    const triggerValue = triggerMatch[2].trim();
    onDone = triggerValue || null; // empty means clear
    // Remove the trigger portion from args for normal parsing
    const triggerStart = argsStr.indexOf(triggerMatch[0]);
    args = argsStr
      .substring(0, triggerStart)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  for (let token of args) {
    if (
      token.startsWith("p:") ||
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      proj = token.split(":")[1];
    else if (token.startsWith("pri:") || token.startsWith("priority:")) {
      const val = parseInt(token.split(":")[1], 10);
      if (!isNaN(val)) priority = val;
    } else if (
      token.startsWith("o:") ||
      token.startsWith("ord:") ||
      token.startsWith("order:")
    ) {
      const val = parseInt(token.split(":")[1], 10);
      if (!isNaN(val)) order = val;
    } else if (token.startsWith("dep:"))
      token
        .split(":")[1]
        .split(",")
        .forEach((id) => {
          if (displayMapRef.value[id - 1])
            depends.push(displayMapRef.value[id - 1]);
        });
    else if (token.startsWith("due:")) due = parseDate(token.split(":")[1]);
    else if (token.startsWith("wait:")) {
      const waitStr = token.split(":").slice(1).join(":");
      wait = parseDate(waitStr);
      waitTime = parseWaitTime(waitStr);
    } else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
      sched = parseDate(token.split(":")[1]);
    else if (token.startsWith("recur:") || token.startsWith("rec:"))
      recur = token.split(":")[1];
    else if (token.startsWith("url:")) url = token.substring(4);
    else if (token.startsWith("icon:")) {
      let val = token.split(":")[1];
      // Store just the icon name, not the full class
      icon = val || null;
    } else if (token.startsWith("x:") || token.startsWith("target:")) {
      target = token.split(":")[1] || null;
    } else if (token.startsWith("c:") || token.startsWith("color:")) {
      color = parseColor(token.split(":")[1]);
    } else if (token.startsWith("!")) tags.push(token.substring(1));
    else desc.push(token);
  }
  return {
    desc: desc.join(" "),
    proj,
    priority,
    order,
    tags,
    depends,
    due,
    wait,
    waitTime,
    sched,
    recur,
    url,
    icon,
    color,
    target,
    onDone,
  };
};

export const handleAdd = async (ctx) => {
  const tObj = createTaskObject(ctx.args, ctx.displayMapRef);
  if (tObj.desc.length === 0)
    return ctx.print('<span class="msg-error">No description.</span>');

  // Validate target uniqueness
  if (tObj.target) {
    const existing = await ctx.dbOps.getByStatus("pending");
    if (existing.some((t) => t.target === tObj.target)) {
      return ctx.print(
        `<span class="msg-error">Target x:${tObj.target} already exists.</span>`,
      );
    }
  }

  // Inherit context attributes if not explicitly specified
  const inherited = getInheritedAttributes();
  let proj = tObj.proj;
  let tags = tObj.tags;
  if (!proj && inherited.project) proj = inherited.project;
  if (tags.length === 0 && inherited.tags) tags = [...inherited.tags];

  const uuid = generateUUID();
  await ctx.dbOps.add({
    uuid,
    description: tObj.desc,
    project: proj,
    priority: tObj.priority,
    order: tObj.order,
    tags: tags,
    depends: tObj.depends,
    due: tObj.due,
    wait: tObj.wait,
    waitTime: tObj.waitTime,
    sched: tObj.sched,
    recur: tObj.recur,
    url: tObj.url,
    icon: tObj.icon,
    color: tObj.color,
    target: tObj.target,
    onDone: tObj.onDone,
    annotations: [],
    status: "pending",
    entry: uniqueTimestamp(),
  });
  pushUndo({ type: "create", uuid });
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleModifyProject = async (ctx) => {
  const projName = ctx.args[0].split(":")[1];
  if (!projName)
    return ctx.print(
      '<span class="msg-error">No project name specified.</span>',
    );

  let icon = undefined;
  let bannerStyle = undefined;
  let clearBanners = false;
  let tagsToToggle = [];
  ctx.args.slice(1).forEach((arg) => {
    if (arg.startsWith("icon:")) {
      let val = arg.split(":")[1];
      icon = !val || val === "" ? null : val;
    } else if (arg.startsWith("banner-style:")) {
      const val = arg.split(":")[1]?.toLowerCase();
      if (val === "ticker" || val === "typewriter") {
        bannerStyle = val;
      }
    } else if (arg === "banner:" || arg.startsWith("banner:")) {
      // Clear banners via mod
      const val = arg.split(":")[1];
      if (!val || val === "") clearBanners = true;
    } else if (arg.startsWith("!")) {
      tagsToToggle.push(arg.substring(1).toLowerCase());
    }
  });

  if (
    icon === undefined &&
    tagsToToggle.length === 0 &&
    bannerStyle === undefined &&
    !clearBanners
  ) {
    return ctx.print(
      '<span class="msg-info">No changes (specify icon:, !tag, banner-style:, or banner: to clear).</span>',
    );
  }

  const projects = await ctx.dbOps.getAllProjects();
  let proj = projects.find((p) => p.name === projName);
  if (!proj) proj = { name: projName };
  if (icon !== undefined) proj.icon = icon;
  if (bannerStyle !== undefined) proj.bannerStyle = bannerStyle;
  if (clearBanners) proj.banners = null;
  if (tagsToToggle.length > 0) {
    if (!proj.tags) proj.tags = [];
    tagsToToggle.forEach((tag) => {
      const idx = proj.tags.indexOf(tag);
      if (idx >= 0) proj.tags.splice(idx, 1);
      else proj.tags.push(tag);
    });
  }
  await ctx.dbOps.updateProject(proj);
  ctx.print(`<span class="msg-success">Project ${projName} updated.</span>`);
  await ctx.runListRefresh();
};

export const handleModify = async (ctx) => {
  const idArg = ctx.targetId?.toString() || ctx.args[0];
  let tokens = ctx.targetId ? ctx.args : ctx.args.slice(1);

  // Resolve IDs - supports ranges (1-3), comma-separated (1,3,5), and x:name references
  const uuids = await resolveRefs(idArg, ctx.displayMapRef, ctx.dbOps);
  if (uuids.length === 0)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');

  // Scan for done:/td: trigger (must be last, captures everything after)
  let newOnDone = undefined; // undefined = no change, null = clear, string = new value
  const tokensStr = tokens.join(" ");
  const triggerMatch = tokensStr.match(/\b(done:|td:)(.*)$/i);
  if (triggerMatch) {
    const triggerValue = triggerMatch[2].trim();
    newOnDone = triggerValue || null; // empty means clear
    // Remove the trigger portion from tokens for normal parsing
    const triggerStart = tokensStr.indexOf(triggerMatch[0]);
    tokens = tokensStr
      .substring(0, triggerStart)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  // Parse modifications from tokens (done once, applied to all tasks)
  const descParts = [];
  let newTarget = undefined; // undefined = no change, null = clear, string = new value
  const modifications = [];

  for (const token of tokens) {
    if (token.startsWith("pri:")) {
      const val = parseInt(token.split(":")[1], 10);
      if (!isNaN(val)) modifications.push({ type: "priority", value: val });
      else if (token === "pri:")
        modifications.push({ type: "priority", value: null });
    } else if (
      token.startsWith("o:") ||
      token.startsWith("ord:") ||
      token.startsWith("order:")
    ) {
      const val = parseInt(token.split(":")[1], 10);
      if (!isNaN(val)) modifications.push({ type: "order", value: val });
      else if (token === "o:" || token === "ord:" || token === "order:")
        modifications.push({ type: "order", value: null });
    } else if (
      token.startsWith("p:") ||
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      modifications.push({ type: "project", value: token.split(":")[1] });
    else if (token.startsWith("due:"))
      modifications.push({
        type: "due",
        value: parseDate(token.split(":")[1]),
      });
    else if (token.startsWith("wait:")) {
      const waitStr = token.split(":").slice(1).join(":");
      modifications.push({
        type: "wait",
        value: parseDate(waitStr),
        waitTime: parseWaitTime(waitStr),
      });
    } else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
      modifications.push({
        type: "sched",
        value: parseDate(token.split(":")[1]),
      });
    else if (token.startsWith("recur:") || token.startsWith("rec:"))
      modifications.push({ type: "recur", value: token.split(":")[1] });
    else if (token.startsWith("url:")) {
      const val = token.substring(4);
      modifications.push({ type: "url", value: val || null });
    } else if (token.startsWith("icon:")) {
      modifications.push({ type: "icon", value: token.split(":")[1] || null });
    } else if (token.startsWith("c:") || token.startsWith("color:")) {
      modifications.push({
        type: "color",
        value: parseColor(token.split(":")[1]),
      });
    } else if (token.startsWith("x:") || token.startsWith("target:")) {
      const val = token.split(":")[1];
      newTarget = val || null;
    } else if (token.startsWith("!")) {
      modifications.push({ type: "tag", value: token.substring(1) });
    } else if (token.startsWith("dep:")) {
      const depIds = token.split(":")[1].split(",");
      const depUuids = depIds
        .map((i) => ctx.displayMapRef.value[parseInt(i) - 1])
        .filter(Boolean);
      modifications.push({ type: "dep", value: depUuids });
    } else {
      descParts.push(token);
    }
  }

  if (descParts.length > 0) {
    modifications.push({ type: "description", value: descParts.join(" ") });
  }
  if (newOnDone !== undefined) {
    modifications.push({ type: "onDone", value: newOnDone });
  }

  // Validate target uniqueness if changing (only allowed for single task)
  if (newTarget !== undefined) {
    if (uuids.length > 1) {
      return ctx.print(
        '<span class="msg-error">Cannot set target on multiple tasks.</span>',
      );
    }
    if (newTarget) {
      const existing = await ctx.dbOps.getByStatus("pending");
      if (existing.some((t) => t.target === newTarget && t.uuid !== uuids[0])) {
        return ctx.print(
          `<span class="msg-error">Target x:${newTarget} already exists.</span>`,
        );
      }
    }
    modifications.push({ type: "target", value: newTarget });
  }

  // Apply modifications to all tasks
  const allUndoRecords = [];

  for (const uuid of uuids) {
    const task = await ctx.dbOps.get(uuid);
    if (!task) continue;

    allUndoRecords.push({ type: "update", task: structuredClone(task) });

    for (const mod of modifications) {
      switch (mod.type) {
        case "priority":
          task.priority = mod.value;
          break;
        case "order":
          task.order = mod.value;
          break;
        case "project":
          task.project = mod.value;
          break;
        case "due":
          task.due = mod.value;
          break;
        case "wait":
          task.wait = mod.value;
          task.waitTime = mod.waitTime;
          break;
        case "sched":
          task.sched = mod.value;
          break;
        case "recur":
          task.recur = mod.value;
          break;
        case "url":
          task.url = mod.value;
          break;
        case "icon":
          task.icon = mod.value;
          break;
        case "color":
          task.color = mod.value;
          break;
        case "target":
          task.target = mod.value;
          break;
        case "tag": {
          if (!task.tags) task.tags = [];
          const idx = task.tags.indexOf(mod.value);
          if (idx >= 0) task.tags.splice(idx, 1);
          else task.tags.push(mod.value);
          break;
        }
        case "dep": {
          if (!task.depends) task.depends = [];
          for (const depUuid of mod.value) {
            const depIdx = task.depends.indexOf(depUuid);
            if (depIdx >= 0) task.depends.splice(depIdx, 1);
            else task.depends.push(depUuid);
          }
          break;
        }
        case "description":
          task.description = mod.value;
          break;
        case "onDone":
          task.onDone = mod.value;
          break;
      }
    }

    await ctx.dbOps.update(task);
  }

  // Use compound undo for multiple tasks
  if (allUndoRecords.length === 1) {
    pushUndo(allUndoRecords[0]);
  } else if (allUndoRecords.length > 1) {
    pushUndo({ type: "compound", records: allUndoRecords });
  }

  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleEdit = async (ctx) => {
  // Populate input with mod command for quick editing
  const idArg = ctx.targetId || ctx.args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let uuid, displayId;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const all = await ctx.dbOps.getByStatus("pending");
    const match = all.find((t) => t.target === name);
    uuid = match?.uuid;
    // Find display ID for the mod command
    displayId = uuid ? ctx.displayMapRef.value.indexOf(uuid) + 1 : null;
  } else {
    displayId = parseInt(idArg);
    uuid = displayId ? ctx.displayMapRef.value[displayId - 1] : null;
  }

  if (!uuid || !displayId)
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const t = await ctx.dbOps.get(uuid);

  // Build the command string
  let cmdParts = [`mod ${displayId}`, t.description];

  if (t.project) cmdParts.push(`pro:${t.project}`);
  if (t.priority != null) cmdParts.push(`pri:${t.priority}`);
  if (t.order != null) cmdParts.push(`order:${t.order}`);
  if (t.tags && t.tags.length > 0) {
    t.tags.forEach((tag) => cmdParts.push(`!${tag}`));
  }
  if (t.due) cmdParts.push(`due:${formatDate(t.due)}`);
  if (t.wait) cmdParts.push(`wait:${formatDate(t.wait)}`);
  if (t.sched) cmdParts.push(`sched:${formatDate(t.sched)}`);
  if (t.recur) cmdParts.push(`recur:${t.recur}`);
  if (t.url) cmdParts.push(`url:${t.url}`);
  if (t.icon) cmdParts.push(`icon:${t.icon}`);
  if (t.color) {
    const colorStr = [t.color.icon || "", t.color.title || ""].join(".");
    cmdParts.push(`c:${colorStr.replace(/\.$/, "")}`);
  }
  if (t.depends && t.depends.length > 0) {
    // Convert UUIDs to display IDs where possible
    const depIds = t.depends
      .map((uuid) => {
        const idx = ctx.displayMapRef.value.indexOf(uuid);
        return idx >= 0 ? idx + 1 : null;
      })
      .filter((id) => id !== null);
    if (depIds.length > 0) cmdParts.push(`dep:${depIds.join(",")}`);
  }

  const cmdStr = cmdParts.join(" ");
  const input = document.getElementById("cmd-input");
  if (input) {
    input.value = cmdStr;
    input.focus();
    // Move cursor to end
    input.setSelectionRange(cmdStr.length, cmdStr.length);
  }
};

export const handleAnnotateProject = async (ctx) => {
  const projName = ctx.args[0].includes(":") ? ctx.args[0].split(":")[1] : null;
  if (!projName)
    return ctx.print(
      '<span class="msg-error">No project name specified.</span>',
    );

  let icon = null;
  let tagsToToggle = [];
  let banners = null;

  // Check for banner: prefix - everything after it is the banner text
  const fullArgs = ctx.args.slice(1).join(" ");
  const bannerMatch = fullArgs.match(/^banner:(.*)$/i);
  if (bannerMatch) {
    const bannerText = bannerMatch[1].trim();
    if (bannerText) {
      banners = bannerText
        .split("|")
        .map((b) => b.trim())
        .filter((b) => b);
    } else {
      banners = []; // Clear banners
    }
  } else {
    ctx.args.slice(1).forEach((arg) => {
      if (arg.startsWith("icon:")) {
        icon = arg.split(":")[1] || null;
      } else if (arg.startsWith("!")) {
        tagsToToggle.push(arg.substring(1).toLowerCase());
      }
    });
  }

  if (icon || tagsToToggle.length > 0 || banners !== null) {
    const projects = await ctx.dbOps.getAllProjects();
    let proj = projects.find((p) => p.name === projName);
    if (!proj) proj = { name: projName };
    if (icon) proj.icon = icon;
    if (tagsToToggle.length > 0) {
      if (!proj.tags) proj.tags = [];
      tagsToToggle.forEach((tag) => {
        const idx = proj.tags.indexOf(tag);
        if (idx >= 0) proj.tags.splice(idx, 1);
        else proj.tags.push(tag);
      });
    }
    if (banners !== null) {
      proj.banners = banners.length > 0 ? banners : null;
    }
    await ctx.dbOps.updateProject(proj);
    ctx.print(`<span class="msg-success">Project ${projName} updated.</span>`);
    ctx.markDirty();
    await ctx.runListRefresh();
  } else {
    ctx.print(
      '<span class="msg-info">No changes (specify icon:, !tag, or banner:).</span>',
    );
  }
};

export const handleAnnotate = async (ctx) => {
  const idArg = ctx.targetId || ctx.args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let uuid;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const all = await ctx.dbOps.getByStatus("pending");
    const match = all.find((t) => t.target === name);
    uuid = match?.uuid;
  } else {
    const id = parseInt(idArg);
    uuid = id ? ctx.displayMapRef.value[id - 1] : null;
  }

  if (!uuid) return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(uuid);
  const note = (ctx.targetId ? ctx.args : ctx.args.slice(1)).join(" ");
  if (!note)
    return ctx.print('<span class="msg-error">No annotation text.</span>');

  pushUndo({ type: "update", task: structuredClone(task) });
  const removeMatch = note.match(/^-(\d+)$/);
  if (removeMatch) {
    const n = parseInt(removeMatch[1]);
    if (!task.annotations || task.annotations.length === 0) {
      return ctx.print(
        '<span class="msg-error">No annotations to remove.</span>',
      );
    }
    if (n < 1 || n > task.annotations.length) {
      return ctx.print(
        `<span class="msg-error">Invalid index. Task has ${task.annotations.length} annotation(s).</span>`,
      );
    }
    task.annotations.splice(n - 1, 1);
    await ctx.dbOps.update(task);
    ctx.print(`<span class="msg-success">Annotation ${n} removed.</span>`);
    ctx.markDirty();
    await ctx.runListRefresh();
    return;
  }

  if (!task.annotations) task.annotations = [];
  task.annotations.push({ entry: Date.now(), description: note });
  await ctx.dbOps.update(task);
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleInfoProject = async (ctx) => {
  const projName = ctx.args[0].split(":")[1];
  if (!projName)
    return ctx.print(
      '<span class="msg-error">No project name specified.</span>',
    );
  const projects = await ctx.dbOps.getAllProjects();
  const proj = projects.find((p) => p.name === projName);
  const all = await ctx.dbOps.getAll();
  const taskCount = all.filter(
    (t) => t.status === "pending" && t.project === projName,
  ).length;
  let html = `<div class="task-info">`;
  html += `<div style="color:var(--yellow)">Project: ${projName}</div>`;
  if (proj?.icon)
    html += `<div><b>Icon:</b> <i class="${iconClass(proj.icon)}" style="margin-right:5px"></i>${proj.icon.replace(/^ph-light ph-/, "")}</div>`;
  if (proj?.tags?.length > 0)
    html += `<div><b>Tags:</b> ${proj.tags.join(" ")}</div>`;
  if (proj?.banners?.length > 0) {
    html += `<div><b>Banners:</b> ${proj.banners.length}</div>`;
    proj.banners.forEach((b, i) => {
      html += `<div style="margin-left:10px; font-size:0.9em; color:var(--base1)"><span style="color:var(--base01)">${i + 1}.</span> ${b}</div>`;
    });
    html += `<div><b>Banner style:</b> ${proj.bannerStyle || "ticker"}</div>`;
  }
  html += `<div><b>Pending tasks:</b> ${taskCount}</div>`;
  html += `</div>`;
  ctx.print(html, true);
};

export const handleInfo = async (ctx) => {
  const idArg = ctx.targetId || ctx.args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let uuid, displayId;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const all = await ctx.dbOps.getByStatus("pending");
    const match = all.find((t) => t.target === name);
    uuid = match?.uuid;
    displayId = uuid ? ctx.displayMapRef.value.indexOf(uuid) + 1 : null;
  } else {
    displayId = parseInt(idArg);
    uuid = displayId ? ctx.displayMapRef.value[displayId - 1] : null;
  }

  if (!uuid) return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const t = await ctx.dbOps.get(uuid);
  let html = `<div class="task-info">`;
  html += `<div style="color:var(--yellow)">Task ${displayId || "?"} - ${t.uuid}</div>`;
  html += `<div><b>Desc:</b> ${formatInlineCode(t.description)}</div>`;
  html += `<div><b>Status:</b> ${t.status}</div>`;
  if (t.project) {
    const projects = await ctx.dbOps.getAllProjects();
    const pMeta = projects.find((p) => p.name === t.project);
    let pIcon = "";
    if (pMeta && pMeta.icon)
      pIcon = `<i class="${iconClass(pMeta.icon)}" style="margin-right:5px"></i>`;
    html += `<div><b>Project:</b> ${pIcon}${t.project}</div>`;
  }
  if (t.url)
    html += `<div><b>URL:</b> <a href="${t.url}" target="_blank" rel="noopener" class="task-link">${t.url}</a></div>`;
  if (t.icon)
    html += `<div><b>Icon:</b> <i class="${iconClass(t.icon)}"></i> ${t.icon.replace(/^ph-light ph-/, "")}</div>`;
  if (t.color) {
    const parts = [];
    if (t.color.icon) parts.push(`icon: ${t.color.icon}`);
    if (t.color.title) parts.push(`title: ${t.color.title}`);
    html += `<div><b>Color:</b> ${parts.join(", ")}</div>`;
  }
  if (t.target) html += `<div><b>Target:</b> ${t.target}</div>`;
  if (t.order != null) html += `<div><b>Order:</b> ${t.order}</div>`;
  if (t.due) html += `<div><b>Due:</b> ${formatDateHtml(t.due)}</div>`;
  if (t.wait) html += `<div><b>Wait:</b> ${formatDateHtml(t.wait)}</div>`;
  if (t.sched) html += `<div><b>Scheduled:</b> ${formatDate(t.sched)}</div>`;
  if (t.recur) html += `<div><b>Recur:</b> ${t.recur}</div>`;
  if (t.onDone) html += `<div><b>On done:</b> ${t.onDone}</div>`;
  if (t.start) html += `<div><b>Started:</b> ${formatDate(t.start)}</div>`;
  if (t.end) html += `<div><b>Completed:</b> ${formatDate(t.end)}</div>`;
  if (t.tags && t.tags.length > 0)
    html += `<div><b>Tags:</b> ${t.tags.join(" ")}</div>`;
  if (t.depends && t.depends.length > 0)
    html += `<div><b>Depends:</b> ${t.depends.length} task(s)</div>`;
  if (t.annotations && t.annotations.length > 0) {
    html += `<div style="margin-top:5px; border-top:1px dashed var(--base01); padding-top:5px"><b>Annotations:</b></div>`;
    t.annotations.forEach((a, i) => {
      html += `<div style="margin-left:10px; font-size:0.9em; color:var(--base1)"><span style="color:var(--base01)">${i + 1}.</span> ${formatDate(a.entry)}: ${formatInlineCode(a.description)}</div>`;
    });
  }
  html += `</div>`;
  ctx.print(html, true);
};

export const handleOpen = async (ctx) => {
  const idArg = ctx.targetId || ctx.args[0];

  // Resolve ID - support both numeric IDs and x:name references
  let uuid;
  if (idArg && idArg.startsWith("x:")) {
    const name = idArg.substring(2);
    const all = await ctx.dbOps.getByStatus("pending");
    const match = all.find((t) => t.target === name);
    uuid = match?.uuid;
  } else {
    const id = parseInt(idArg);
    uuid = id ? ctx.displayMapRef.value[id - 1] : null;
  }

  if (!uuid) return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(uuid);

  if (!task.url) {
    return ctx.print('<span class="msg-error">Task has no URL.</span>');
  }

  window.open(task.url, "_blank", "noopener");
  ctx.print(`<span class="msg-success">Opened ${task.url}</span>`);
};
