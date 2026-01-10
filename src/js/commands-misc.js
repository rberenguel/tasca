// Misc handlers: help, copy, paste, icon, context, about, clear

import { formatDate } from "./utils.js";
import { resolveCommand } from "./logic.js";
import { setContext, getInheritedAttributes } from "./context.js";
import { resetBannerHidden } from "./ui.js";
import { searchIcons, searchIconsMulti } from "./icon-tags.js";
import { iconResultsRef } from "./state.js";
import {
  generateUUID,
  parseDate,
  parseWaitTime,
  uniqueTimestamp,
} from "./utils.js";

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

// Merge tokens like "pro:" + "value" into "pro:value"
const normalizeArgs = (parts) => {
  const result = [];
  const colonPrefixes =
    /^(p|pro|proj|project|pri|priority|due|wait|sched|scheduled|recur|url|icon|dep|sort|lim|l|end):$/i;
  for (let i = 0; i < parts.length; i++) {
    if (colonPrefixes.test(parts[i]) && i + 1 < parts.length) {
      result.push(parts[i] + parts[i + 1]);
      i++;
    } else {
      result.push(parts[i]);
    }
  }
  return result;
};

// Parse task object from args (for paste)
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

export const handleClear = async (ctx) => {
  document.getElementById("terminal-output").innerHTML = "";
  ctx.execute("next");
};

export const handleAbout = async (ctx) => {
  let version = "unknown";
  try {
    const res = await fetch("manifest.json");
    const manifest = await res.json();
    version = manifest.version || "unknown";
  } catch (e) {}
  const lastSave = await ctx.dbOps.getSetting("lastSave");
  let lastSaveStr = "never";
  if (lastSave) {
    const d = new Date(lastSave);
    lastSaveStr = d.toLocaleString();
  }
  ctx.print(
    `<div style="color:var(--base1)">Tasca v${version}<br>PWA task manager inspired by Taskwarrior.<br>Ruben Berenguel, 2025 with the help of Claude and Gemini.<br><br>Last save: ${lastSaveStr}</div>`,
  );
};

export const handleContext = async (ctx) => {
  resetBannerHidden(); // Reset banner visibility on context change
  const context = setContext(ctx.args);
  if (context) {
    ctx.print(`<span class="msg-success">Context set: ${context.raw}</span>`);
  } else {
    ctx.print(`<span class="msg-info">Context cleared.</span>`);
  }
  await ctx.execute("next");
};

