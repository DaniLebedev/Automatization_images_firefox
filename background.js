(function () {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const CVAT_PATTERN = /\/(tasks|jobs|task|job)\/\d+/i;
  const VERSION = "0.1.2";

  async function inject(tabId) {
    try {
      await api.tabs.executeScript(tabId, { file: "src/lib.js" });
      await api.tabs.executeScript(tabId, { file: "src/content.js" });
    } catch (_error) {
      // Tab may be a browser page or inaccessible; ignore.
    }
  }

  async function injectExistingTabs() {
    try {
      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && CVAT_PATTERN.test(tab.url)) {
          await inject(tab.id);
        }
      }
    } catch (_error) {
      // Ignore startup errors.
    }
  }

  api.runtime.onInstalled.addListener(() => {
    injectExistingTabs();
  });

  api.runtime.onStartup.addListener(() => {
    injectExistingTabs();
  });

  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) {
      return;
    }
    if (CVAT_PATTERN.test(tab.url)) {
      inject(tabId);
    }
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "food-outline:version") {
      sendResponse({ ok: true, version: VERSION });
    }
    return undefined;
  });

  injectExistingTabs();
})();
