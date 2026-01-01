import { initDB, dbOps } from "./db.js";
import { print } from "./ui.js";
import { fetchIcons, updateCache, lastFilterArgs } from "./state.js";
import { setupInput } from "./input.js";
import { execute } from "./commands.js";
import { runList } from "./list.js";

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
    const pendingTasks = tasks.filter(t => t.status === "pending");
    setupPlaceholderRotation(pendingTasks.length === 0);
    execute("next");
  } catch (e) {}
});
