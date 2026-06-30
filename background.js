chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Error setting panel behavior:", error));
});

// Listener for background-scripting messages if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NAVIGATE_TAB") {
    chrome.tabs.update(message.tabId, { url: message.url }, (tab) => {
      sendResponse({ status: "success", tabId: tab.id });
    });
    return true; // Keep channel open for async response
  }
  
  if (message.type === "CREATE_TAB_GROUP") {
    chrome.tabs.group({ tabIds: message.tabIds }, (groupId) => {
      if (message.title) {
        chrome.tabGroups.update(groupId, { title: message.title, color: message.color || "grey" }, () => {
          sendResponse({ status: "success", groupId });
        });
      } else {
        sendResponse({ status: "success", groupId });
      }
    });
    return true;
  }
  
  if (message.type === "CAPTURE_VISIBLE_TAB") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      sendResponse({ dataUrl });
    });
    return true;
  }
});
