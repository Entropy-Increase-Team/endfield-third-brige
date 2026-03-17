(function () {
  var BRIDGE_PING_EVENT = "ENDFIELD_THIRD_BRIDGE_PING";
  var BRIDGE_PONG_EVENT = "ENDFIELD_THIRD_BRIDGE_PONG";

  function createCustomEvent(name, detail) {
    if (typeof window.CustomEvent === "function") {
      return new CustomEvent(name, { detail: detail });
    }

    var event = document.createEvent("CustomEvent");
    event.initCustomEvent(name, false, false, detail);
    return event;
  }

  function replyInstalled() {
    try {
      window.dispatchEvent(
        createCustomEvent(BRIDGE_PONG_EVENT, {
          source: "endfield-third-bridge",
          installed: true,
          ts: Date.now()
        })
      );
    } catch (err) {
      // no-op: avoid breaking page when event dispatch fails
    }
  }

  function handlePing() {
    replyInstalled();
  }

  window.addEventListener(BRIDGE_PING_EVENT, handlePing, false);

  // Delay initial pong to ensure page listeners are ready.
  setTimeout(replyInstalled, 0);
})();
