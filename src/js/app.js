import { initDB, dbOps } from "./db.js";
import { print, setExecuteRef } from "./ui.js";
import { fetchIcons, updateCache, lastFilterArgs, markClean } from "./state.js";
import { setupInput } from "./input.js";
import { execute } from "./commands.js";
import { runList } from "./list.js";

// Set execute reference for dismissible UI elements
setExecuteRef(execute);

const emptyDbExamples = [
  "add Buy Milk p:home !errand",
  "add Conquer the galaxy p:world-domination pri:50",
  "add Feed the cat p:home icon:cat",
  "add Learn Klingon p:self-improvement !someday",
];

const examples = [
  "list p:work",
  "list !overdue",
  "list sort:alpha",
  "ctx p:home",
  "1 mod pri:50",
  "1 mod icon:star",
  "add Defeat nemesis p:world-domination pri:99",
  "add Calibrate the flux capacitor p:lab due:tomorrow",
  "add Tea, Earl Grey, hot p:replicator icon:coffee",
  "add Find the droids p:tatooine !urgent",
  "add Update Captain's log p:enterprise recur:1d",
  "add Towel p:travel pri:42 !no-panic",
  "add Avoid red shirts p:starfleet !survival",
  "add Plan heist p:schemes icon:lock wait:1w",
  "list !ref sort:pri",
  "add Organize sock drawer p:home pri:-10",
  "add Build death ray p:lab !someday icon:flash",
  "cal p:work",
  "projects",
  "chain 1",
];

let placeholderInterval = null;

const setupPlaceholderRotation = (isEmpty) => {
  const input = document.getElementById("cmd-input");
  const list = isEmpty ? emptyDbExamples : examples;
  let index = Math.floor(Math.random() * list.length);

  input.placeholder = list[index];

  if (placeholderInterval) clearInterval(placeholderInterval);
  placeholderInterval = setInterval(() => {
    index = (index + 1) % list.length;
    input.placeholder = list[index];
  }, 10000);
};

// Chrome extension: listen for "add from tab" messages (safe no-op in PWA mode)
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "prefill-add") {
      const input = document.getElementById("cmd-input");
      const title = message.title || "";
      const url = message.url || "";
      const icon = message.icon ? `icon:${message.icon} ` : "";
      const text = `add ${title} ${icon}url:${url}`;
      input.value = text;
      input.focus();
      // Position cursor between title and icon/url:
      const cursorPos = 4 + title.length;
      input.setSelectionRange(cursorPos, cursorPos);
    }
  });
}

initDB().then(async () => {
  // ── Sync helpers (used by native bridge and browser auto-sync) ───────────

  // Serialize full DB to the tasca.json wire format
  window.__tascaSerialize = async () => {
    await dbOps.cleanupOrphanProjects();
    return {
      tasks: await dbOps.getAll(),
      projects: await dbOps.getAllProjects(),
      savedAt: Date.now(),
    };
  };

  // Merge incoming data: newer modified timestamp wins per UUID.
  // touch:false means db.js won't fire __tascaScheduleSave, avoiding loops.
  window.__tascaImport = async (data) => {
    const incoming = Array.isArray(data) ? data : data.tasks || [];
    const incomingProjects = Array.isArray(data) ? [] : data.projects || [];
    const existing = await dbOps.getAll();
    const existingMap = new Map(existing.map((t) => [t.uuid, t]));
    for (const t of incoming) {
      if (!t.uuid) continue;
      const local = existingMap.get(t.uuid);
      if (!local || (t.modified || 0) >= (local.modified || 0)) {
        await dbOps.update(t, { touch: false });
      }
    }
    for (const p of incomingProjects) {
      if (p.name) await dbOps.updateProject(p, { touch: false });
    }
    if (data.savedAt) await dbOps.setSetting("lastSave", data.savedAt);
    markClean();
    const all = await dbOps.getAll();
    updateCache(all);
  };

  if (window.__TASCA_NATIVE__) {
    // Expose markClean so bridge.js can clear the unsaved dot after auto-save
    window.__tascaMarkClean = markClean;
    // Expose lastSave setter so bridge.js can update it after auto-save
    window.__tascaSetLastSave = (t) => dbOps.setSetting("lastSave", t);
    // Expose refresh so bridge.js can re-render after a foreground load
    window.__tascaRefresh = () => execute("next");
  } else {
    // ── Browser auto-sync via File System Access API ─────────────────────
    // Auto-save to linked file after any modification (debounced).
    // Only fires if write permission is already granted — no user gesture needed
    // if Chrome has persisted it from the previous link/save operation.
    let saveTimer = null;
    window.__tascaScheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const handle = await dbOps.getSetting("syncFileHandle");
        if (!handle) return;
        if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted")
          return;
        try {
          const data = await window.__tascaSerialize();
          const writable = await handle.createWritable();
          await writable.write(JSON.stringify(data, null, 2));
          await writable.close();
          markClean();
          await dbOps.setSetting("lastSave", data.savedAt);
        } catch (_) {}
      }, 1000);
    };

    // Auto-load when tab becomes visible (e.g. switched back after using extension)
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) return;
      const handle = await dbOps.getSetting("syncFileHandle");
      if (!handle) return;
      if ((await handle.queryPermission({ mode: "read" })) !== "granted")
        return;
      try {
        const text = await (await handle.getFile()).text();
        if (!text.trim()) return;
        await window.__tascaImport(JSON.parse(text));
        await execute("next");
      } catch (_) {}
    });
  }

  // Import file picker handler
  document.getElementById("import-picker").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Handle both old format (array) and new format (object with tasks/projects)
        const tasks = Array.isArray(data) ? data : data.tasks || [];
        const projects = Array.isArray(data) ? [] : data.projects || [];
        const savedAt = Array.isArray(data) ? null : data.savedAt || null;
        for (const t of tasks)
          if (t.uuid) await dbOps.update(t, { touch: false });
        for (const p of projects)
          if (p.name) await dbOps.updateProject(p, { touch: false });
        if (savedAt) await dbOps.setSetting("lastSave", savedAt);
        const projMsg = projects.length
          ? ` and ${projects.length} projects`
          : "";
        print(
          `<span class="msg-success">Imported ${tasks.length} tasks${projMsg}.</span>`,
        );
        markClean();
        await execute("next");
      } catch (err) {
        print(`<span class="msg-error">Error: ${err.message}</span>`);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // Set up input handling
  setupInput(execute);

  // Tap output area to toggle input focus (mobile UX)
  // Only trigger if no text is selected (to allow text selection)
  const terminalOutput = document.getElementById("terminal-output");
  const cmdInput = document.getElementById("cmd-input");
  terminalOutput.addEventListener("click", () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    if (document.activeElement === cmdInput) {
      cmdInput.blur();
    } else {
      cmdInput.focus();
    }
  });

  // Fire and forget icon fetch
  fetchIcons();

  // Initialize
  try {
    const tasks = await dbOps.getAll();
    updateCache(tasks);
    const pendingTasks = tasks.filter((t) => t.status === "pending");
    setupPlaceholderRotation(pendingTasks.length === 0);
    await execute("next");
  } catch (e) {}

  // ── Native bridge: signal ready ────────────────────────────────────────
  // Swift will call tascaLoad() in response. If it already called tascaLoad
  // before we were ready, __pendingLoad is waiting for us here.
  if (window.__TASCA_NATIVE__) {
    if (window.__pendingLoad) {
      await window.__tascaImport(window.__pendingLoad);
      window.__pendingLoad = null;
      await execute("next");
    }
    window.webkit?.messageHandlers?.ready?.postMessage(null);
  }
});
