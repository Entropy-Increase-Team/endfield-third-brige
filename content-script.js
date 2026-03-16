(() => {
  const BRIDGE_PING_EVENT = "ENDFIELD_THIRD_BRIDGE_PING";
  const BRIDGE_PONG_EVENT = "ENDFIELD_THIRD_BRIDGE_PONG";

  const replyInstalled = () => {
    window.dispatchEvent(
      new CustomEvent(BRIDGE_PONG_EVENT, {
        detail: {
          source: "endfield-third-bridge",
          installed: true,
          ts: Date.now(),
        },
      })
    );
  };

  window.addEventListener(BRIDGE_PING_EVENT, replyInstalled);
  replyInstalled();
})();
