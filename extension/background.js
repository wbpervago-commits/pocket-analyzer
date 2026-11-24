const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";
const POCKET_URLS = [
  "https://pocketoption.com/*",
  "https://*.pocketoption.com/*",
  "https://*.po.market/*"
];

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "POCKET_ANALYZER_QUOTE" && Array.isArray(message.quote)) {
    const [symbol, timestamp, price] = message.quote;
    if (
      typeof symbol !== "string" ||
      typeof timestamp !== "number" ||
      typeof price !== "number" ||
      !Number.isFinite(timestamp) ||
      !Number.isFinite(price)
    ) return;

    chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_QUOTE",
          quote: [symbol, timestamp, price]
        }).catch(() => {});
      }
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST" && message.request) {
    chrome.tabs.query({ url: POCKET_URLS }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null || tab.id === sender.tab?.id) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE",
          request: message.request
        }).catch(() => {});
      }
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
    chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_HISTORY",
          history: message.history
        }).catch(() => {});
      }
    });
  }
});