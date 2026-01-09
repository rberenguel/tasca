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

// Convert icon name to full Phosphor class (handles legacy full class format)
const iconClass = (name) => {
  if (!name) return "";
  return name.startsWith("ph-") ? name : `ph-light ph-${name}`;
};

// Parse task object from args
const createTaskObject = (args, displayMapRef) => {
  let desc = [],
    proj = "",
    priority = null,
    tags = [],
    depends = [],
    due = null,
    wait = null,
    waitTime = null,
    sched = null,
    recur = null,
    url = null,
    icon = null;
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
    } else if (token.startsWith("!")) tags.push(token.substring(1));
    else desc.push(token);
  }
  return {
    desc: desc.join(" "),
    proj,
    priority,
    tags,
    depends,
    due,
    wait,
    waitTime,
    sched,
    recur,
    url,
    icon,
  };
};

export const handleAdd = async (ctx) => {
  const tObj = createTaskObject(ctx.args, ctx.displayMapRef);
  if (tObj.desc.length === 0)
    return ctx.print('<span class="msg-error">No description.</span>');

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
    tags: tags,
    depends: tObj.depends,
    due: tObj.due,
    wait: tObj.wait,
    waitTime: tObj.waitTime,
    sched: tObj.sched,
    recur: tObj.recur,
    url: tObj.url,
    icon: tObj.icon,
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
  const id = ctx.targetId || parseInt(ctx.args[0]);
  const tokens = ctx.targetId ? ctx.args : ctx.args.slice(1);
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
  pushUndo({ type: "update", task: structuredClone(task) });
  const descParts = [];
  tokens.forEach((token) => {
    if (token.startsWith("pri:")) {
      const val = parseInt(token.split(":")[1], 10);
      if (!isNaN(val)) task.priority = val;
      else if (token === "pri:") task.priority = null; // clear priority
    } else if (
      token.startsWith("p:") ||
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      task.project = token.split(":")[1];
    else if (token.startsWith("due:"))
      task.due = parseDate(token.split(":")[1]);
    else if (token.startsWith("wait:")) {
      const waitStr = token.split(":").slice(1).join(":");
      task.wait = parseDate(waitStr);
      task.waitTime = parseWaitTime(waitStr);
    } else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
      task.sched = parseDate(token.split(":")[1]);
    else if (token.startsWith("recur:") || token.startsWith("rec:"))
      task.recur = token.split(":")[1];
    else if (token.startsWith("url:")) {
      const val = token.substring(4);
      task.url = val || null;
    } else if (token.startsWith("icon:")) {
      task.icon = token.split(":")[1] || null;
    } else if (token.startsWith("!")) {
      const tag = token.substring(1);
      if (!task.tags) task.tags = [];
      const idx = task.tags.indexOf(tag);
      if (idx >= 0) task.tags.splice(idx, 1);
      else task.tags.push(tag);
    } else if (token.startsWith("dep:")) {
      if (!task.depends) task.depends = [];
      token
        .split(":")[1]
        .split(",")
        .forEach((i) => {
          const uuid = ctx.displayMapRef.value[i - 1];
          if (uuid) {
            const idx = task.depends.indexOf(uuid);
            if (idx >= 0) task.depends.splice(idx, 1);
            else task.depends.push(uuid);
          }
        });
    } else {
      descParts.push(token);
    }
  });
  if (descParts.length > 0) {
    task.description = descParts.join(" ");
  }
  await ctx.dbOps.update(task);
  ctx.markDirty();
  await ctx.runListRefresh();
};

export const handleEdit = async (ctx) => {
  // Populate input with mod command for quick editing
  const id = ctx.targetId || parseInt(ctx.args[0]);
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const t = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);

  // Build the command string
  let cmdParts = [`mod ${id}`, t.description];

  if (t.project) cmdParts.push(`pro:${t.project}`);
  if (t.priority != null) cmdParts.push(`pri:${t.priority}`);
  if (t.tags && t.tags.length > 0) {
    t.tags.forEach((tag) => cmdParts.push(`!${tag}`));
  }
  if (t.due) cmdParts.push(`due:${formatDate(t.due)}`);
  if (t.wait) cmdParts.push(`wait:${formatDate(t.wait)}`);
  if (t.sched) cmdParts.push(`sched:${formatDate(t.sched)}`);
  if (t.recur) cmdParts.push(`recur:${t.recur}`);
  if (t.url) cmdParts.push(`url:${t.url}`);
  if (t.icon) cmdParts.push(`icon:${t.icon}`);
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
  const id = ctx.targetId || parseInt(ctx.args[0]);
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const task = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
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
  const id = ctx.targetId || parseInt(ctx.args[0]);
  if (!id || !ctx.displayMapRef.value[id - 1])
    return ctx.print('<span class="msg-error">Invalid ID.</span>');
  const t = await ctx.dbOps.get(ctx.displayMapRef.value[id - 1]);
  let html = `<div class="task-info">`;
  html += `<div style="color:var(--yellow)">Task ${id} - ${t.uuid}</div>`;
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
  if (t.due) html += `<div><b>Due:</b> ${formatDateHtml(t.due)}</div>`;
  if (t.wait) html += `<div><b>Wait:</b> ${formatDateHtml(t.wait)}</div>`;
  if (t.sched) html += `<div><b>Scheduled:</b> ${formatDate(t.sched)}</div>`;
  if (t.recur) html += `<div><b>Recur:</b> ${t.recur}</div>`;
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
