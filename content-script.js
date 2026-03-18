(function () {
  var BRIDGE_MESSAGE_SOURCE_WEB = "endfield-web";
  var BRIDGE_MESSAGE_SOURCE_EXTENSION = "endfield-third-bridge";
  var BRIDGE_MESSAGE_TARGET_EXTENSION = "endfield-third-bridge";
  var BRIDGE_MESSAGE_TARGET_WEB = "endfield-web";
  var BRIDGE_MESSAGE_TYPE_PING = "ENDFIELD_THIRD_BRIDGE_PING";
  var BRIDGE_MESSAGE_TYPE_PONG = "ENDFIELD_THIRD_BRIDGE_PONG";

  function replyInstalled() {
    try {
      window.postMessage(
        {
          source: BRIDGE_MESSAGE_SOURCE_EXTENSION,
          target: BRIDGE_MESSAGE_TARGET_WEB,
          type: BRIDGE_MESSAGE_TYPE_PONG,
          installed: true,
          ts: Date.now()
        },
        "*"
      );
    } catch (err) {
      // no-op
    }
  }

  function handleMessage(event) {
    try {
      if (!event || event.source !== window) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.source !== BRIDGE_MESSAGE_SOURCE_WEB) return;
      if (data.target !== BRIDGE_MESSAGE_TARGET_EXTENSION) return;
      if (data.type !== BRIDGE_MESSAGE_TYPE_PING) return;
      replyInstalled();
    } catch (err) {
      // no-op
    }
  }

  window.addEventListener("message", handleMessage, false);

  // initial announce in case page listener is already ready
  setTimeout(replyInstalled, 0);
})();
