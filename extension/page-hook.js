(() => {
  if (window.__pocketAnalyzerHistoryExperimentInstalled) return;
  window.__pocketAnalyzerHistoryExperimentInstalled = true;

  const marker = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const NativeWebSocket = window.WebSocket;
  let activeSocket = null;

  function post(kind, extra = {}) {
    window.postMessage({ source: marker, kind, ...extra }, "*");
  }

  function publishQuotes(value) {
    const visit = item => {
      if (!Array.isArray(item)) return;
      if (
        item.length >= 3 &&
        typeof item[0] === "string" &&
        typeof item[1] === "number" &&
        typeof item[2] === "number"
      ) {
        post("quote", { quote: [item[0], item[1], item[2]] });
        return;
      }
      for (const child of item) visit(child);
    };
    visit(value);
  }

  function handlePacket(packet, socket) {
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const eventName = packet[0];
    const payload = packet[1];

    if (eventName === "updateStream") {
      activeSocket = socket;
      return;
    }

    if (eventName === "loadHistoryPeriod" || eventName === "loadHistoryPeriodFast") {
      if (payload && typeof payload === "object") {
        post("history", { history: payload });
      }
      return;
    }

    if (eventName === "updateHistoryNew" || eventName === "updateHistoryNewFast") {
      if (payload && typeof payload === "object") {
        post("history", { history: payload });
      }
    }
  }

  async function inspect(data, socket) {
    try {
      if (typeof data === "string") {
        if (!data.startsWith("42")) return;
        handlePacket(JSON.parse(data.slice(2)), socket);
        return;
      }

      let buffer;
      if (data instanceof Blob) buffer = await data.arrayBuffer();
      else if (data instanceof ArrayBuffer) buffer = data;
      else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else return;

      const decoded = new TextDecoder().decode(buffer);
      if (!decoded.startsWith("42")) return;
      handlePacket(JSON.parse(decoded.slice(2)), socket);
    } catch (_) {
      // Ignore non-JSON and unrelated Socket.IO frames.
    }
  }

  function sendHistoryRequest(request) {
    if (!request || typeof request.symbol !== "string") return;
    const period = Number(request.period);
    const count = Number(request.count);
    const stamp = Number(request.stamp);
    if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(count) || count <= 0) return;

    if (!activeSocket || activeSocket.readyState !== NativeWebSocket.OPEN) {
      post("bridge-status", { status: "history-socket-unavailable" });
      return;
    }

    const payload = {
      asset: request.symbol,
      index: Math.floor(Date.now() / 10),
      offset: Math.min(Math.max(Math.floor(count), 1), 2000),
      period,
      time: Number.isFinite(stamp) && stamp > 0 ? Math.floor(stamp) : Math.floor(Date.now() / 1000)
    };

    try {
      activeSocket.send("42" + JSON.stringify(["loadHistoryPeriod", payload]));
      post("bridge-status", { status: "history-request-sent" });
    } catch (_) {
      post("bridge-status", { status: "history-send-failed" });
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== marker) return;
    if (event.data.kind === "history-request" && event.data.request) {
      sendHistoryRequest(event.data.request);
    }
  });

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      ws.addEventListener("message", event => { void inspect(event.data, ws); });
      ws.addEventListener("close", () => {
        if (activeSocket === ws) activeSocket = null;
      });
      return ws;
    }
  });

  post("bridge-status", { status: "history-hook-installed" });
})();