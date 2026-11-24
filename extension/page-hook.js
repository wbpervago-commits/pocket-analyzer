(() => {
  if (window.__pocketAnalyzerHookInstalled) return;
  window.__pocketAnalyzerHookInstalled = true;

  const marker = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const NativeWebSocket = window.WebSocket;
  const sockets = new Set();
  const pendingBinary = new WeakMap();
  let latestSocket = null;
  let latestTimestamp = Math.floor(Date.now() / 1000);

  const allowedPairs = new Set([
    "EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDCAD_otc", "EURGBP_otc"
  ]);

  function publishTicks(value) {
    const visit = item => {
      if (!Array.isArray(item)) return;
      if (item.length >= 3 && typeof item[0] === "string" &&
          typeof item[1] === "number" && typeof item[2] === "number") {
        latestTimestamp = item[1];
        window.postMessage({
          source: marker, kind: "quote",
          quote: [item[0], item[1], item[2]]
        }, "*");
        return;
      }
      for (const child of item) visit(child);
    };
    visit(value);
  }

  function publishHistory(eventName, payload) {
    if (eventName !== "loadHistoryPeriodFast" &&
        eventName !== "loadHistoryPeriod") return;
    if (!payload || typeof payload !== "object") return;
    const data = payload.data || payload.candles || payload.history;
    if (!Array.isArray(data)) return;
    window.postMessage({
      source: marker, kind: "history",
      history: payload
    }, "*");
  }

  async function inspect(data, ws) {
    try {
      if (typeof data === "string") {
        if (data.startsWith("451-")) {
          const packet = JSON.parse(data.slice(4));
          if (Array.isArray(packet) && typeof packet[0] === "string") {
            pendingBinary.set(ws, packet[0]);
          }
          return;
        }
        if (!data.startsWith("42")) return;
        const packet = JSON.parse(data.slice(2));
        if (!Array.isArray(packet)) return;
        if (packet[0] === "updateStream") publishTicks(packet[1]);
        else publishHistory(packet[0], packet[1]);
        return;
      }

      let buffer;
      if (data instanceof Blob) buffer = await data.arrayBuffer();
      else if (data instanceof ArrayBuffer) buffer = data;
      else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else return;

      const decoded = new TextDecoder().decode(buffer);
      const payload = JSON.parse(decoded);
      const eventName = pendingBinary.get(ws);
      pendingBinary.delete(ws);
      if (eventName) publishHistory(eventName, payload);
      else publishTicks(payload);
    } catch (_) {
      // Игнорируем служебные и неизвестные сообщения протокола.
    }
  }

  function requestHistory(request) {
    if (!request || !allowedPairs.has(request.symbol)) return;
    const period = Number(request.period);
    if (![60, 120, 300, 900].includes(period)) return;
    const count = Math.min(2000, Math.max(1, Number(request.count) || Math.ceil(86400 / period)));
    const ws = latestSocket;
    if (!ws || ws.readyState !== NativeWebSocket.OPEN) {
      window.postMessage({ source: marker, kind: "history-status", status: "socket-not-ready" }, "*");
      return;
    }

    const endTime = Math.floor(latestTimestamp / period) * period;
    const requestData = {
      asset: request.symbol,
      index: Math.floor(Date.now() * 100),
      offset: count,
      period,
      time: endTime
    };
    try {
      ws.send("42" + JSON.stringify(["loadHistoryPeriod", requestData]));
      window.postMessage({
        source: marker, kind: "history-status",
        status: "requested", symbol: request.symbol, period, count
      }, "*");
    } catch (_) {
      window.postMessage({ source: marker, kind: "history-status", status: "send-failed" }, "*");
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== marker ||
        event.data.kind !== "history-request") return;
    requestHistory(event.data);
  });

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      sockets.add(ws);
      latestSocket = ws;
      ws.addEventListener("open", () => { latestSocket = ws; });
      ws.addEventListener("close", () => {
        sockets.delete(ws);
        if (latestSocket === ws) latestSocket = [...sockets].at(-1) || null;
      });
      ws.addEventListener("message", event => { void inspect(event.data, ws); });
      return ws;
    }
  });

  window.postMessage({ source: marker, kind: "bridge-ready" }, "*");
})();