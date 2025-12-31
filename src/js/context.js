// GTD Context feature - persisted filter state

const STORAGE_KEY = "tasca_context";

// Context structure: { raw, project, tags[], search[] }
let currentContext = null;

// Load from localStorage on module init
const stored = localStorage.getItem(STORAGE_KEY);
if (stored) {
  try {
    currentContext = JSON.parse(stored);
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// Parse context arguments into structured object
const parseContextArgs = (args) => {
  if (args.length === 0) return null;

  const ctx = { raw: args.join(" "), project: null, tags: [], search: [] };
  for (const token of args) {
    if (
      token.startsWith("pro:") ||
      token.startsWith("proj:") ||
      token.startsWith("project:")
    ) {
      ctx.project = token.split(":")[1];
    } else if (token.startsWith("!")) {
      ctx.tags.push(token.substring(1));
    } else {
      ctx.search.push(token.toLowerCase());
    }
  }
  return ctx;
};

// Set context (empty args clears it)
export const setContext = (args) => {
  if (args.length === 0) {
    currentContext = null;
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  currentContext = parseContextArgs(args);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentContext));
  return currentContext;
};

// Get current context
export const getContext = () => currentContext;

// Check if context is active
export const hasContext = () => currentContext !== null;

// Merge context filters with command filters
// User-specified filters override context (explicit wins)
export const mergeFilters = (cmdArgs) => {
  if (!currentContext) return cmdArgs;

  const merged = [...cmdArgs];

  // Add context project if not overridden by command
  if (
    currentContext.project &&
    !cmdArgs.some(
      (a) =>
        a.startsWith("pro:") ||
        a.startsWith("proj:") ||
        a.startsWith("project:"),
    )
  ) {
    merged.push(`pro:${currentContext.project}`);
  }

  // Add context tags if not already present
  for (const tag of currentContext.tags) {
    if (!cmdArgs.some((a) => a.toLowerCase() === `!${tag.toLowerCase()}`)) {
      merged.push(`!${tag}`);
    }
  }

  // Add context search terms
  for (const term of currentContext.search) {
    if (!cmdArgs.some((a) => a.toLowerCase() === term)) {
      merged.push(term);
    }
  }

  return merged;
};

// Get attributes to inherit for new tasks created in context
export const getInheritedAttributes = () => {
  if (!currentContext) return {};
  const attrs = {};
  if (currentContext.project) attrs.project = currentContext.project;
  if (currentContext.tags.length) attrs.tags = [...currentContext.tags];
  return attrs;
};

// Format context for display
export const formatContextDisplay = () => {
  if (!currentContext) return null;
  return currentContext.raw;
};
