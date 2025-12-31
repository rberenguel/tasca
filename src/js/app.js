import {
  generateUUID,
  parseDate,
  formatDate,
  addDays,
  addMonths,
  parseRelativeTime,
} from "./utils.js";
import { initDB, dbOps } from "./db.js";
import {
  C,
  calculateUrgency,
  hasVirtualTag,
  resolveCommand,
  matchesProject,
  getDaysRemaining,
} from "./logic.js";
import {
  print,
  renderTable,
  formatProject,
  renderProjectsTable,
} from "./ui.js";

let displayMap = [];
const displayMapRef = { value: displayMap }; // reference wrapper for ui module
let knownProjects = new Set();
let lastFilterArgs = []; // persist filter across operations

let knownTags = new Set();
let knownIcons = new Set();

// Command history
let cmdHistory = JSON.parse(localStorage.getItem("tasca_history") || "[]");
let historyIndex = -1;
let historyTemp = ""; // stores current input when navigating history

const fetchIcons = async () => {
  try {
    const response = await fetch("fonts/iconoir/iconoir.css");
    const text = await response.text();
    const regex = /\.iconoir-([a-zA-Z0-9-]+)::before/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      knownIcons.add("iconoir-" + match[1]);
    }
  } catch (e) {
    console.error("Failed to load icons", e);
  }
};

const updateCache = (tasks) => {
  knownProjects.clear();
  knownTags.clear();
  tasks.forEach((t) => {
    if (t.project) knownProjects.add(t.project);
    if (t.tags) t.tags.forEach((tag) => knownTags.add(tag));
  });
};

const runList = async (args, limit = Infinity) => {
  lastFilterArgs = args; // persist for reuse after operations
  const all = await dbOps.getAll();
  const projects = await dbOps.getAllProjects();
  let search = [],
    fProj = null,
    fTags = [],
    endAfter = null;
  let showWaiting = false,
    showDone = false;

  for (let token of args) {
    if (
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    )
      fProj = token.split(":")[1];
    else if (token.startsWith("end:")) {
      // end:7d, end:1w, end:2m - show tasks completed after this relative time
      const val = token.split(":")[1];
      endAfter = parseRelativeTime(val);
    } else if (token.startsWith("!")) {
      const tag = token.substring(1).toUpperCase();
      if (tag === "WAITING" || tag === "ALL") showWaiting = true;
      if (tag === "DONE" || tag === "COMPLETED") showDone = true;
      if (tag !== "ALL") fTags.push(token); // !all is just a flag, not a filter
    } else search.push(token.toLowerCase());
  }

  // Start with appropriate base set
  let tasks = showDone
    ? all.filter((t) => t.status === "completed")
    : all.filter((t) => t.status === "pending");
  if (!showWaiting && !showDone)
    tasks = tasks.filter((t) => !t.wait || t.wait <= Date.now());
  if (fProj) tasks = tasks.filter((t) => matchesProject(t.project, fProj));
  if (endAfter) tasks = tasks.filter((t) => t.end && t.end >= endAfter);
  if (fTags.length) {
    tasks = tasks.filter((t) =>
      fTags.every((ft) => {
        const tag = ft.substring(1).toLowerCase();
        if (t.tags && t.tags.some((tt) => tt.toLowerCase() === tag))
          return true;
        if (hasVirtualTag(t, ft, all)) return true;
        return false;
      }),
    );
  }
  if (search.length)
    tasks = tasks.filter((t) =>
      search.every((s) => t.description.toLowerCase().includes(s)),
    );
  tasks.forEach((t) => (t.urgency = calculateUrgency(t, all)));
  tasks.sort((a, b) => parseFloat(b.urgency) - parseFloat(a.urgency));

  if (limit !== Infinity && limit > 0) {
    tasks = tasks.slice(0, limit);
  }

  renderTable(tasks, all, displayMapRef, projects);
};

