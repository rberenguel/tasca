import {
  generateUUID,
  parseDate,
  parseWaitTime,
  formatDate,
  formatDateHtml,
  formatDateOnly,
  calculateNextRecurrence,
  parseRelativeTime,
  uniqueTimestamp,
} from "./utils.js";
import { dbOps } from "./db.js";
import {
  resolveCommand,
  matchesProject,
  hasVirtualTag,
  expandVirtualTagShorthand,
  VALID_COMMANDS,
} from "./logic.js";
import {
  print,
  formatProject,
  formatInlineCode,
} from "./ui.js";
import { runList } from "./list.js";
import {
  displayMapRef,
  iconResultsRef,
  updateCache,
  lastFilterArgs,
  lastLimit,
  markDirty,
  markClean,
} from "./state.js";
import { setContext, getInheritedAttributes } from "./context.js";
import { pushUndo, popUndo } from "./undo.js";
import { searchIcons, searchIconsMulti } from "./icon-tags.js";
import { handleReport } from "./commands-reports.js";
import { handleNext, handleChain, handleProjects, handleCalendar } from "./commands-views.js";

// Convert icon name to full Phosphor class (handles legacy full class format)
const iconClass = (name) => {
  if (!name) return "";
  return name.startsWith("ph-") ? name : `ph-light ph-${name}`;
};

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);

let lastCommandWasPassthrough = false;

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

