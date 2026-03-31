/** Bridge SLOP postMessage traffic between the page and the background port. */
export function createBridgeController(port: chrome.runtime.Port) {
  let active = false;

  const windowListener = (event: MessageEvent) => {
    if (!active) return;
    if (event.source !== window) return;
    if (event.data?.slop !== true) return;
    port.postMessage({ type: "slop-from-provider", message: event.data.message });
  };

  const portListener = (msg: any) => {
    if (msg.type === "bridge-control") {
      setActive(!!msg.active);
      return;
    }

    if (msg.type === "slop-to-provider" && active) {
      window.postMessage({ slop: true, message: msg.message }, "*");
    }
  };

  port.onMessage.addListener(portListener);

  function setActive(nextActive: boolean): void {
    if (nextActive === active) return;
    active = nextActive;
    if (active) {
      window.addEventListener("message", windowListener);
    } else {
      window.removeEventListener("message", windowListener);
    }
  }

  function dispose(): void {
    setActive(false);
    port.onMessage.removeListener(portListener);
  }

  return {
    setActive,
    dispose,
  };
}