const execute = async (str) => {
  dbOps.check();

  try {
    const parts = str.trim().split(/\s+/);
    if (!parts.length || parts[0] === "") return;
    if (parts[0] === "task") parts.shift();

    let rawCmd = parts[0];
    let cmd = resolveCommand(rawCmd);
    if (!cmd && rawCmd.match(/^\d+$/)) cmd = "info";
    if (!cmd) cmd = rawCmd;

    let args = parts.slice(1);
    let targetId = rawCmd.match(/^\d+$/) ? parseInt(rawCmd) : null;

    if (cmd === "export" || cmd === "exp") {
      const all = await dbOps.getAll();
      let filtered = all;

      // Apply filters like list does
      if (args.length > 0) {
        let fProj = null,
          fTags = [],
          search = [];
        for (let token of args) {
          if (
            token.startsWith("pro:") ||
            token.startsWith("proj:") ||
            token.startsWith("project:")
          )
            fProj = token.split(":")[1];
          else if (token.startsWith("!")) {
            const tag = token.substring(1).toUpperCase();
            if (tag !== "ALL") fTags.push(token); // !all is just a flag, not a filter
          } else search.push(token.toLowerCase());
        }
        if (fProj)
          filtered = filtered.filter((t) => matchesProject(t.project, fProj));
        if (fTags.length) {
          filtered = filtered.filter((t) =>
            fTags.every((ft) => {
              const tag = ft.substring(1).toLowerCase();
              if (t.tags && t.tags.some((tt) => tt.toLowerCase() === tag))
                return true;
              if (hasVirtualTag(t, ft, all)) return true;
              return false;
            }),
          );
        }
        if (search.length)
          filtered = filtered.filter((t) =>
            search.every((s) => t.description.toLowerCase().includes(s)),
          );
      }

      const dataStr = JSON.stringify(filtered, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const filename =
        args.length > 0
          ? `tasca_${args.join("_").replace(/[^a-zA-Z0-9]/g, "")}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`
          : `tasca_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`;

      // Try File System Access API (desktop Chrome - allows overwrite)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: "JSON files",
                accept: { "application/json": [".json"] },
              },
            ],
          });
          const writable = await handle.createWritable();
          await writable.write(dataStr);
          await writable.close();
          print(
            `<span class="msg-success">Exported ${filtered.length} tasks to ${handle.name}.</span>`,
          );
          return;
        } catch (e) {
          if (e.name === "AbortError") return; // User cancelled
          // Fall through to other methods
        }
      }

      // Try Web Share API (iOS - triggers share sheet with "Save to Files")
      const file = new File([blob], filename, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          print(
            `<span class="msg-success">Exported ${filtered.length} tasks.</span>`,
          );
          return;
        } catch (e) {
          if (e.name === "AbortError") return; // User cancelled
          // Fall through to download
        }
      }

      // Fallback: download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      print(
        `<span class="msg-success">Exported ${filtered.length} tasks.</span>`,
      );
    } else if (cmd === "import" || cmd === "imp")
      document.getElementById("import-picker").click();
    else if (cmd === "clear") {
      document.getElementById("terminal-output").innerHTML = "";
      execute("next");
    } else if (["add", "a", "log"].includes(cmd)) {
      let desc = [],
        proj = "",
        priority = "",
        tags = [],
        depends = [],
        due = null,
        wait = null,
        recur = null,
        url = null;
      for (let token of args) {
        if (
          token.startsWith("pro:") ||
          token.startsWith("proj:") ||
          token.startsWith("project:")
        )
          proj = token.split(":")[1];
        else if (token.startsWith("pri:") || token.startsWith("priority:"))
          priority = token.split(":")[1].toUpperCase();
        else if (token.startsWith("dep:"))
          token
            .split(":")[1]
            .split(",")
            .forEach((id) => {
              if (displayMapRef.value[id - 1])
                depends.push(displayMapRef.value[id - 1]);
            });
        else if (token.startsWith("due:")) due = parseDate(token.split(":")[1]);
        else if (token.startsWith("wait:"))
          wait = parseDate(token.split(":")[1]);
        else if (token.startsWith("recur:")) recur = token.split(":")[1];
        else if (token.startsWith("url:")) url = token.substring(4);
        else if (token.startsWith("!")) tags.push(token.substring(1));
        else desc.push(token);
      }
      if (desc.length === 0)
        return print('<span class="msg-error">No description.</span>');
      await dbOps.add({
        uuid: generateUUID(),
        description: desc.join(" "),
        project: proj,
        priority,
        tags,
        depends,
        due,
        wait,
        recur,
        url,
        annotations: [],
        status: "pending",
        entry: Date.now(),
      });
      runList(lastFilterArgs);
    } else if (cmd === "list" || cmd === "ls" || cmd === "l") {
      await runList(args);
    } else if (cmd === "next") {
      let limit = localStorage.getItem("tasca_next_limit")
        ? parseInt(localStorage.getItem("tasca_next_limit"))
        : 1000;

      // Check if user provided explicit limit
      if (args.length > 0 && args[0].match(/^\d+$/)) {
        limit = parseInt(args[0]);
        localStorage.setItem("tasca_next_limit", limit);
        args.shift(); // Remove the limit argument so it doesn't affect search
      }

      await runList(args, limit);
    } else if (cmd === "chain") {
      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const rootUuid = displayMapRef.value[id - 1];
      const all = await dbOps.getAll();
      // Chain visualization logic is complex. To save space in plan I will keep it simple or reimplement.
      // The original implementation was inline. I will reimplement in ui.js or keep here.
      // For now, let's keep it here but I need to adapt it.
      // Re-implementing simplified chain logic for brevity as I cannot simply import the old one.

      // ... (Chain logic logic adapted from index.html)
      const pending = all.filter((t) => t.status === "pending");
      const blocking = {};
      const uuidMap = {};
      pending.forEach((t) => {
        uuidMap[t.uuid] = t;
        if (t.depends)
          t.depends.forEach((dep) => {
            if (!blocking[dep]) blocking[dep] = [];
            blocking[dep].push(t.uuid);
          });
      });

      // ... (Traversal logic) ...
      // Since this is a direct extraction, I'll copy the logic logic if possible,
      // but for safety/simplicity in this step, I'll print a placeholder or minimally implement.
      // User requested refactor, so better to be complete.

      // Re-use logic:
      const ancestors = new Set();
      const getAncestors = (curr) => {
        const t = uuidMap[curr];
        if (!t || !t.depends) return;
        t.depends.forEach((d) => {
          if (uuidMap[d] && !ancestors.has(d)) {
            ancestors.add(d);
            getAncestors(d);
          }
        });
      };
      getAncestors(rootUuid);

      const descendants = new Set();
      const getDescendants = (curr) => {
        if (blocking[curr])
          blocking[curr].forEach((b) => {
            if (uuidMap[b] && !descendants.has(b)) {
              descendants.add(b);
              getDescendants(b);
            }
          });
      };
      getDescendants(rootUuid);

      const relevantUUIDs = new Set([...ancestors, rootUuid, ...descendants]);
      const roots = [];
      relevantUUIDs.forEach((u) => {
        const t = uuidMap[u];
        if (!(t.depends && t.depends.some((d) => relevantUUIDs.has(d))))
          roots.push(u);
      });

      let html = '<div style="line-height: 1.5; font-family: monospace;">';
      const renderFinal = (u, prefix, isTail) => {
        const t = uuidMap[u];
        const isTarget = u === rootUuid;
        let treeMarker = "";
        if (prefix.length > 0 || isTail !== undefined)
          treeMarker = `<span style="color:var(--base01)">${prefix}${isTail ? "└── " : "├── "}</span>`;

        let content = `<span style="${isTarget ? "color:var(--yellow); font-weight:bold" : ""}">ID:${displayMapRef.value.indexOf(u) + 1} ${t.description}</span>`;
        if (t.tags && t.tags.length)
          content += ` <span style="color:var(--blue)">${t.tags.map((tag) => "+" + tag).join(" ")}</span>`;
        if (t.project)
          content += ` <span style="color:var(--yellow)">${t.project}</span>`;

        html += `<div>${treeMarker}${content}</div>`;

        const children = blocking[u]
          ? blocking[u].filter((c) => relevantUUIDs.has(c))
          : [];
        children.forEach((child, i) => {
          const childIsTail = i === children.length - 1;
          let nextPrefix = prefix;
          if (isTail !== undefined) nextPrefix += isTail ? "    " : "│   ";
          renderFinal(child, nextPrefix, childIsTail);
        });
      };
      if (roots.length === 0 && relevantUUIDs.size > 0)
        renderFinal(rootUuid, "", undefined);
      else roots.forEach((r) => renderFinal(r, "", undefined));
      html += "</div>";
      print(html, true);
    } else if (cmd === "annotate") {
      // Check for project annotation: annotate pro:Name icon:foo
      if (
        args[0] &&
        (args[0].startsWith("pro:") ||
          args[0].startsWith("proj:") ||
          args[0].startsWith("project:"))
      ) {
        const projName = args[0].includes(":") ? args[0].split(":")[1] : null;
        if (!projName)
          return print(
            '<span class="msg-error">No project name specified.</span>',
          );

        let icon = null;
        args.slice(1).forEach((arg) => {
          if (arg.startsWith("icon:")) {
            let val = arg.split(":")[1];
            if (val && !val.startsWith("iconoir-")) val = "iconoir-" + val;
            icon = val;
          }
        });

        if (icon) {
          const projects = await dbOps.getAllProjects();
          let proj = projects.find((p) => p.name === projName);
          if (!proj) proj = { name: projName };
          proj.icon = icon;
          await dbOps.updateProject(proj);
          print(
            `<span class="msg-success">Project ${projName} updated.</span>`,
          );
          runList(lastFilterArgs);
        } else {
          print(
            '<span class="msg-info">No changes (icon not specified).</span>',
          );
        }
        return;
      }

      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      const note = args.slice(1).join(" ");
      if (!note)
        return print('<span class="msg-error">No annotation text.</span>');

      // Check for removal: annotate ID -N (N matches index shown in info)
      const removeMatch = note.match(/^-(\d+)$/);
      if (removeMatch) {
        const n = parseInt(removeMatch[1]);
        if (!task.annotations || task.annotations.length === 0) {
          return print(
            '<span class="msg-error">No annotations to remove.</span>',
          );
        }
        if (n < 1 || n > task.annotations.length) {
          return print(
            `<span class="msg-error">Invalid index. Task has ${task.annotations.length} annotation(s).</span>`,
          );
        }
        // Remove by displayed index (1-based)
        task.annotations.splice(n - 1, 1);
        await dbOps.update(task);
        print(`<span class="msg-success">Annotation ${n} removed.</span>`);
        runList(lastFilterArgs);
        return;
      }

      if (!task.annotations) task.annotations = [];
      task.annotations.push({ entry: Date.now(), description: note });
      await dbOps.update(task);
      runList(lastFilterArgs);
    } else if (cmd === "info" || cmd === "i") {
      const id = parseInt(args[0] || rawCmd);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const t = await dbOps.get(displayMapRef.value[id - 1]);
      let html = `<div class="task-info">`;
      html += `<div style="color:var(--yellow)">Task ${id} - ${t.uuid}</div>`;
      html += `<div><b>Desc:</b> ${t.description}</div>`;
      html += `<div><b>Status:</b> ${t.status}</div>`;
      if (t.project) {
        const projects = await dbOps.getAllProjects();
        const pMeta = projects.find((p) => p.name === t.project);
        let pIcon = "";
        if (pMeta && pMeta.icon)
          pIcon = `<i class="${pMeta.icon}" style="margin-right:5px"></i>`;
        html += `<div><b>Project:</b> ${pIcon}${t.project}</div>`;
      }
      if (t.url)
        html += `<div><b>URL:</b> <a href="${t.url}" target="_blank" rel="noopener" class="task-link">${t.url}</a></div>`;
      if (t.due) html += `<div><b>Due:</b> ${formatDate(t.due)}</div>`;
      if (t.wait) html += `<div><b>Wait:</b> ${formatDate(t.wait)}</div>`;
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
          html += `<div style="margin-left:10px; font-size:0.9em; color:var(--base1)"><span style="color:var(--base01)">${i + 1}.</span> ${formatDate(a.entry)}: ${a.description}</div>`;
        });
      }
      html += `</div>`;
      print(html, true);
    } else if (
      ["modify", "mod"].includes(cmd) &&
      args[0] &&
      (args[0].startsWith("pro:") ||
        args[0].startsWith("proj:") ||
        args[0].startsWith("project:"))
    ) {
      // Project modification: mod pro:NAME icon:VALUE
      const projName = args[0].split(":")[1];
      if (!projName)
        return print(
          '<span class="msg-error">No project name specified.</span>',
        );

      let icon = undefined; // undefined = not specified, null = explicitly cleared
      args.slice(1).forEach((arg) => {
        if (arg.startsWith("icon:")) {
          let val = arg.split(":")[1];
          if (!val || val === "") {
            icon = null; // explicitly clear
          } else {
            if (!val.startsWith("iconoir-")) val = "iconoir-" + val;
            icon = val;
          }
        }
      });

      if (icon === undefined) {
        return print(
          '<span class="msg-info">No changes (specify icon:VALUE or icon: to clear).</span>',
        );
      }

      const projects = await dbOps.getAllProjects();
      let proj = projects.find((p) => p.name === projName);
      if (!proj) proj = { name: projName };
      proj.icon = icon;
      await dbOps.updateProject(proj);
      print(`<span class="msg-success">Project ${projName} updated.</span>`);
      runList(lastFilterArgs);
    } else if (
      (targetId && (args[0] === "mod" || args[0] === "modify")) ||
      (["modify", "mod"].includes(cmd) && args[0] && args[0].match(/^\d+$/))
    ) {
      const id = targetId || parseInt(args[0]);
      const tokens = targetId ? args : args.slice(1);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      const descParts = [];
      tokens.forEach((token) => {
        if (token.startsWith("pri:"))
          task.priority = token.split(":")[1].toUpperCase();
        else if (
          token.startsWith("pro:") ||
          token.startsWith("proj:") ||
          token.startsWith("project:")
        )
          task.project = token.split(":")[1];
        else if (token.startsWith("due:"))
          task.due = parseDate(token.split(":")[1]);
        else if (token.startsWith("wait:"))
          task.wait = parseDate(token.split(":")[1]);
        else if (token.startsWith("recur:")) task.recur = token.split(":")[1];
        else if (token.startsWith("url:")) {
          const val = token.substring(4);
          task.url = val || null; // empty url: clears it
        } else if (token.startsWith("!")) {
          const tag = token.substring(1);
          if (!task.tags) task.tags = [];
          const idx = task.tags.indexOf(tag);
          if (idx >= 0)
            task.tags.splice(idx, 1); // remove if exists
          else task.tags.push(tag); // add if not
        } else if (token.startsWith("dep:")) {
          if (!task.depends) task.depends = [];
          token
            .split(":")[1]
            .split(",")
            .forEach((i) => {
              const uuid = displayMapRef.value[i - 1];
              if (uuid) {
                const idx = task.depends.indexOf(uuid);
                if (idx >= 0)
                  task.depends.splice(idx, 1); // remove if exists
                else task.depends.push(uuid); // add if not
              }
            });
        } else {
          // Plain text becomes part of new description
          descParts.push(token);
        }
      });
      if (descParts.length > 0) {
        task.description = descParts.join(" ");
      }
      await dbOps.update(task);
      runList(lastFilterArgs);
    } else if (
      cmd === "start" ||
      cmd === "st" ||
      (targetId && (args[0] === "start" || args[0] === "st"))
    ) {
      const id = targetId || parseInt(args.find((a) => a.match(/^\d+$/)));
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      if (task) {
        task.start = Date.now();
        await dbOps.update(task);
        print(`<span class="msg-success">Started task ${id}.</span>`);
        runList(lastFilterArgs);
      }
    } else if (cmd === "done" || (targetId && args[0] === "done")) {
      const id = targetId || parseInt(args.find((a) => a.match(/^\d+$/)));
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      if (task) {
        task.status = "completed";
        task.end = Date.now();
        await dbOps.update(task);
        if (task.recur && task.due) {
          let nextDue = null,
            nextWait = null;
          if (task.recur.startsWith("dai")) nextDue = addDays(task.due, 1);
          else if (task.recur.startsWith("wee")) nextDue = addDays(task.due, 7);
          else if (task.recur.startsWith("mon"))
            nextDue = addMonths(task.due, 1);
          else if (task.recur.startsWith("yea"))
            nextDue = addMonths(task.due, 12);
          if (nextDue) {
            if (task.wait) nextWait = nextDue - (task.due - task.wait);
            const newTask = {
              ...task,
              uuid: generateUUID(),
              status: "pending",
              due: nextDue,
              wait: nextWait,
              entry: Date.now(),
              annotations: [],
            };
            delete newTask.depends;
            delete newTask.end;
            await dbOps.add(newTask);
            print(`<span class="msg-success">Recurring task created.</span>`);
          }
        }
        runList(lastFilterArgs);
      }
    } else if (["delete", "rm"].includes(cmd)) {
      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      await dbOps.delete(displayMapRef.value[id - 1]);
      runList(lastFilterArgs);
    } else if (cmd === "help") {
      const sub = args[0];
      if (!sub) {
        print(
          `<span style="color:var(--yellow)">Commands:</span> add, list, done, delete, modify, annotate, info, chain, projects, export, import. Type <span class="msg-hl">help [cmd]</span> for details.`,
        );
      } else {
        const c = resolveCommand(sub);
        if (c === "add")
          print(
            `<div class="msg-help"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:H/M/L</span> <span class="msg-arg">due:YYYYMMDD</span> <span class="msg-arg">wait:YYYYMMDD</span> <span class="msg-arg">recur:period</span> <span class="msg-arg">!tag</span></div>`,
          );
        else if (c === "modify")
          print(
            `<div class="msg-help"><span class="msg-hl">mod</span> ID <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:H</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">!tag</span> <span class="msg-arg">dep:ID</span><br><span class="msg-hl">mod</span> <span class="msg-arg">pro:Name</span> <span class="msg-arg">icon:value</span> (set/clear project icon)</div>`,
          );
        else if (c === "list")
          print(
            `<div class="msg-help"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">end:1w</span><br>Virtual: <span class="msg-arg">!overdue</span> <span class="msg-arg">!today</span> <span class="msg-arg">!waiting</span> <span class="msg-arg">!blocked</span> <span class="msg-arg">!done</span> <span class="msg-arg">!all</span></div>`,
          );
        else if (c === "done")
          print(
            `<div class="msg-help"><span class="msg-hl">done</span> ID<br>Completes a task. If recurring, creates the next instance.</div>`,
          );
        else if (c === "delete")
          print(
            `<div class="msg-help"><span class="msg-hl">delete</span> ID<br>Permanently removes a task.</div>`,
          );
        else if (c === "annotate")
          print(
            `<div class="msg-help"><span class="msg-hl">annotate</span> ID <span class="msg-arg">note text...</span><br>Adds a timestamped note. Use <span class="msg-arg">-N</span> to remove by index (see info).</div>`,
          );
        else if (c === "info")
          print(
            `<div class="msg-help"><span class="msg-hl">info</span> ID<br>Shows full details including annotations and full UUID.</div>`,
          );
        else if (c === "chain")
          print(
            `<div class="msg-help"><span class="msg-hl">chain</span> ID<br>Visualizes dependency tree for the specified task.</div>`,
          );
        else if (c === "projects" || c === "proj")
          print(
            `<div class="msg-help"><span class="msg-hl">projects</span><br>Lists all projects with task counts.</div>`,
          );
        else if (c === "export")
          print(
            `<div class="msg-help"><span class="msg-hl">export</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span><br>Exports tasks as JSON. Supports same filters as list.</div>`,
          );
        else
          print(`<span class="msg-error">No specific help for: ${sub}</span>`);
      }
    } else if (cmd === "about") {
      let version = "unknown";
      try {
        const res = await fetch("manifest.json");
        const manifest = await res.json();
        version = manifest.version || "unknown";
      } catch (e) {}
      print(
        `<div style="color:var(--base1)">Tasca v${version}<br>PWA task manager inspired by Taskwarrior.<br>Ruben Berenguel, 2025 with the help of Claude and Gemini.</div>`,
      );
    } else if (["projects", "proj"].includes(cmd)) {
      const all = await dbOps.getAll();
      const projectsMeta = await dbOps.getAllProjects();

      // Collect all project names from tasks (pending only)
      const projectSet = new Set();
      const taskCounts = {};
      all
        .filter((t) => t.status === "pending")
        .forEach((t) => {
          if (t.project) {
            projectSet.add(t.project);
            taskCounts[t.project] = (taskCounts[t.project] || 0) + 1;
          }
        });

      // Also include projects from metadata that might have no tasks
      projectsMeta.forEach((p) => projectSet.add(p.name));

      renderProjectsTable(Array.from(projectSet), projectsMeta, taskCounts);
    } else if (cmd === "link") {
      if (!window.showOpenFilePicker) {
        return print(
          '<span class="msg-error">File System Access API not supported in this browser.</span>',
        );
      }
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: "JSON files",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        await dbOps.setSetting("syncFileHandle", handle);
        print(
          `<span class="msg-success">Linked to ${handle.name}. Use 'sync' to pull & push.</span>`,
        );
      } catch (e) {
        if (e.name !== "AbortError") {
          print(`<span class="msg-error">Error: ${e.message}</span>`);
        }
      }
    } else if (cmd === "sync") {
      const handle = await dbOps.getSetting("syncFileHandle");
      if (!handle) {
        return print(
          '<span class="msg-error">No file linked. Use \'link\' first.</span>',
        );
      }
      try {
        // Verify permission
        const options = { mode: "readwrite" };
        if ((await handle.queryPermission(options)) !== "granted") {
          if ((await handle.requestPermission(options)) !== "granted") {
            return print(
              '<span class="msg-error">Permission denied. Try \'link\' again.</span>',
            );
          }
        }
        // Read first: import from linked file
        let imported = 0;
        try {
          const file = await handle.getFile();
          const text = await file.text();
          if (text.trim()) {
            const data = JSON.parse(text);
            for (const t of data) {
              if (t.uuid) {
                await dbOps.update(t);
                imported++;
              }
            }
          }
        } catch (e) {
          // File might be empty or invalid - that's ok for first sync
        }
        // Then write: export all tasks back
        const all = await dbOps.getAll();
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(all, null, 2));
        await writable.close();
        print(
          `<span class="msg-success">Synced with ${handle.name}: ${imported} imported, ${all.length} saved.</span>`,
        );
        if (imported > 0) {
          updateCache(all);
          runList(lastFilterArgs);
        }
      } catch (e) {
        print(`<span class="msg-error">Sync failed: ${e.message}</span>`);
      }
    } else if (cmd === "unlink") {
      const handle = await dbOps.getSetting("syncFileHandle");
      if (!handle) {
        return print('<span class="msg-error">No file linked.</span>');
      }
      await dbOps.deleteSetting("syncFileHandle");
      print('<span class="msg-success">Unlinked sync file.</span>');
    } else if (["modify", "mod"].includes(cmd)) {
      // Catch-all for mod with invalid first arg
      return print('<span class="msg-error">Invalid ID.</span>');
    } else print(`<span class="msg-error">Unknown: ${cmd}</span>`);
  } catch (err) {
    console.error(err);
    print(`<span class="msg-error">Error: ${err.message}</span>`);
  }
};

