const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";
const POCKET_URLS = [
  "https://pocketoption.com/*",
  "https://*.pocketoption.com/*",
  "https://*.po.market/*"
];

function sendToAnalyzers(message) {
  chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

function reportStatus(status, details = {}) {
  sendToAnalyzers({
    type: "POCKET_ANALYZER_HISTORY_STATUS",
    status,
    details
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST" && message.request) {
    chrome.tabs.query({ url: POCKET_URLS }, tabs => {
      const candidates = tabs
        .filter(tab => tab.id != null && tab.id !== sender.tab?.id)
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

      if (!candidates.length) {
        reportStatus("pocket-tab-not-found");
        return;
      }

      const target = candidates[0];
      chrome.tabs.sendMessage(target.id, {
        type: "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE",
        request: message.request
      }).catch(() => {
        reportStatus("pocket-tab-bridge-unavailable");
      });
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
    reportStatus(message.status, message.details || {});
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
    sendToAnalyzers({
      type: "POCKET_ANALYZER_HISTORY",
      history: message.history,
      symbol: message.symbol,
      period: message.period
    });
  }
});