const createTaskObject = (args) => {
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

const applyUndo = async (record) => {
  if (record.type === "update") {
    await dbOps.update(record.task, { touch: false });
  } else if (record.type === "create") {
    await dbOps.delete(record.uuid);
  } else if (record.type === "delete") {
    await dbOps.add(record.task, { touch: false });
  } else if (record.type === "compound") {
    for (const r of [...record.records].reverse()) {
      await applyUndo(r);
    }
  }
};

export const execute = async (str) => {
  dbOps.check();

  try {
    let parts = str.trim().split(/\s+/);
    if (!parts.length || parts[0] === "") {
      if (lastCommandWasPassthrough) {
        lastCommandWasPassthrough = false;
        await runList(lastFilterArgs, lastLimit);
      }
      return;
    }
    if (parts[0] === "task") parts.shift();
    parts = normalizeArgs(parts);

    let rawCmd = parts[0];
    let cmd = resolveCommand(rawCmd);
    let args = parts.slice(1);
    let targetId = rawCmd.match(/^\d+$/) ? parseInt(rawCmd) : null;

    // Handle NUMBER COMMAND syntax (e.g., "1 done" instead of "done 1")
    if (targetId && args[0]) {
      const resolved =
        resolveCommand(args[0]) ||
        (VALID_COMMANDS.includes(args[0]) ? args[0] : null);
      if (resolved) {
        cmd = resolved;
        args = args.slice(1);
      }
    }
    if (!cmd && rawCmd.match(/^\d+$/)) {
      cmd = "info";
    }
    if (!cmd) cmd = rawCmd;

    lastCommandWasPassthrough = ["help", "icon", "save", "export", "exp"].includes(
      cmd,
    );

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
            token.startsWith("p:") ||
            token.startsWith("pro:") ||
            token.startsWith("proj:") ||
            token.startsWith("project:")
          )
            fProj = token.split(":")[1];
          else if (token.startsWith("!")) {
            const expanded = expandVirtualTagShorthand(token);
            const tag = expanded.substring(1).toUpperCase();
            if (tag !== "ALL") fTags.push(expanded);
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

      const exportData = {
        tasks: filtered,
        projects: projectsMeta,
        savedAt: Date.now(),
      };
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
            `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks to ${handle.name}.</span></div>`,
            false,
          );
          if (args.length === 0) {
            markClean();
            await dbOps.setSetting("lastSave", Date.now());
          }
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
            `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks.</span></div>`,
            false,
          );
          if (args.length === 0) {
            markClean();
            await dbOps.setSetting("lastSave", Date.now());
          }
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
        `<div class="msg-standalone"><span class="msg-success">Exported ${filtered.length} tasks.</span></div>`,
        false,
      );
      if (args.length === 0) {
        markClean();
        await dbOps.setSetting("lastSave", Date.now());
      }
    } else if (cmd === "import" || cmd === "imp")
      document.getElementById("import-picker").click();
    else if (cmd === "clear") {
      document.getElementById("terminal-output").innerHTML = "";
      execute("next");
    } else if (rawCmd === "42clear") {
      await dbOps.purgeAll();
      await dbOps.deleteSetting("lastSave");
      updateCache([]);
      document.getElementById("terminal-output").innerHTML = "";
      print(
        '<span class="msg-success">Database purged. Reload to start fresh.</span>',
      );
    } else if (["add", "a", "log"].includes(cmd)) {
      const tObj = createTaskObject(args);
      if (tObj.desc.length === 0)
        return print('<span class="msg-error">No description.</span>');

      // Inherit context attributes if not explicitly specified
      const inherited = getInheritedAttributes();
      let proj = tObj.proj;
      let tags = tObj.tags;
      if (!proj && inherited.project) proj = inherited.project;
      if (tags.length === 0 && inherited.tags) tags = [...inherited.tags];

      const uuid = generateUUID();
      await dbOps.add({
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
      markDirty();
      await runList(lastFilterArgs, lastLimit);
    } else if (cmd === "list" || cmd === "ls" || cmd === "l") {
      await runList(args);
    } else if (cmd === "next") {
      await handleNext(args, print);
    } else if (["chain", "dependencies", "tree"].includes(cmd)) {
      await handleChain(args, print);
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
            icon = arg.split(":")[1] || null;
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
          markDirty();
          await runList(lastFilterArgs, lastLimit);
        } else {
          print(
            '<span class="msg-info">No changes (specify icon: or !tag).</span>',
          );
        }
        return;
      }

      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      const note = (targetId ? args : args.slice(1)).join(" ");
      if (!note)
        return print('<span class="msg-error">No annotation text.</span>');

      pushUndo({ type: "update", task: structuredClone(task) });
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
        markDirty();
        await runList(lastFilterArgs, lastLimit);
        return;
      }

      if (!task.annotations) task.annotations = [];
      task.annotations.push({ entry: Date.now(), description: note });
      await dbOps.update(task);
      markDirty();
      await runList(lastFilterArgs, lastLimit);
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
          html += `<div><b>Icon:</b> <i class="${iconClass(proj.icon)}" style="margin-right:5px"></i>${proj.icon.replace(/^ph-light ph-/, "")}</div>`;
        if (proj?.tags?.length > 0)
          html += `<div><b>Tags:</b> ${proj.tags.join(" ")}</div>`;
        html += `<div><b>Pending tasks:</b> ${taskCount}</div>`;
        html += `</div>`;
        print(html, true);
        return;
      }
      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const t = await dbOps.get(displayMapRef.value[id - 1]);
      let html = `<div class="task-info">`;
      html += `<div style="color:var(--yellow)">Task ${id} - ${t.uuid}</div>`;
      html += `<div><b>Desc:</b> ${formatInlineCode(t.description)}</div>`;
      html += `<div><b>Status:</b> ${t.status}</div>`;
      if (t.project) {
        const projects = await dbOps.getAllProjects();
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
          html += `<div style="margin-left:10px; font-size:0.9em; color:var(--base1)"><span style="color:var(--base01)">${i + 1}.</span> ${formatDate(a.entry)}: ${formatInlineCode(a.description)}</div>`;
        });
      }
      html += `</div>`;
      print(html, true);
    } else if (["edit", "ed"].includes(cmd)) {
      // Populate input with mod command for quick editing
      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const t = await dbOps.get(displayMapRef.value[id - 1]);

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
            const idx = displayMapRef.value.indexOf(uuid);
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
          icon = !val || val === "" ? null : val;
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
      await runList(lastFilterArgs, lastLimit);
    } else if (["modify", "mod"].includes(cmd)) {
      const id = targetId || parseInt(args[0]);
      const tokens = targetId ? args : args.slice(1);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
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
      markDirty();
      await runList(lastFilterArgs, lastLimit);
    } else if (cmd === "start" || cmd === "st") {
      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      if (task) {
        pushUndo({ type: "update", task: structuredClone(task) });
        task.start = Date.now();
        await dbOps.update(task);
        print(`<span class="msg-success">Started task ${id}.</span>`);
        markDirty();
        await runList(lastFilterArgs, lastLimit);
      }
    } else if (cmd === "done") {
      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      if (task) {
        const undoRecords = [{ type: "update", task: structuredClone(task) }];
        task.status = "completed";
        task.end = Date.now();
        await dbOps.update(task);
        const recurrence = calculateNextRecurrence(task);
        if (recurrence) {
          const newUuid = generateUUID();
          const newTask = {
            ...task,
            uuid: newUuid,
            status: "pending",
            due: recurrence.nextDue,
            wait: recurrence.nextWait || null,
            waitTime: recurrence.waitTime || task.waitTime || null,
            sched: recurrence.nextSched || null,
            entry: uniqueTimestamp(),
            annotations: [],
          };
          delete newTask.depends;
          delete newTask.end;
          delete newTask.start;
          await dbOps.add(newTask);
          undoRecords.push({ type: "create", uuid: newUuid });
          print(`<span class="msg-success">Recurring task created.</span>`);
        }
        pushUndo({ type: "compound", records: undoRecords });
        markDirty();
        await runList(lastFilterArgs, lastLimit);
      }
    } else if (["delete", "rm"].includes(cmd)) {
      const id = targetId || parseInt(args[0]);
      if (!id || !displayMapRef.value[id - 1])
        return print('<span class="msg-error">Invalid ID.</span>');
      const task = await dbOps.get(displayMapRef.value[id - 1]);
      pushUndo({ type: "delete", task: structuredClone(task) });
      await dbOps.delete(displayMapRef.value[id - 1]);
      markDirty();
      await runList(lastFilterArgs, lastLimit);
    } else if (cmd === "skip") {
      const id = targetId || parseInt(args[0]);
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

      const undoRecords = [{ type: "update", task: structuredClone(task) }];

      // Mark current as skipped
      task.status = "skipped";
      task.end = Date.now();
      await dbOps.update(task);

      // Create next occurrence
      const newUuid = generateUUID();
      const newTask = {
        ...task,
        uuid: newUuid,
        status: "pending",
        due: recurrence.nextDue,
        wait: recurrence.nextWait || null,
        waitTime: recurrence.waitTime || task.waitTime || null,
        sched: recurrence.nextSched || null,
        entry: uniqueTimestamp(),
        annotations: [],
      };
      delete newTask.depends;
      delete newTask.end;
      delete newTask.start;
      await dbOps.add(newTask);
      undoRecords.push({ type: "create", uuid: newUuid });

      pushUndo({ type: "compound", records: undoRecords });
      print(
        '<span class="msg-success">Skipped. Next occurrence created.</span>',
      );
      markDirty();
      await runList(lastFilterArgs, lastLimit);
    } else if (cmd === "undo") {
      const record = popUndo();
      if (!record)
        return print('<span class="msg-error">Nothing to undo.</span>');
      await applyUndo(record);
      print('<span class="msg-success">Undone.</span>');
      markDirty();
      await runList(lastFilterArgs, lastLimit);
    } else if (cmd === "help") {
      const sub = args[0];
      if (!sub) {
        print(
          `<div class="msg-standalone"><span style="color:var(--yellow)">Commands:</span> add, list, done, skip, delete, modify, edit, annotate, undo, info, chain, projects, context, calendar, report, export, import, icon. Type <span class="msg-hl">help [cmd]</span> for details.</div>`,
          false,
        );
      } else {
        const c = resolveCommand(sub);
        if (c === "add")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">due:DATE</span> <span class="msg-arg">wait:DATE</span> <span class="msg-arg">sched:DATE</span> <span class="msg-arg">recur:PERIOD</span> <span class="msg-arg">!tag</span><br>DATE: <span class="msg-arg">YYYYMMDD</span> | <span class="msg-arg">today</span> | <span class="msg-arg">tomorrow</span> | <span class="msg-arg">3d</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span><br>PERIOD: <span class="msg-arg">1d</span> | <span class="msg-arg">1w</span> | <span class="msg-arg">2w</span> | <span class="msg-arg">1m</span> | <span class="msg-arg">1y</span><br>Priority: 1=low, 10=medium, 50=high. Negative for backlog. Use <span class="msg-arg">!someday</span> to hide from next.</div>`,
            false,
          );
        else if (c === "modify")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">mod</span> ID <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:N</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">sched:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">!tag</span> <span class="msg-arg">dep:ID</span><br><span class="msg-hl">mod</span> <span class="msg-arg">pro:Name</span> <span class="msg-arg">icon:value</span> <span class="msg-arg">!tag</span> (project metadata, tags toggle)</div>`,
            false,
          );
        else if (c === "icon")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">icon</span> <span class="msg-arg">term</span><br>Search for Phosphor icon names by keyword. Use with <span class="msg-arg">icon:name</span> in add/modify.</div>`,
            false,
          );
        else if (c === "list")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">end:1w</span><br>Virtual: <span class="msg-arg">!overdue</span> <span class="msg-arg">!today</span> <span class="msg-arg">!waiting</span> <span class="msg-arg">!scheduled</span> <span class="msg-arg">!recurring</span> <span class="msg-arg">!blocked</span> <span class="msg-arg">!someday</span> <span class="msg-arg">!done</span> <span class="msg-arg">!all</span></div>`,
            false,
          );
        else if (c === "done")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">done</span> ID<br>Completes a task. If recurring, creates the next instance.</div>`,
            false,
          );
        else if (c === "skip")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">skip</span> ID<br>Skip a recurring task. Marks as skipped and creates next instance.</div>`,
            false,
          );
        else if (c === "delete")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">delete</span> ID<br>Permanently removes a task.</div>`,
            false,
          );
        else if (c === "annotate")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">annotate</span> ID <span class="msg-arg">note text...</span><br>Adds a timestamped note. Use <span class="msg-arg">-N</span> to remove by index (see info).</div>`,
            false,
          );
        else if (c === "undo")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">undo</span><br>Reverts the last task operation. Not persisted across page reloads.</div>`,
            false,
          );
        else if (c === "info")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">info</span> ID<br>Shows full task details including annotations and UUID.<br><span class="msg-hl">info</span> <span class="msg-arg">pro:Name</span> — show project details (icon, tags).</div>`,
            false,
          );
        else if (c === "edit" || c === "ed")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">edit</span> ID (alias: <span class="msg-hl">ed</span>)<br>Populates the input with a <span class="msg-hl">mod</span> command containing all task properties for quick editing.</div>`,
            false,
          );
        else if (["chain", "tree", "dependencies", "deps"].includes(c))
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">chain</span> ID (aliases: <span class="msg-hl">tree</span>, <span class="msg-hl">deps</span>)<br>Visualizes dependency tree for the specified task.</div>`,
            false,
          );
        else if (c === "projects" || c === "proj")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">projects</span><br>Lists all projects with task counts and tags.<br>Toggle tags: <span class="msg-arg">mod pro:Name !reference</span> (use again to remove)<br>Projects with <span class="msg-arg">!reference</span> tag are hidden from next.</div>`,
            false,
          );
        else if (c === "export")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">export</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span><br>Exports tasks as JSON. Supports same filters as list.</div>`,
            false,
          );
        else if (c === "context" || c === "ctx" || c === "c")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">context</span> <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">search</span><br>Set persistent filter context. Filters auto-apply to list/next, attributes inherit to add.<br><span class="msg-hl">context</span> (no args) clears context.</div>`,
            false,
          );
        else if (c === "calendar" || c === "cal")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">cal</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">!tag</span> <span class="msg-arg">lim:N</span><br>Agenda view of dated tasks. Shows <span class="msg-arg">[due]</span> <span class="msg-arg">[sched]</span> <span class="msg-arg">[wait]</span> dates.<br>Includes overdue from past 7 days. <span class="msg-arg">!done</span> shows completed by end date.</div>`,
            false,
          );
        else if (c === "link")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">link</span><br>Link a JSON file for sync (desktop Chrome). Use <span class="msg-arg">load</span> to import, <span class="msg-arg">save</span> to export.</div>`,
            false,
          );
        else if (c === "load")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">load</span><br>Import tasks from linked file. Tasks matched by UUID.</div>`,
            false,
          );
        else if (c === "save")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">save</span><br>Export all tasks to linked file (overwrites).</div>`,
            false,
          );
        else if (c === "unlink")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">unlink</span><br>Remove linked file association.</div>`,
            false,
          );
        else if (c === "report" || c === "rep")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">report</span> <span class="msg-arg">stale</span> | <span class="msg-arg">rot [N]</span> | <span class="msg-arg">done [period] [by:project|tag]</span> | <span class="msg-arg">cfd [pro:X] [period] [by:project|tag]</span> | <span class="msg-arg">cycle [pro:X] [period] [by:project|tag]</span> | <span class="msg-arg">forecast</span> | <span class="msg-arg">churn [period]</span> | <span class="msg-arg">audit [period]</span><br><span class="msg-arg">stale</span> — projects by staleness (days since activity)<br><span class="msg-arg">rot [N]</span> — oldest N pending tasks (default 10)<br><span class="msg-arg">done [1w] [by:tag]</span> — completed tasks grouped by project or tag<br><span class="msg-arg">cfd</span> — cumulative flow diagram (done vs pending over time)<br><span class="msg-arg">cycle</span> — cycle time distribution (latency from entry to done)<br><span class="msg-arg">forecast</span> — backlog completion prediction based on velocity<br><span class="msg-arg">churn [1w]</span> — project context switching metric<br><span class="msg-arg">audit [4w]</span> — recurring task skip rate analysis</div>`,
            false,
          );
        else if (c === "copy" || c === "cp")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">copy</span> (alias <span class="msg-hl">cp</span>)<br>Copies the currently displayed task list to clipboard (description, project, tags).</div>`,
            false,
          );
        else if (c === "paste")
          print(
            `<div class="msg-help msg-standalone"><span class="msg-hl">paste</span><br>Imports tasks from clipboard. Expects one task per line (same format as add command).</div>`,
            false,
          );
        else
          print(
            `<span class="msg-error">No specific help for: ${sub}</span>`,
            false,
          );
      }
    } else if (cmd === "copy" || cmd === "cp") {
      // Check if copying an icon from icon search results
      if (
        args.length === 1 &&
        /^\d+$/.test(args[0]) &&
        iconResultsRef.value.length > 0
      ) {
        const idx = parseInt(args[0]) - 1;
        if (idx >= 0 && idx < iconResultsRef.value.length) {
          const iconName = iconResultsRef.value[idx];
          try {
            await navigator.clipboard.writeText(iconName);
            print(
              `<span class="msg-success">Copied icon name: ${iconName}</span>`,
            );
            lastCommandWasPassthrough = true;
          } catch (err) {
            print(
              `<span class="msg-error">Failed to copy: ${err.message}</span>`,
            );
          }
          return;
        }
      }
      const all = await dbOps.getAll();
      const output = [];
      for (const uuid of displayMapRef.value) {
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
                const idx = displayMapRef.value.indexOf(depUuid);
                return idx >= 0 ? idx + 1 : null;
              })
              .filter((id) => id !== null);
            if (depIds.length > 0) parts.push(`dep:${depIds.join(",")}`);
          }
          output.push(parts.join(" "));
        }
      }

      if (output.length === 0) {
        print('<span class="msg-info">Nothing to copy.</span>');
      } else {
        const text = output.join("\n");
        if (isIOS) {
          const btnId = "ios-copy-btn-" + Date.now();
          print(
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
                  print(
                    `<span class="msg-success">Copied ${output.length} tasks to clipboard.</span>`,
                  );
                })
                .catch((err) => {
                  btn.textContent = "Error";
                  btn.style.background = "var(--red)";
                  print(
                    `<span class="msg-error">Failed to copy: ${err.message}</span>`,
                  );
                });
            };
          }
        } else {
          try {
            await navigator.clipboard.writeText(text);
            print(
              `<span class="msg-success">Copied ${output.length} tasks to clipboard.</span>`,
            );
          } catch (err) {
            print(
              `<span class="msg-error">Failed to copy: ${err.message}</span>`,
            );
          }
        }
      }
    } else if (cmd === "paste") {
      const processPaste = async (text) => {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          print('<span class="msg-info">Clipboard is empty.</span>');
        } else {
          let count = 0;
          for (const line of lines) {
            let parts = line.trim().split(/\s+/);
            if (parts.length === 0) continue;
            parts = normalizeArgs(parts);
            const tObj = createTaskObject(parts);
            if (tObj.desc.length === 0) continue;

            const inherited = getInheritedAttributes();
            let proj = tObj.proj;
            let tags = tObj.tags;
            if (!proj && inherited.project) proj = inherited.project;
            if (tags.length === 0 && inherited.tags) tags = [...inherited.tags];

            await dbOps.add({
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
          print(
            `<span class="msg-success">Imported ${count} tasks from clipboard.</span>`,
          );
          await runList(lastFilterArgs, lastLimit);
        }
      };

      if (isIOS) {
        const btnId = "ios-paste-btn-" + Date.now();
        print(
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
              print(
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
          print(
            `<span class="msg-error">Failed to read clipboard: ${err.message}. ensure you grant permission.</span>`,
          );
        }
      }
    } else if (cmd === "about") {
      let version = "unknown";
      try {
        const res = await fetch("manifest.json");
        const manifest = await res.json();
        version = manifest.version || "unknown";
      } catch (e) {}
      const lastSave = await dbOps.getSetting("lastSave");
      let lastSaveStr = "never";
      if (lastSave) {
        const d = new Date(lastSave);
        lastSaveStr = d.toLocaleString();
      }
      print(
        `<div style="color:var(--base1)">Tasca v${version}<br>PWA task manager inspired by Taskwarrior.<br>Ruben Berenguel, 2025 with the help of Claude and Gemini.<br><br>Last save: ${lastSaveStr}</div>`,
      );
    } else if (["projects", "proj"].includes(cmd)) {
      await handleProjects(print);
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
          const tasks = Array.isArray(data) ? data : data.tasks || [];
          const projects = Array.isArray(data) ? [] : data.projects || [];
          const savedAt = Array.isArray(data) ? null : data.savedAt || null;
          for (const t of tasks) {
            if (t.uuid) {
              await dbOps.update(t, { touch: false });
              imported++;
            }
          }
          for (const p of projects) {
            if (p.name) {
              await dbOps.updateProject(p, { touch: false });
              importedProjects++;
            }
          }
          if (savedAt) {
            await dbOps.setSetting("lastSave", savedAt);
          }
        }
        const projMsg = importedProjects
          ? ` and ${importedProjects} projects`
          : "";
        print(
          `<span class="msg-success">Loaded ${imported} tasks${projMsg} from ${handle.name}.</span>`,
        );
        markClean();
        if (imported > 0) {
          const all = await dbOps.getAll();
          updateCache(all);
          await execute("next");
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
        const saveData = { tasks: all, projects, savedAt: Date.now() };
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(saveData, null, 2));
        await writable.close();
        print(
          `<div class="msg-standalone"><span class="msg-success">Saved ${all.length} tasks to ${handle.name}.</span></div>`,
          false,
        );
        markClean();
        await dbOps.setSetting("lastSave", Date.now());
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
      await handleCalendar(args, print);
    } else if (cmd === "report" || cmd === "rep") {
      const subCmd = args[0]?.toLowerCase();
      const subArgs = args.slice(1);
      const projects = await dbOps.getAllProjects();
      await handleReport(subCmd, subArgs, print, dbOps, projects);
    } else if (cmd === "icon") {
      if (args.length === 0) {
        return print(
          '<span class="msg-info">Usage: icon TERM — search for icon names by keyword. Use copy N to copy icon name.</span>',
        );
      }
      const query = args.join(" ");
      const results = query.includes(" ")
        ? searchIconsMulti(query)
        : searchIcons(query);
      if (results.length === 0) {
        iconResultsRef.value = [];
        print(`<span class="msg-info">No icons found for "${query}"</span>`);
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
        print(html, false);
      }
    } else print(`<span class="msg-error">Unknown: ${cmd}</span>`);
  } catch (err) {
    console.error(err);
    print(`<span class="msg-error">Error: ${err.message}</span>`);
  }
};
