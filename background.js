import { DOMAIN_ICONS, TITLE_TRANSFORMS } from "./auto-icons.js";

// Get icon for a URL's domain (checks base domain too)
function getIconForUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    // Check exact match first, then base domain (e.g., en.wikipedia.org -> wikipedia.org)
    if (DOMAIN_ICONS[hostname]) return DOMAIN_ICONS[hostname];
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const baseDomain = parts.slice(-2).join(".");
      if (DOMAIN_ICONS[baseDomain]) return DOMAIN_ICONS[baseDomain];
    }
  } catch {}
  return null;
}

// Transform title based on domain (removes cruft like " - Google Docs")
function transformTitle(url, title) {
  try {
    const hostname = new URL(url).hostname;
    // Check exact match first, then base domain
    if (TITLE_TRANSFORMS[hostname]) return TITLE_TRANSFORMS[hostname](title);
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const baseDomain = parts.slice(-2).join(".");
      if (TITLE_TRANSFORMS[baseDomain])
        return TITLE_TRANSFORMS[baseDomain](title);
    }
  } catch {}
  return title;
}

// Helper to find or open Tasca tab
async function openTascaTab() {
  const url = chrome.runtime.getURL("index.html");
  const tabs = await chrome.tabs.query({ url });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return tabs[0];
  } else {
    return await chrome.tabs.create({ url });
  }
}

// Click or Ctrl+T: just open Tasca
chrome.action.onClicked.addListener(openTascaTab);

// Ctrl+Shift+T: capture current tab, then open Tasca with pre-filled add command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "add-from-tab") {
    // Get current tab info BEFORE switching
    const [currentTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!currentTab || currentTab.url.startsWith("chrome://")) return;

    const pageUrl = currentTab.url || "";
    const rawTitle = currentTab.title || "";
    const title = transformTitle(pageUrl, rawTitle);
    const icon = getIconForUrl(pageUrl);

    // Open/focus Tasca tab
    const tascaTab = await openTascaTab();

    // Send message to pre-fill input (with small delay to ensure page is ready)
    setTimeout(() => {
      chrome.tabs.sendMessage(tascaTab.id, {
        type: "prefill-add",
        title,
        url: pageUrl,
        icon,
      });
    }, 100);
  }
});
