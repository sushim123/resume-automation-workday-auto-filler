chrome.runtime.onInstalled.addListener(() => {
  console.log('[Workday AI Auto-Filler] Background Service Worker installed.');
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (err) {
      console.warn('[Workday AI] Side panel open error:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_SIDEBAR') {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const windowId = sender.tab?.windowId;
      if (windowId) {
        chrome.sidePanel.open({ windowId }).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
      } else {
        chrome.windows.getCurrent((w) => {
          if (w?.id) {
            chrome.sidePanel.open({ windowId: w.id }).then(() => {
              sendResponse({ success: true });
            }).catch((err) => {
              sendResponse({ success: false, error: String(err) });
            });
          }
        });
      }
    } else {
      sendResponse({ success: false, error: 'Side panel API not available' });
    }
    return true;
  }

  if (message.type === 'PING_SERVER') {
    fetch( "https://resume-automation-workday-auto-fill.vercel.app/api/health")
      .then((res) => res.json())
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
