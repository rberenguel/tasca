chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("index.html");
  const tabs = await chrome.tabs.query({ url });

  if (tabs.length > 0) {
    // Focus existing tab
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url });
  }
});
