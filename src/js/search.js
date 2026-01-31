// Shared fuzzy search utilities using trigram matching
// Used by both list and ref commands

// Generate trigrams from text
// Pads with spaces at start/end to give weight to word boundaries
export const getTrigrams = (text) => {
  if (!text) return new Set();

  // Normalize: lowercase, keep alphanumeric and basic punctuation
  const normalized = text.toLowerCase().replace(/[^\w\s./-]/g, " ");

  // Pad with spaces to weight word boundaries
  const padded = " " + normalized + " ";

  const trigrams = new Set();
  for (let i = 0; i <= padded.length - 3; i++) {
    const trigram = padded.substring(i, i + 3);
    // Skip trigrams that are all whitespace
    if (trigram.trim().length > 0) {
      trigrams.add(trigram);
    }
  }

  return trigrams;
};

// Calculate score based on trigram overlap
export const calculateTrigramScore = (queryTrigrams, targetText, weight) => {
  if (!targetText) return 0;

  const targetTrigrams = getTrigrams(targetText);

  // Count intersection
  let matches = 0;
  for (const trigram of queryTrigrams) {
    if (targetTrigrams.has(trigram)) {
      matches++;
    }
  }

  return matches * weight;
};

// Fuzzy search tasks by description and annotations
// Returns tasks with scores, sorted by relevance
export const fuzzySearchTasks = (tasks, searchTerms) => {
  if (!searchTerms || searchTerms.length === 0) return tasks;

  const query = searchTerms.join(" ").trim();
  if (!query) return tasks;

  // For very short queries (< 3 chars), use simple substring matching
  if (query.length < 3) {
    const queryLower = query.toLowerCase();
    const matches = tasks.filter((t) => {
      if (t.description?.toLowerCase().includes(queryLower)) return true;
      if (
        t.annotations?.some((a) =>
          a.description?.toLowerCase().includes(queryLower),
        )
      )
        return true;
      if (t.url?.toLowerCase().includes(queryLower)) return true;
      return false;
    });

    // Sort by description match first, then by urgency
    matches.sort((a, b) => {
      const aDescMatch = a.description?.toLowerCase().includes(queryLower);
      const bDescMatch = b.description?.toLowerCase().includes(queryLower);
      if (aDescMatch && !bDescMatch) return -1;
      if (!aDescMatch && bDescMatch) return 1;
      // Fallback to urgency
      return parseFloat(b.urgency || 0) - parseFloat(a.urgency || 0);
    });

    return matches;
  }

  // Trigram-based fuzzy search for longer queries
  const queryTrigrams = getTrigrams(query);
  const queryLower = query.toLowerCase();

  // Score each task
  const scoredTasks = tasks
    .map((task) => {
      let score = 0;

      // Description: 10x weight
      score += calculateTrigramScore(queryTrigrams, task.description, 10);

      // Annotations: 5x weight (join all annotation descriptions)
      if (task.annotations && task.annotations.length > 0) {
        const annotationsText = task.annotations
          .map((a) => a.description || "")
          .join(" ");
        score += calculateTrigramScore(queryTrigrams, annotationsText, 5);
      }

      // URL: 2x weight
      score += calculateTrigramScore(queryTrigrams, task.url, 2);

      // Bonus for exact substring match in description
      if (task.description?.toLowerCase().includes(queryLower)) {
        score += 50;
      }

      return { task, score };
    })
    .filter((item) => item.score > 0);

  // Sort by score descending, then by urgency as tiebreaker
  scoredTasks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return parseFloat(b.task.urgency || 0) - parseFloat(a.task.urgency || 0);
  });

  return scoredTasks.map((item) => item.task);
};
