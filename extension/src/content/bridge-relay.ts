/**
 * Bridge SLOP postMessage traffic between the page and the background port.
 *
 * Uses "slop-from-provider" / "slop-to-provider" on the port to match the
 * PostMessageClientTransport in the SDK. The background also handles these
 * for desktop bridge relay.
 */
export function createBridgeRelay(port: chrome.runtime.Port) {
  let active = false;

  const windowListener = (event: MessageEvent) => {
    if (!active || event.source !== window) return;
    if (event.data?.slop !== true) return;
    port.postMessage({ type: "slop-from-provider", message: event.data.message });
  };

  const portListener = (msg: any) => {
    if (msg.type === "bridge-active") {
      setActive(!!msg.active);
      return;
    }
    if (msg.type === "slop-to-provider" && active) {
      window.postMessage({ slop: true, message: msg.message }, "*");
    }
  };

  port.onMessage.addListener(portListener);

  function setActive(next: boolean): void {
    if (next === active) return;
    active = next;
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

  return { setActive, dispose };
}
