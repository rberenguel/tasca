import {
  generateUUID,
  parseDate,
  formatDate,
  calculateNextRecurrence,
} from "./utils.js";
import { dbOps } from "./db.js";
import {
  resolveCommand,
  matchesProject,
  hasVirtualTag,
} from "./logic.js";
import { print, renderProjectsTable, formatProject } from "./ui.js";
import { runList } from "./list.js";
import { displayMapRef, updateCache, lastFilterArgs } from "./state.js";
import { setContext, getInheritedAttributes } from "./context.js";

export const execute = async (str) => {
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
            if (tag !== "ALL") fTags.push(token);
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
          if (e.name === "AbortError") return;
        }
      }

      const file = new File([blob], filename, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          print(
            `<span class="msg-success">Exported ${filtered.length} tasks.</span>`,
          );
          return;
        } catch (e) {
          if (e.name === "AbortError") return;
        }
      }

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
        sched = null,
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
        else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
          sched = parseDate(token.split(":")[1]);
        else if (token.startsWith("recur:")) recur = token.split(":")[1];
        else if (token.startsWith("url:")) url = token.substring(4);
        else if (token.startsWith("!")) tags.push(token.substring(1));
        else desc.push(token);
      }
      if (desc.length === 0)
        return print('<span class="msg-error">No description.</span>');

      // Inherit context attributes if not explicitly specified
      const inherited = getInheritedAttributes();
      if (!proj && inherited.project) proj = inherited.project;
      if (tags.length === 0 && inherited.tags) tags = [...inherited.tags];

      await dbOps.add({
        uuid: generateUUID(),
        description: desc.join(" "),
        project: proj,
        priority,
        tags,
        depends,
        due,
        wait,
        sched,
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

      if (args.length > 0 && args[0].match(/^\d+$/)) {
        limit = parseInt(args[0]);
        localStorage.setItem("tasca_next_limit", limit);
        args.shift();
      }

      await runList(args, limit);
    } else if (cmd === "chain") {
      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const rootUuid = displayMapRef.value[id - 1];
      const all = await dbOps.getAll();

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
      const projName = args[0].split(":")[1];
      if (!projName)
        return print(
          '<span class="msg-error">No project name specified.</span>',
        );

      let icon = undefined;
      args.slice(1).forEach((arg) => {
        if (arg.startsWith("icon:")) {
          let val = arg.split(":")[1];
          if (!val || val === "") {
            icon = null;
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
        else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
          task.sched = parseDate(token.split(":")[1]);
        else if (token.startsWith("recur:")) task.recur = token.split(":")[1];
        else if (token.startsWith("url:")) {
          const val = token.substring(4);
          task.url = val || null;
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
              const uuid = displayMapRef.value[i - 1];
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
        const recurrence = calculateNextRecurrence(task);
        if (recurrence) {
          const newTask = {
            ...task,
            uuid: generateUUID(),
            status: "pending",
            due: recurrence.nextDue,
            wait: recurrence.nextWait || null,
            sched: recurrence.nextSched || null,
            entry: Date.now(),
            annotations: [],
          };
          delete newTask.depends;
          delete newTask.end;
          delete newTask.start;
          await dbOps.add(newTask);
          print(`<span class="msg-success">Recurring task created.</span>`);
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
          `<span style="color:var(--yellow)">Commands:</span> add, list, done, delete, modify, annotate, info, chain, projects, context, export, import. Type <span class="msg-hl">help [cmd]</span> for details.`,
        );
      } else {
        const c = resolveCommand(sub);
        if (c === "add")
          print(
            `<div class="msg-help"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:H/M/L</span> <span class="msg-arg">due:YYYYMMDD</span> <span class="msg-arg">wait:YYYYMMDD</span> <span class="msg-arg">sched:YYYYMMDD</span> <span class="msg-arg">recur:period</span> <span class="msg-arg">!tag</span></div>`,
          );
        else if (c === "modify")
          print(
            `<div class="msg-help"><span class="msg-hl">mod</span> ID <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:H</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">sched:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">!tag</span> <span class="msg-arg">dep:ID</span><br><span class="msg-hl">mod</span> <span class="msg-arg">pro:Name</span> <span class="msg-arg">icon:value</span> (set/clear project icon)</div>`,
          );
        else if (c === "list")
          print(
            `<div class="msg-help"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">end:1w</span><br>Virtual: <span class="msg-arg">!overdue</span> <span class="msg-arg">!today</span> <span class="msg-arg">!waiting</span> <span class="msg-arg">!scheduled</span> <span class="msg-arg">!blocked</span> <span class="msg-arg">!done</span> <span class="msg-arg">!all</span></div>`,
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
        else if (c === "context" || c === "ctx" || c === "c")
          print(
            `<div class="msg-help"><span class="msg-hl">context</span> <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">search</span><br>Set persistent filter context. Filters auto-apply to list/next, attributes inherit to add.<br><span class="msg-hl">context</span> (no args) clears context.</div>`,
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
        const options = { mode: "readwrite" };
        if ((await handle.queryPermission(options)) !== "granted") {
          if ((await handle.requestPermission(options)) !== "granted") {
            return print(
              '<span class="msg-error">Permission denied. Try \'link\' again.</span>',
            );
          }
        }
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
          // File might be empty or invalid
        }
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
      return print('<span class="msg-error">Invalid ID.</span>');
    } else if (["context", "ctx", "c"].includes(cmd)) {
      const ctx = setContext(args);
      if (ctx) {
        print(`<span class="msg-success">Context set: ${ctx.raw}</span>`);
      } else {
        print(`<span class="msg-info">Context cleared.</span>`);
      }
      runList([]);
    } else print(`<span class="msg-error">Unknown: ${cmd}</span>`);
  } catch (err) {
    console.error(err);
    print(`<span class="msg-error">Error: ${err.message}</span>`);
  }
};
