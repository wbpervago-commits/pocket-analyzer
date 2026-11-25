(() => {
  if (window.__pocketAnalyzerHookInstalled) return;
  window.__pocketAnalyzerHookInstalled = true;

  const marker = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const NativeWebSocket = window.WebSocket;

  function publish(value) {
    const visit = (item) => {
      if (!Array.isArray(item)) return;
      if (
        item.length >= 3 &&
        typeof item[0] === "string" &&
        typeof item[1] === "number" &&
        typeof item[2] === "number"
      ) {
        window.postMessage({
          source: marker,
          kind: "quote",
          quote: [item[0], item[1], item[2]]
        }, "*");
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