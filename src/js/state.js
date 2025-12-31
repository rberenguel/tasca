// Shared application state

// Display map - reference wrapper pattern for sharing mutable state
export let displayMap = [];
export const displayMapRef = { value: displayMap };

// Autocomplete caches
export const knownProjects = new Set();
export const knownTags = new Set();
export const knownIcons = new Set();

// Persist last filter for reapplication after operations
export let lastFilterArgs = [];
export let lastLimit = Infinity;
export const setLastFilterArgs = (args) => {
  lastFilterArgs = args;
};
export const setLastLimit = (limit) => {
  lastLimit = limit;
};

// Command history
export const historyState = {
  cmdHistory: JSON.parse(localStorage.getItem("tasca_history") || "[]"),
  historyIndex: -1,
  historyTemp: "",
};

// Update autocomplete caches from tasks
export const updateCache = (tasks) => {
  knownProjects.clear();
  knownTags.clear();
  tasks.forEach((t) => {
    if (t.project) knownProjects.add(t.project);
    if (t.tags) t.tags.forEach((tag) => knownTags.add(tag));
  });
};

// Fetch available icons from CSS
export const fetchIcons = async () => {
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