export const handleIcon = async (ctx) => {
  if (ctx.args.length === 0) {
    return ctx.print(
      '<span class="msg-info">Usage: icon TERM — search for icon names by keyword. Use copy N to copy icon name.</span>',
    );
  }
  const query = ctx.args.join(" ");
  const results = query.includes(" ")
    ? searchIconsMulti(query)
    : searchIcons(query);
  if (results.length === 0) {
    iconResultsRef.value = [];
    ctx.print(`<span class="msg-info">No icons found for "${query}"</span>`);
  } else {
    const preview = results.slice(0, 50);
    iconResultsRef.value = preview;
    let html = `<div style="color:var(--yellow)">Icons matching "${query}" (${results.length}):</div>`;
    html += `<div class="table-wrapper"><table><tbody>`;
    preview.forEach((name, idx) => {
      html += `<tr><td style="width:25px">${idx + 1}</td><td style="width:1.5em;font-size:1.4em"><i class="ph-light ph-${name}"></i></td><td>${name}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    if (results.length > 50) {
      html += `<div style="color:var(--base01)">...and ${results.length - 50} more</div>`;
    }
    ctx.print(html, false);
  }
};

export const handleCopy = async (ctx) => {
  // Check if copying an icon from icon search results
  if (
    ctx.args.length === 1 &&
    /^\d+$/.test(ctx.args[0]) &&
    iconResultsRef.value.length > 0
  ) {
    const idx = parseInt(ctx.args[0]) - 1;
    if (idx >= 0 && idx < iconResultsRef.value.length) {
      const iconName = iconResultsRef.value[idx];
      try {
        await navigator.clipboard.writeText(iconName);
        ctx.print(
          `<span class="msg-success">Copied icon name: ${iconName}</span>`,
        );
        ctx.setPassthrough(true);
      } catch (err) {
        ctx.print(
          `<span class="msg-error">Failed to copy: ${err.message}</span>`,
        );
      }
      return;
    }
  }
  const all = await ctx.dbOps.getAll();
  const output = [];
  for (const uuid of ctx.displayMapRef.value) {
    const task = all.find((t) => t.uuid === uuid);
    if (task) {
      let parts = [task.description];
      if (task.project) parts.push(`pro:${task.project}`);
      if (task.priority != null) parts.push(`pri:${task.priority}`);
      if (task.tags && task.tags.length > 0) {
        task.tags.forEach((tag) => parts.push(`!${tag}`));
      }
      if (task.due) parts.push(`due:${formatDate(task.due)}`);
      if (task.wait) parts.push(`wait:${formatDate(task.wait)}`);
      if (task.sched) parts.push(`sched:${formatDate(task.sched)}`);
      if (task.recur) parts.push(`recur:${task.recur}`);
      if (task.url) parts.push(`url:${task.url}`);
      if (task.icon) parts.push(`icon:${task.icon}`);
      if (task.depends && task.depends.length > 0) {
        const depIds = task.depends
          .map((depUuid) => {
            const idx = ctx.displayMapRef.value.indexOf(depUuid);
            return idx >= 0 ? idx + 1 : null;
          })
          .filter((id) => id !== null);
        if (depIds.length > 0) parts.push(`dep:${depIds.join(",")}`);
      }
      output.push(parts.join(" "));
    }
  }

  if (output.length === 0) {
    ctx.print('<span class="msg-info">Nothing to copy.</span>');
  } else {
    const text = output.join("\n");
    if (isIOS) {
      const btnId = "ios-copy-btn-" + Date.now();
      ctx.print(
        `<button id="${btnId}" class="ios-btn" style="background:var(--yellow); color:var(--base03); border:none; padding:8px 12px; border-radius:4px; font-family:inherit; cursor:pointer; margin-top:5px;">Tap to Copy ${output.length} Tasks</button>`,
      );
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.onclick = () => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              btn.textContent = "Copied!";
              btn.style.background = "var(--green)";
              setTimeout(() => btn.remove(), 2000);
              ctx.print(
                `<span class="msg-success">Copied ${output.length} tasks to clipboard.</span>`,
              );
            })
            .catch((err) => {
              btn.textContent = "Error";
              btn.style.background = "var(--red)";
              ctx.print(
                `<span class="msg-error">Failed to copy: ${err.message}</span>`,
              );
            });
        };
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        ctx.print(
          `<span class="msg-success">Copied ${output.length} tasks to clipboard.</span>`,
        );
      } catch (err) {
        ctx.print(
          `<span class="msg-error">Failed to copy: ${err.message}</span>`,
        );
      }
    }
  }
};

export const handlePaste = async (ctx) => {
  const processPaste = async (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      ctx.print('<span class="msg-info">Clipboard is empty.</span>');
    } else {
      let count = 0;
      for (const line of lines) {
        let parts = line.trim().split(/\s+/);
        if (parts.length === 0) continue;
        parts = normalizeArgs(parts);
        const tObj = createTaskObject(parts, ctx.displayMapRef);
        if (tObj.desc.length === 0) continue;

        const inherited = getInheritedAttributes();
        let proj = tObj.proj;
        let tags = tObj.tags;
        if (!proj && inherited.project) proj = inherited.project;
        if (tags.length === 0 && inherited.tags) tags = [...inherited.tags];

        await ctx.dbOps.add({
          uuid: generateUUID(),
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
        count++;
      }
      ctx.print(
        `<span class="msg-success">Imported ${count} tasks from clipboard.</span>`,
      );
      await ctx.runListRefresh();
    }
  };

  if (isIOS) {
    const btnId = "ios-paste-btn-" + Date.now();
    ctx.print(
      `<button id="${btnId}" class="ios-btn" style="background:var(--cyan); color:var(--base03); border:none; padding:8px 12px; border-radius:4px; font-family:inherit; cursor:pointer; margin-top:5px;">Tap to Paste & Import</button>`,
    );
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.onclick = async () => {
        try {
          const text = await navigator.clipboard.readText();
          btn.textContent = "Importing...";
          await processPaste(text);
          btn.remove();
        } catch (err) {
          btn.textContent = "Error";
          btn.style.background = "var(--red)";
          ctx.print(
            `<span class="msg-error">Failed to read clipboard: ${err.message}. Ensure you grant permission.</span>`,
          );
        }
      };
    }
  } else {
    try {
      const text = await navigator.clipboard.readText();
      await processPaste(text);
    } catch (err) {
      ctx.print(
        `<span class="msg-error">Failed to read clipboard: ${err.message}. ensure you grant permission.</span>`,
      );
    }
  }
};

export const handleHelp = async (ctx) => {
  const sub = ctx.args[0];
  if (!sub) {
    ctx.print(
      `<div class="msg-standalone"><span style="color:var(--yellow)">Commands:</span> add, list, done, skip, delete, modify, edit, annotate, undo, info, chain, projects, context, day, calendar, report, status, export, import, icon. Type <span class="msg-hl">help [cmd]</span> for details.</div>`,
      false,
    );
  } else {
    const c = resolveCommand(sub);
    if (c === "add")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">order:N</span> <span class="msg-arg">due:DATE</span> <span class="msg-arg">wait:DATE</span> <span class="msg-arg">sched:DATE</span> <span class="msg-arg">recur:PERIOD</span> <span class="msg-arg">!tag</span><br>DATE: <span class="msg-arg">YYYYMMDD</span> | <span class="msg-arg">today</span> | <span class="msg-arg">tomorrow</span> | <span class="msg-arg">3d</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span><br>PERIOD: <span class="msg-arg">1d</span> | <span class="msg-arg">1w</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span> | <span class="msg-arg">1y</span><br>Priority: 1=low, 10=medium, 50=high. Negative for backlog. Use <span class="msg-arg">!someday</span> to hide from next.<br>Order: custom sort order for <span class="msg-arg">!today</span> view (lower first).</div>`,
        false,
      );
    else if (c === "modify")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">mod</span> ID <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">sched:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">!tag</span> <span class="msg-arg">dep:ID</span><br><span class="msg-hl">mod</span> <span class="msg-arg">pro:Name</span> <span class="msg-arg">icon:value</span> <span class="msg-arg">!tag</span> (project metadata, tags toggle)</div>`,
        false,
      );
    else if (c === "icon")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">icon</span> <span class="msg-arg">term</span><br>Search for Phosphor icon names by keyword. Use with <span class="msg-arg">icon:name</span> in add/modify.</div>`,
        false,
      );
    else if (c === "list")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">end:1w</span><br>Virtual: <span class="msg-arg">!overdue</span> <span class="msg-arg">!today</span> <span class="msg-arg">!waiting</span> <span class="msg-arg">!scheduled</span> <span class="msg-arg">!recurring</span> <span class="msg-arg">!blocked</span> <span class="msg-arg">!someday</span> <span class="msg-arg">!done</span> <span class="msg-arg">!all</span></div>`,
        false,
      );
    else if (c === "done")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">done</span> ID<br>Completes a task. If recurring, creates the next instance.<br>Multi: <span class="msg-arg">done 1,3</span> or <span class="msg-arg">done 1-3</span> or <span class="msg-arg">done 1,3-5</span></div>`,
        false,
      );
    else if (c === "skip")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">skip</span> ID<br>Recurring: marks as skipped and creates next instance. Non-recurring: cancels the task.<br>Multi: <span class="msg-arg">skip 1,3</span> or <span class="msg-arg">skip 1-3</span></div>`,
        false,
      );
    else if (c === "delete")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">delete</span> ID<br>Permanently removes a task.<br>Multi: <span class="msg-arg">delete 1,3</span> or <span class="msg-arg">delete 1-3</span></div>`,
        false,
      );
    else if (c === "annotate")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">annotate</span> ID <span class="msg-arg">note text...</span><br>Adds a timestamped note. Use <span class="msg-arg">-N</span> to remove by index (see info).</div>`,
        false,
      );
    else if (c === "undo")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">undo</span><br>Reverts the last task operation. Not persisted across page reloads.</div>`,
        false,
      );
    else if (c === "info")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">info</span> ID<br>Shows full task details including annotations and UUID.<br><span class="msg-hl">info</span> <span class="msg-arg">pro:Name</span> — show project details (icon, tags).</div>`,
        false,
      );
    else if (c === "edit" || c === "ed")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">edit</span> ID (alias: <span class="msg-hl">ed</span>)<br>Populates the input with a <span class="msg-hl">mod</span> command containing all task properties for quick editing.</div>`,
        false,
      );
    else if (["chain", "tree", "dependencies", "deps"].includes(c))
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">chain</span> ID (aliases: <span class="msg-hl">tree</span>, <span class="msg-hl">deps</span>)<br>Visualizes dependency tree for the specified task.</div>`,
        false,
      );
    else if (c === "projects" || c === "proj")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">projects</span><br>Lists all projects with task counts and tags.<br>Toggle tags: <span class="msg-arg">mod pro:Name !reference</span> (use again to remove)<br>Projects with <span class="msg-arg">!reference</span> tag are hidden from next.</div>`,
        false,
      );
    else if (c === "export")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">export</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span><br>Exports tasks as JSON. Supports same filters as list.</div>`,
        false,
      );
    else if (c === "context" || c === "ctx" || c === "c")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">context</span> <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">search</span><br>Set persistent filter context. Filters auto-apply to list/next, attributes inherit to add.<br><span class="msg-hl">context</span> (no args) clears context.<br>Shortcut: <span class="msg-hl">day</span> or <span class="msg-hl">today</span> sets context to <span class="msg-arg">!today</span>.</div>`,
        false,
      );
    else if (c === "day" || c === "today")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">day</span> / <span class="msg-hl">today</span><br>Sets context to <span class="msg-arg">!today</span> — shows all tasks due today (including waiting routines).<br>Tasks are sorted by <span class="msg-arg">order:N</span> (ascending), then urgency.</div>`,
        false,
      );
    else if (c === "calendar" || c === "cal")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">cal</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">lim:N</span><br>Agenda view of dated tasks. Shows <span class="msg-arg">[due]</span> <span class="msg-arg">[sched]</span> <span class="msg-arg">[wait]</span> dates.<br>Includes overdue from past 7 days. <span class="msg-arg">!done</span> shows completed by end date.</div>`,
        false,
      );
    else if (c === "link")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">link</span><br>Link a JSON file for sync (desktop Chrome). Use <span class="msg-arg">load</span> to import, <span class="msg-arg">save</span> to export.</div>`,
        false,
      );
    else if (c === "load")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">load</span><br>Import tasks from linked file. Tasks matched by UUID.</div>`,
        false,
      );
    else if (c === "save")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">save</span><br>Export all tasks to linked file (overwrites).</div>`,
        false,
      );
    else if (c === "unlink")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">unlink</span><br>Remove linked file association.</div>`,
        false,
      );
    else if (c === "status" || c === "stat")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">status</span><br>Show sync status: linked file, last save time, and count of tasks/projects modified since last save.</div>`,
        false,
      );
    else if (c === "report" || c === "rep")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">report</span> <span class="msg-arg">stale</span> | <span class="msg-arg">rot [N]</span> | <span class="msg-arg">done [period] [by:project|tag]</span> | <span class="msg-arg">cfd [pro:X] [period] [by:project|tag]</span> | <span class="msg-arg">cycle [pro:X] [period] [by:project|tag]</span> | <span class="msg-arg">forecast</span> | <span class="msg-arg">churn [period]</span> | <span class="msg-arg">audit [period]</span><br><span class="msg-arg">stale</span> — projects by staleness (days since activity)<br><span class="msg-arg">rot [N]</span> — oldest N pending tasks (default 10)<br><span class="msg-arg">done [1w] [by:tag]</span> — completed tasks grouped by project or tag<br><span class="msg-arg">cfd</span> — cumulative flow diagram (done vs pending over time)<br><span class="msg-arg">cycle</span> — cycle time distribution (latency from entry to done)<br><span class="msg-arg">forecast</span> — backlog completion prediction based on velocity<br><span class="msg-arg">churn [1w]</span> — project context switching metric<br><span class="msg-arg">audit [4w]</span> — recurring task skip rate analysis</div>`,
        false,
      );
    else if (c === "copy" || c === "cp")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">copy</span> (alias <span class="msg-hl">cp</span>)<br>Copies the currently displayed task list to clipboard (description, project, tags).</div>`,
        false,
      );
    else if (c === "paste")
      ctx.print(
        `<div class="msg-help msg-standalone"><span class="msg-hl">paste</span><br>Imports tasks from clipboard. Expects one task per line (same format as add command).</div>`,
        false,
      );
    else
      ctx.print(
        `<span class="msg-error">No specific help for: ${sub}</span>`,
        false,
      );
  }
};
