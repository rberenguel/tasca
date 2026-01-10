// Command execution entry point
// Uses command registry pattern to dispatch to handlers

import { dbOps } from "./db.js";
import { resolveCommand, VALID_COMMANDS } from "./logic.js";
import { print } from "./ui.js";
import { runList } from "./list.js";
import {
  displayMapRef,
  lastFilterArgs,
  lastLimit,
  markDirty,
  updateCache,
} from "./state.js";
import {
  commands,
  projectCommands,
  isProjectCommand,
} from "./commands-registry.js";

// Merge tokens like "pro:" + "value" into "pro:value"
const normalizeArgs = (parts) => {
  const result = [];
  const colonPrefixes =
    /^(p|pro|proj|project|pri|priority|due|wait|sched|scheduled|recur|url|icon|dep|sort|lim|l|end|o|ord|order):$/i;
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

let lastCommandWasPassthrough = false;

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
    // Match single ID or multi-ID patterns (1, 1,3, 1-3, 1,3-5)
    const idPattern = /^[\d,\-]+$/;
    const isIdPattern = idPattern.test(rawCmd) && /\d/.test(rawCmd);
    let targetId = isIdPattern ? rawCmd : null;

    // Handle ID(s) COMMAND syntax (e.g., "1 done", "1,3 done", "1-3 done")
    if (targetId && args[0]) {
      const resolved =
        resolveCommand(args[0]) ||
        (VALID_COMMANDS.includes(args[0]) ? args[0] : null);
      if (resolved) {
        cmd = resolved;
        args = args.slice(1);
      }
    }
    // Single number without command defaults to info
    if (!cmd && rawCmd.match(/^\d+$/)) {
      cmd = "info";
    }
    if (!cmd) cmd = rawCmd;

    // Track passthrough commands (don't refresh list on empty enter)
    lastCommandWasPassthrough = [
      "help",
      "icon",
      "save",
      "export",
      "exp",
      "status",
      "calendar",
      "cal",
    ].includes(cmd);

    // Build context object for handlers
    const ctx = {
      args,
      targetId,
      print,
      dbOps,
      displayMapRef,
      lastFilterArgs,
      lastLimit,
      markDirty,
      runListRefresh: () => runList(lastFilterArgs, lastLimit),
      execute,
      setPassthrough: (val) => {
        lastCommandWasPassthrough = val;
      },
    };

    // Handle special 42clear command
    if (rawCmd === "42clear") {
      await dbOps.purgeAll();
      await dbOps.deleteSetting("lastSave");
      updateCache([]);
      document.getElementById("terminal-output").innerHTML = "";
      print(
        '<span class="msg-success">Database purged. Reload to start fresh.</span>',
      );
      return;
    }

    // Check if this is a project variant of a command
    if (projectCommands[cmd] && isProjectCommand(args)) {
      await projectCommands[cmd](ctx);
      return;
    }

    // Look up handler in registry
    const handler = commands[cmd];
    if (handler) {
      await handler(ctx);
    } else {
      print(`<span class="msg-error">Unknown: ${cmd}</span>`);
    }
  } catch (err) {
    console.error(err);
    print(`<span class="msg-error">Error: ${err.message}</span>`);
  }
};
