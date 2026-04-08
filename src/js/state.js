// Shared application state

// Display map - reference wrapper pattern for sharing mutable state
export let displayMap = [];
export const displayMapRef = { value: displayMap };

// Last icon search results for copy command
export const iconResultsRef = { value: [] };

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

// Tasks with inline annotation expansion open (zip command)
export const zippedUuids = new Set();

// Unsaved changes tracking
export const unsavedState = {
  dirty: false,
};

export const markDirty = () => {
  unsavedState.dirty = true;
  const dot = document.getElementById("unsaved-dot");
  if (dot) dot.hidden = false;
};

export const markClean = () => {
  unsavedState.dirty = false;
  const dot = document.getElementById("unsaved-dot");
  if (dot) dot.hidden = true;
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
    const response = await fetch("fonts/phosphor/phosphor.css");
    const text = await response.text();
    const regex = /\.ph-light\.ph-([a-zA-Z0-9-]+):before/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      knownIcons.add(match[1]);
    }
  } catch (e) {
    console.error("Failed to load icons", e);
  }
};