// --- GHOST & AUTOCOMPLETE ---
const setupInput = () => {
  const input = document.getElementById("cmd-input");
  const ghost = document.getElementById("ghost-input");

  input.addEventListener("input", () => {
    const val = input.value;
    const parts = val.split(" ");
    const last = parts[parts.length - 1];
    let suggestion = "";

    if (parts.length === 1 && val.length > 0) {
      const match = resolveCommand(val);
      if (match && match !== val) suggestion = match.substring(val.length);
    } else if (
      last.startsWith("pro:") ||
      last.startsWith("proj:") ||
      last.startsWith("project:")
    ) {
      const prefix = last.includes(":") ? last.split(":")[1] : "";
      if (prefix) {
        for (let p of knownProjects) {
          if (p.startsWith(prefix) && p !== prefix) {
            suggestion = p.substring(prefix.length);
            break;
          }
        }
      }
    } else if (last.startsWith("!")) {
      const prefix = last.substring(1);
      if (prefix) {
        for (let t of knownTags) {
          if (t.startsWith(prefix) && t !== prefix) {
            suggestion = t.substring(prefix.length);
            break;
          }
        }
      }
    } else if (last.startsWith("icon:")) {
      const prefix = last.substring(5); // remove 'icon:'
      if (prefix) {
        // Try matching full iconoir- name first (user explicitly typed iconoir-)
        for (let i of knownIcons) {
          if (i.startsWith(prefix) && i !== prefix) {
            suggestion = i.substring(prefix.length);
            break;
          }
        }
        // If no match, try matching as short name (user typed 'home', matches 'iconoir-home')
        if (!suggestion) {
          const search = "iconoir-" + prefix;
          for (let i of knownIcons) {
            if (i.startsWith(search)) {
              // suggestion is the remainder of the short name
              // e.g. prefix="hom", match="iconoir-home".
              // We want to complete to "home", so suggestion is "e".
              // i.substring(search.length) -> "e"
              suggestion = i.substring(search.length);
              break;
            }
          }
        }
      }
    }

    if (suggestion) {
      const prefixText = val;
      ghost.innerHTML = `<span style="opacity:0">${prefixText}</span><span style="opacity:0.4">${suggestion}</span>`;
    } else {
      ghost.innerHTML = "";
    }
  });

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const gText = ghost.textContent;
      if (gText) {
        input.value += gText.substring(input.value.length);
        ghost.innerHTML = "";
      }
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      if (historyIndex === -1) {
        historyTemp = input.value;
        historyIndex = cmdHistory.length - 1;
      } else if (historyIndex > 0) {
        historyIndex--;
      }
      input.value = cmdHistory[historyIndex];
      ghost.innerHTML = "";
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      if (historyIndex < cmdHistory.length - 1) {
        historyIndex++;
        input.value = cmdHistory[historyIndex];
      } else {
        historyIndex = -1;
        input.value = historyTemp;
      }
      ghost.innerHTML = "";
    }
    if (e.key === "Enter") {
      const val = input.value.trim();
      input.value = "";
      ghost.innerHTML = "";
      if (val) {
        // Add to history if different from last entry
        if (
          cmdHistory.length === 0 ||
          cmdHistory[cmdHistory.length - 1] !== val
        ) {
          cmdHistory.push(val);
          // Limit history size
          if (cmdHistory.length > 100) cmdHistory.shift();
          localStorage.setItem("tasca_history", JSON.stringify(cmdHistory));
        }
      }
      historyIndex = -1;
      historyTemp = "";
      if (val) await execute(val);
    }
  });
};

initDB().then(async () => {
  document.getElementById("import-picker").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        for (const t of data) if (t.uuid) await dbOps.update(t);
        print(`<span class="msg-success">Imported tasks.</span>`);
        runList(lastFilterArgs);
      } catch (err) {
        print(`<span class="msg-error">Error: ${err.message}</span>`);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  setupInput();

  // Tap output area to toggle input focus (mobile UX)
  const terminalOutput = document.getElementById("terminal-output");
  const cmdInput = document.getElementById("cmd-input");
  terminalOutput.addEventListener("click", () => {
    if (document.activeElement === cmdInput) {
      cmdInput.blur();
    } else {
      cmdInput.focus();
    }
  });

  // Fire and forget icon fetch
  fetchIcons();

  try {
    const tasks = await dbOps.getAll();
    updateCache(tasks);
    execute("next");
  } catch (e) {}
});
