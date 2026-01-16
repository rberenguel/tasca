// Domain -> icon mapping for quick add
// Add your own domains and Phosphor icon names here!
export const DOMAIN_ICONS = {
  "arxiv.org": "graduation-cap",
  "github.com": "github-logo",
  "stackoverflow.com": "stack-overflow-logo",
  "youtube.com": "youtube-logo",
  "reddit.com": "reddit-logo",
  "twitter.com": "x-logo",
  "x.com": "x-logo",
  "linkedin.com": "linkedin-logo",
  "docs.google.com": "file-doc",
  "sheets.google.com": "table",
  "drive.google.com": "google-drive-logo",
  "notion.so": "notion-logo",
  "figma.com": "figma-logo",
  "slack.com": "slack-logo",
  "discord.com": "discord-logo",
  "amazon.com": "amazon-logo",
  "wikipedia.org": "article",
};

// Domain -> title transform functions
// Each function takes a title string and returns the cleaned version
export const TITLE_TRANSFORMS = {
  "docs.google.com": (title) => title.replace(/ - Google Docs$/, ""),
  "sheets.google.com": (title) => title.replace(/ - Google Sheets$/, ""),
  "drive.google.com": (title) => title.replace(/ - Google Drive$/, ""),
  "github.com": (title) => title.replace(/ · GitHub$/, ""),
  "youtube.com": (title) => title.replace(/ - YouTube$/, ""),
  "notion.so": (title) => title.replace(/ – .*$/, ""), // Removes " – Workspace Name"
  "figma.com": (title) => title.replace(/ – Figma$/, ""),
  "slack.com": (title) => title.replace(/ \| Slack$/, ""),
  "wikipedia.org": (title) => title.replace(/ - Wikipedia$/, ""),
};
