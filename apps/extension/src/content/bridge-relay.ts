/**
 * Bridge SLOP postMessage traffic between the page and the background port.
 *
 * Uses "slop-from-provider" / "slop-to-provider" on the port to match the
 * PostMessageClientTransport in the SDK. The background also handles these
 * for desktop bridge relay.
 */
import type {
  BackgroundMessage,
  ProviderMessage,
  RelayConsumerMessage,
} from "../types";

export function createBridgeRelay(port: chrome.runtime.Port) {
  let active = false;
  const RELAY_TAG = "__slop_relay";

  const windowListener = (event: MessageEvent) => {
    if (!active || event.source !== window) return;
    if (!isBridgeWindowMessage(event.data)) return;
    // Ignore messages we posted ourselves (bridge-relay → window echo)
    if (event.data[RELAY_TAG]) return;
    port.postMessage({ type: "slop-from-provider", message: event.data.message });
  };

  const portListener = (message: unknown) => {
    if (!isBackgroundMessage(message)) return;
    const msg = message;
    if (msg.type === "bridge-active") {
      setActive(msg.active);
      return;
    }
    if (msg.type === "slop-to-provider" && active) {
      window.postMessage({ slop: true, [RELAY_TAG]: true, message: msg.message }, "*");
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

function isBridgeWindowMessage(
  value: unknown,
): value is { slop: true; __slop_relay?: boolean; message: ProviderMessage | RelayConsumerMessage } {
  return !!value
    && typeof value === "object"
    && (value as Record<string, unknown>).slop === true
    && "message" in (value as Record<string, unknown>);
}

function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  return !!value
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string";
}
