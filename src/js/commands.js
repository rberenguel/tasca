import {
  generateUUID,
  parseDate,
  formatDate,
  calculateNextRecurrence,
} from "./utils.js";
import { dbOps } from "./db.js";
import { resolveCommand, matchesProject, hasVirtualTag } from "./logic.js";
import { print, renderProjectsTable, formatProject } from "./ui.js";
import { runList } from "./list.js";
import {
  displayMapRef,
  updateCache,
  lastFilterArgs,
  lastLimit,
} from "./state.js";
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
      await dbOps.cleanupOrphanProjects();
      const all = await dbOps.getAll();
      const projectsMeta = await dbOps.getAllProjects();
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
              if (hasVirtualTag(t, ft, all, projectsMeta)) return true;
              return false;
            }),
          );
        }
        if (search.length)
          filtered = filtered.filter((t) =>
            search.every((s) => t.description.toLowerCase().includes(s)),
          );
      }

      const exportData = { tasks: filtered, projects: projectsMeta };
      const dataStr = JSON.stringify(exportData, null, 2);
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
    } else if (rawCmd === "42clear") {
      await dbOps.purgeAll();
      updateCache([]);
      document.getElementById("terminal-output").innerHTML = "";
      print('<span class="msg-success">Database purged. Reload to start fresh.</span>');
    } else if (["add", "a", "log"].includes(cmd)) {
      let desc = [],
        proj = "",
        priority = null,
        tags = [],
        depends = [],
        due = null,
        wait = null,
        sched = null,
        recur = null,
        url = null,
        icon = null;
      for (let token of args) {
        if (
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
        else if (token.startsWith("wait:"))
          wait = parseDate(token.split(":")[1]);
        else if (token.startsWith("sched:") || token.startsWith("scheduled:"))
          sched = parseDate(token.split(":")[1]);
        else if (token.startsWith("recur:")) recur = token.split(":")[1];
        else if (token.startsWith("url:")) url = token.substring(4);
        else if (token.startsWith("icon:")) {
          let val = token.split(":")[1];
          if (val && !val.startsWith("iconoir-")) val = "iconoir-" + val;
          icon = val || null;
        }
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
        icon,
        annotations: [],
        status: "pending",
        entry: Date.now(),
      });
      runList(lastFilterArgs, lastLimit);
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
        let tagsToToggle = [];
        args.slice(1).forEach((arg) => {
          if (arg.startsWith("icon:")) {
            let val = arg.split(":")[1];
            if (val && !val.startsWith("iconoir-")) val = "iconoir-" + val;
            icon = val;
          } else if (arg.startsWith("!")) {
            tagsToToggle.push(arg.substring(1).toLowerCase());
          }
        });

        if (icon || tagsToToggle.length > 0) {
          const projects = await dbOps.getAllProjects();
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
          await dbOps.updateProject(proj);
          print(
            `<span class="msg-success">Project ${projName} updated.</span>`,
          );
          runList(lastFilterArgs, lastLimit);
        } else {
          print(
            '<span class="msg-info">No changes (specify icon: or !tag).</span>',
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
        runList(lastFilterArgs, lastLimit);
        return;
      }

      if (!task.annotations) task.annotations = [];
      task.annotations.push({ entry: Date.now(), description: note });
      await dbOps.update(task);
      runList(lastFilterArgs, lastLimit);
    } else if (cmd === "info" || cmd === "i") {
      // Check if it's a project info request
      if (
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
        const projects = await dbOps.getAllProjects();
        const proj = projects.find((p) => p.name === projName);
        const all = await dbOps.getAll();
        const taskCount = all.filter(
          (t) => t.status === "pending" && t.project === projName,
        ).length;
        let html = `<div class="task-info">`;
        html += `<div style="color:var(--yellow)">Project: ${projName}</div>`;
        if (proj?.icon)
          html += `<div><b>Icon:</b> <i class="${proj.icon}" style="margin-right:5px"></i>${proj.icon.replace("iconoir-", "")}</div>`;
        if (proj?.tags?.length > 0)
          html += `<div><b>Tags:</b> ${proj.tags.join(" ")}</div>`;
        html += `<div><b>Pending tasks:</b> ${taskCount}</div>`;
        html += `</div>`;
        print(html, true);
        return;
      }
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
      if (t.icon)
        html += `<div><b>Icon:</b> <i class="${t.icon}"></i> ${t.icon}</div>`;
      if (t.due) html += `<div><b>Due:</b> ${formatDate(t.due)}</div>`;
      if (t.wait) html += `<div><b>Wait:</b> ${formatDate(t.wait)}</div>`;
      if (t.sched)
        html += `<div><b>Scheduled:</b> ${formatDate(t.sched)}</div>`;
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
      let tagsToToggle = [];
      args.slice(1).forEach((arg) => {
        if (arg.startsWith("icon:")) {
          let val = arg.split(":")[1];
          if (!val || val === "") {
            icon = null;
          } else {
            if (!val.startsWith("iconoir-")) val = "iconoir-" + val;
            icon = val;
          }
        } else if (arg.startsWith("!")) {
          tagsToToggle.push(arg.substring(1).toLowerCase());
        }
      });

      if (icon === undefined && tagsToToggle.length === 0) {
        return print(
          '<span class="msg-info">No changes (specify icon: or !tag to toggle).</span>',
        );
      }

      const projects = await dbOps.getAllProjects();
      let proj = projects.find((p) => p.name === projName);
      if (!proj) proj = { name: projName };
      if (icon !== undefined) proj.icon = icon;
      if (tagsToToggle.length > 0) {
        if (!proj.tags) proj.tags = [];
        tagsToToggle.forEach((tag) => {
          const idx = proj.tags.indexOf(tag);
          if (idx >= 0) proj.tags.splice(idx, 1);
          else proj.tags.push(tag);
        });
      }
      await dbOps.updateProject(proj);
      print(`<span class="msg-success">Project ${projName} updated.</span>`);
      runList(lastFilterArgs, lastLimit);
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
        if (token.startsWith("pri:")) {
          const val = parseInt(token.split(":")[1], 10);
          if (!isNaN(val)) task.priority = val;
          else if (token === "pri:") task.priority = null; // clear priority
        } else if (
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
        } else if (token.startsWith("icon:")) {
          let val = token.split(":")[1];
          if (val && !val.startsWith("iconoir-")) val = "iconoir-" + val;
          task.icon = val || null;
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
      runList(lastFilterArgs, lastLimit);
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
        runList(lastFilterArgs, lastLimit);
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
        runList(lastFilterArgs, lastLimit);
      }
    } else if (["delete", "rm"].includes(cmd)) {
      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      await dbOps.delete(displayMapRef.value[id - 1]);
      runList(lastFilterArgs, lastLimit);
    } else if (cmd === "skip") {
      const id = parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      if (!task) return print('<span class="msg-error">Task not found.</span>');
      if (!task.recur || !task.due)
        return print(
          '<span class="msg-error">Task is not recurring (needs both due: and recur:).</span>',
        );

      const recurrence = calculateNextRecurrence(task);
      if (!recurrence)
        return print(
          '<span class="msg-error">Could not calculate next recurrence.</span>',
        );

      // Mark current as skipped
      task.status = "skipped";
      task.end = Date.now();
      await dbOps.update(task);

      // Create next occurrence
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

      print(
        '<span class="msg-success">Skipped. Next occurrence created.</span>',
      );
      runList(lastFilterArgs, lastLimit);
    } else if (cmd === "help") {
      const sub = args[0];
      if (!sub) {
        print(
          `<span style="color:var(--yellow)">Commands:</span> add, list, done, skip, delete, modify, annotate, info, chain, projects, context, calendar, export, import. Type <span class="msg-hl">help [cmd]</span> for details.`,
        );
      } else {
        const c = resolveCommand(sub);
        if (c === "add")
          print(
            `<div class="msg-help"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">due:DATE</span> <span class="msg-arg">wait:DATE</span> <span class="msg-arg">sched:DATE</span> <span class="msg-arg">recur:PERIOD</span> <span class="msg-arg">!tag</span><br>DATE: <span class="msg-arg">YYYYMMDD</span> | <span class="msg-arg">today</span> | <span class="msg-arg">tomorrow</span> | <span class="msg-arg">3d</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span><br>PERIOD: <span class="msg-arg">1d</span> | <span class="msg-arg">1w</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span> | <span class="msg-arg">1y</span><br>Priority: 1=low, 10=medium, 50=high. Negative for backlog. Use <span class="msg-arg">!someday</span> to hide from next.</div>`,
          );
        else if (c === "modify")
          print(
            `<div class="msg-help"><span class="msg-hl">mod</span> ID <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">sched:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">!tag</span> <span class="msg-arg">dep:ID</span><br><span class="msg-hl">mod</span> <span class="msg-arg">pro:Name</span> <span class="msg-arg">icon:value</span> <span class="msg-arg">!tag</span> (project metadata, tags toggle)</div>`,
          );
        else if (c === "list")
          print(
            `<div class="msg-help"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">end:1w</span><br>Virtual: <span class="msg-arg">!overdue</span> <span class="msg-arg">!today</span> <span class="msg-arg">!waiting</span> <span class="msg-arg">!scheduled</span> <span class="msg-arg">!recurring</span> <span class="msg-arg">!blocked</span> <span class="msg-arg">!someday</span> <span class="msg-arg">!done</span> <span class="msg-arg">!all</span></div>`,
          );
        else if (c === "done")
          print(
            `<div class="msg-help"><span class="msg-hl">done</span> ID<br>Completes a task. If recurring, creates the next instance.</div>`,
          );
        else if (c === "skip")
          print(
            `<div class="msg-help"><span class="msg-hl">skip</span> ID<br>Skip a recurring task. Marks as skipped and creates next instance.</div>`,
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
            `<div class="msg-help"><span class="msg-hl">info</span> ID<br>Shows full task details including annotations and UUID.<br><span class="msg-hl">info</span> <span class="msg-arg">pro:Name</span> — show project details (icon, tags).</div>`,
          );
        else if (c === "chain")
          print(
            `<div class="msg-help"><span class="msg-hl">chain</span> ID<br>Visualizes dependency tree for the specified task.</div>`,
          );
        else if (c === "projects" || c === "proj")
          print(
            `<div class="msg-help"><span class="msg-hl">projects</span><br>Lists all projects with task counts and tags.<br>Toggle tags: <span class="msg-arg">mod pro:Name !reference</span> (use again to remove)<br>Projects with <span class="msg-arg">!reference</span> tag are hidden from next.</div>`,
          );
        else if (c === "export")
          print(
            `<div class="msg-help"><span class="msg-hl">export</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span><br>Exports tasks as JSON. Supports same filters as list.</div>`,
          );
        else if (c === "context" || c === "ctx" || c === "c")
          print(
            `<div class="msg-help"><span class="msg-hl">context</span> <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">search</span><br>Set persistent filter context. Filters auto-apply to list/next, attributes inherit to add.<br><span class="msg-hl">context</span> (no args) clears context.</div>`,
          );
        else if (c === "calendar" || c === "cal")
          print(
            `<div class="msg-help"><span class="msg-hl">cal</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">lim:N</span><br>Agenda view of dated tasks. Shows <span class="msg-arg">[due]</span> <span class="msg-arg">[sched]</span> <span class="msg-arg">[wait]</span> dates.<br>Includes overdue from past 7 days. <span class="msg-arg">!done</span> shows completed by end date.</div>`,
          );
        else if (c === "link")
          print(
            `<div class="msg-help"><span class="msg-hl">link</span><br>Link a JSON file for sync (desktop Chrome). Use <span class="msg-arg">load</span> to import, <span class="msg-arg">save</span> to export.</div>`,
          );
        else if (c === "load")
          print(
            `<div class="msg-help"><span class="msg-hl">load</span><br>Import tasks from linked file. Tasks matched by UUID.</div>`,
          );
        else if (c === "save")
          print(
            `<div class="msg-help"><span class="msg-hl">save</span><br>Export all tasks to linked file (overwrites).</div>`,
          );
        else if (c === "unlink")
          print(
            `<div class="msg-help"><span class="msg-hl">unlink</span><br>Remove linked file association.</div>`,
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
      await dbOps.cleanupOrphanProjects();
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
          `<span class="msg-success">Linked to ${handle.name}. Use 'load' to import, 'save' to export.</span>`,
        );
      } catch (e) {
        if (e.name !== "AbortError") {
          print(`<span class="msg-error">Error: ${e.message}</span>`);
        }
      }
    } else if (cmd === "load") {
      const handle = await dbOps.getSetting("syncFileHandle");
      if (!handle) {
        return print(
          "<span class=\"msg-error\">No file linked. Use 'link' first.</span>",
        );
      }
      try {
        const options = { mode: "read" };
        if ((await handle.queryPermission(options)) !== "granted") {
          if ((await handle.requestPermission(options)) !== "granted") {
            return print(
              "<span class=\"msg-error\">Permission denied. Try 'link' again.</span>",
            );
          }
        }
        let imported = 0;
        let importedProjects = 0;
        const file = await handle.getFile();
        const text = await file.text();
        if (text.trim()) {
          const data = JSON.parse(text);
          // Handle both old format (array) and new format (object with tasks/projects)
          const tasks = Array.isArray(data) ? data : (data.tasks || []);
          const projects = Array.isArray(data) ? [] : (data.projects || []);
          for (const t of tasks) {
            if (t.uuid) {
              await dbOps.update(t);
              imported++;
            }
          }
          for (const p of projects) {
            if (p.name) {
              await dbOps.updateProject(p);
              importedProjects++;
            }
          }
        }
        const projMsg = importedProjects ? ` and ${importedProjects} projects` : "";
        print(
          `<span class="msg-success">Loaded ${imported} tasks${projMsg} from ${handle.name}.</span>`,
        );
        if (imported > 0) {
          const all = await dbOps.getAll();
          updateCache(all);
          runList(lastFilterArgs, lastLimit);
        }
      } catch (e) {
        print(`<span class="msg-error">Load failed: ${e.message}</span>`);
      }
    } else if (cmd === "save") {
      const handle = await dbOps.getSetting("syncFileHandle");
      if (!handle) {
        return print(
          "<span class=\"msg-error\">No file linked. Use 'link' first.</span>",
        );
      }
      try {
        const options = { mode: "readwrite" };
        if ((await handle.queryPermission(options)) !== "granted") {
          if ((await handle.requestPermission(options)) !== "granted") {
            return print(
              "<span class=\"msg-error\">Permission denied. Try 'link' again.</span>",
            );
          }
        }
        await dbOps.cleanupOrphanProjects();
        const all = await dbOps.getAll();
        const projects = await dbOps.getAllProjects();
        const saveData = { tasks: all, projects };
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(saveData, null, 2));
        await writable.close();
        print(
          `<span class="msg-success">Saved ${all.length} tasks to ${handle.name}.</span>`,
        );
      } catch (e) {
        print(`<span class="msg-error">Save failed: ${e.message}</span>`);
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
      execute("next");
    } else if (["calendar", "cal"].includes(cmd)) {
      const { mergeFilters } = await import("./context.js");
      const effectiveArgs = mergeFilters(args);

      // Parse limit from args (lim:N or l:N)
      let limit = localStorage.getItem("tasca_cal_limit")
        ? parseInt(localStorage.getItem("tasca_cal_limit"))
        : 14;
      let filterArgs = [];
      let showDone = false;

      for (const token of effectiveArgs) {
        if (token.startsWith("lim:") || token.startsWith("l:")) {
          limit = parseInt(token.split(":")[1]) || 14;
          localStorage.setItem("tasca_cal_limit", limit);
        } else {
          filterArgs.push(token);
          const tag = token.startsWith("!")
            ? token.substring(1).toUpperCase()
            : "";
          if (tag === "DONE" || tag === "COMPLETED") showDone = true;
        }
      }

      const all = await dbOps.getAll();
      const projects = await dbOps.getAllProjects();
      const now = Date.now();
      const Day = 86400000;
      const startOfToday = new Date().setHours(0, 0, 0, 0);
      const pastLimit = startOfToday - 7 * Day; // 7 days ago
      const futureLimit = startOfToday + limit * Day;

      // Parse filters (same as list)
      let fProj = null,
        fTags = [],
        search = [];
      for (let token of filterArgs) {
        if (
          token.startsWith("pro:") ||
          token.startsWith("proj:") ||
          token.startsWith("project:")
        )
          fProj = token.split(":")[1];
        else if (token.startsWith("!")) {
          fTags.push(token);
        } else search.push(token.toLowerCase());
      }

      // Filter tasks
      let tasks = showDone
        ? all.filter((t) => t.status === "completed")
        : all.filter((t) => t.status === "pending");

      if (fProj) tasks = tasks.filter((t) => matchesProject(t.project, fProj));
      if (fTags.length) {
        tasks = tasks.filter((t) =>
          fTags.every((ft) => {
            const tag = ft.substring(1).toLowerCase();
            if (t.tags && t.tags.some((tt) => tt.toLowerCase() === tag))
              return true;
            if (hasVirtualTag(t, ft, all, projects)) return true;
            return false;
          }),
        );
      }
      if (search.length)
        tasks = tasks.filter((t) =>
          search.every((s) => t.description.toLowerCase().includes(s)),
        );

      // Collect date entries: { date, type, task }
      const entries = [];
      for (const t of tasks) {
        if (showDone) {
          // For done tasks, show by end date
          if (t.end && t.end >= pastLimit && t.end < futureLimit) {
            entries.push({ date: t.end, type: "end", task: t });
          }
        } else {
          // For pending tasks, show due/sched/wait
          if (t.due) {
            // Show overdue (past 7 days) or future within limit
            if (
              (t.due < startOfToday && t.due >= pastLimit) ||
              (t.due >= startOfToday && t.due < futureLimit)
            ) {
              entries.push({ date: t.due, type: "due", task: t });
            }
          }
          if (t.sched && t.sched >= startOfToday && t.sched < futureLimit) {
            entries.push({ date: t.sched, type: "sched", task: t });
          }
          if (t.wait && t.wait >= startOfToday && t.wait < futureLimit) {
            entries.push({ date: t.wait, type: "wait", task: t });
          }
        }
      }

      // Sort by date
      entries.sort((a, b) => a.date - b.date);

      // Group by day
      const groups = {};
      for (const e of entries) {
        const dayKey = new Date(e.date).toDateString();
        if (!groups[dayKey]) groups[dayKey] = [];
        groups[dayKey].push(e);
      }

      // Render
      if (Object.keys(groups).length === 0) {
        print(
          `<span class="msg-info">No dated tasks in range (${limit}d).</span>`,
        );
      } else {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        let html = '<div class="calendar-view">';

        for (const dayKey of Object.keys(groups)) {
          const d = new Date(dayKey);
          const isOverdue = d.getTime() < startOfToday;
          const isToday = d.toDateString() === new Date().toDateString();
          const dayLabel = `${monthNames[d.getMonth()]} ${d.getDate()} (${dayNames[d.getDay()]})`;

          let headerStyle =
            "color:var(--cyan); border-bottom:1px solid var(--base01); margin-top:8px;";
          if (isOverdue)
            headerStyle =
              "color:var(--red); border-bottom:1px solid var(--base01); margin-top:8px;";
          if (isToday)
            headerStyle =
              "color:var(--green); border-bottom:1px solid var(--base01); margin-top:8px; font-weight:bold;";

          html += `<div style="${headerStyle}">${dayLabel}${isToday ? " (today)" : ""}${isOverdue ? " (overdue)" : ""}</div>`;

          for (const e of groups[dayKey]) {
            const t = e.task;
            const typeLabel = `<span style="color:var(--base01)">[${e.type}]</span>`;
            let desc = t.description;
            if (t.priority)
              desc += ` <span style="color:var(--magenta)">pri:${t.priority}</span>`;
            if (t.project) {
              const pMeta = projects.find((p) => p.name === t.project);
              const icon =
                pMeta && pMeta.icon
                  ? `<i class="${pMeta.icon}" style="margin-right:3px"></i>`
                  : "";
              desc += ` <span style="color:var(--yellow)">${icon}${t.project}</span>`;
            }
            html += `<div style="margin-left:12px">${typeLabel} ${desc}</div>`;
          }
        }
        html += "</div>";
        print(html, true);
      }
    } else print(`<span class="msg-error">Unknown: ${cmd}</span>`);
  } catch (err) {
    console.error(err);
    print(`<span class="msg-error">Error: ${err.message}</span>`);
  }
};
