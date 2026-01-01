import { initDB, dbOps } from "./db.js";
import { print } from "./ui.js";
import { fetchIcons, updateCache, lastFilterArgs } from "./state.js";
import { setupInput } from "./input.js";
import { execute } from "./commands.js";
import { runList } from "./list.js";

initDB().then(async () => {
  // Import file picker handler
  document.getElementById("import-picker").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Handle both old format (array) and new format (object with tasks/projects)
        const tasks = Array.isArray(data) ? data : (data.tasks || []);
        const projects = Array.isArray(data) ? [] : (data.projects || []);
        for (const t of tasks) if (t.uuid) await dbOps.update(t);
        for (const p of projects) if (p.name) await dbOps.updateProject(p);
        const projMsg = projects.length ? ` and ${projects.length} projects` : "";
        print(`<span class="msg-success">Imported ${tasks.length} tasks${projMsg}.</span>`);
        runList(lastFilterArgs);
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

  // Initialize
  try {
    const tasks = await dbOps.getAll();
    updateCache(tasks);
    execute("next");
  } catch (e) {}
});
