(() => {
  if (window.__pocketAnalyzerHookInstalled) return;
  window.__pocketAnalyzerHookInstalled = true;

  const marker = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const NativeWebSocket = window.WebSocket;
  const supportedSymbols = new Set(["EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDCAD_otc", "EURGBP_otc"]);
  const minQuoteTimestamp = Date.UTC(2000, 0, 1) / 1000;

  function publish(value) {
    const visit = (item) => {
      if (!Array.isArray(item)) return;
      if (
        item.length >= 3 &&
        typeof item[0] === "string" &&
        supportedSymbols.has(item[0]) &&
        typeof item[1] === "number" &&
        Number.isFinite(item[1]) &&
        typeof item[2] === "number" &&
        Number.isFinite(item[2]) &&
        item[2] > 0
      ) {
        let stamp = item[1];
        if (stamp > 1e12) stamp /= 1000;
        if (stamp >= minQuoteTimestamp && stamp <= Date.now() / 1000 + 3600) {
          window.postMessage({
            source: marker,
            kind: "quote",
            quote: [item[0], stamp, item[2]]
          }, "*");
        }
        return;
      }
      for (const child of item) visit(child);
    };
    visit(value);
  }

  async function inspect(data) {
    try {
      if (typeof data === "string") {
        if (!data.startsWith("42")) return;
        const packet = JSON.parse(data.slice(2));
        if (Array.isArray(packet) && packet[0] === "updateStream") publish(packet[1]);
        return;
      }
      let buffer;
      if (data instanceof Blob) buffer = await data.arrayBuffer();
      else if (data instanceof ArrayBuffer) buffer = data;
      else if (ArrayBuffer.isView(data)) buffer = data.buffer;
      else return;
      const decoded = new TextDecoder().decode(buffer);
      publish(JSON.parse(decoded));
    } catch (_) {
      // Прочие сообщения протокола не являются котировками.
    }
  }

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      ws.addEventListener("message", event => { void inspect(event.data); });
      return ws;
    }
  });

  window.postMessage({ source: marker, kind: "bridge-ready" }, "*");
})();