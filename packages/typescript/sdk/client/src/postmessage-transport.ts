import type { Transport } from "@slop-ai/core";

/**
 * postMessage transport for in-browser SLOP providers.
 * Wraps all messages in { slop: true, message } envelope.
 */
export function createPostMessageTransport(options: { discover?: boolean; targetOrigin?: string } = {}): Transport {
  const messageHandlers: ((msg: any) => void)[] = [];
  let listener: ((event: MessageEvent) => void) | null = null;
  let metaTag: HTMLMetaElement | null = null;

  // Default to this window's own origin. Spec: never use "*" — SLOP messages
  // may leak to third-party iframes. Callers can override when the counterpart
  // lives in a different same-origin document (rare).
  const targetOrigin = options.targetOrigin ?? window.location.origin;

  return {
    send(message: unknown) {
      window.postMessage({ slop: true, message }, targetOrigin);
    },

    onMessage(handler: (msg: any) => void) {
      messageHandlers.push(handler);
    },

    start() {
      listener = (event: MessageEvent) => {
        // Same-window + same-origin. `event.source !== window` already rejects
        // cross-frame senders, but we also enforce origin for defense in depth
        // against same-window scripts running in other contexts.
        if (event.source !== window) return;
        if (event.origin !== window.location.origin) return;
        if (event.data?.slop !== true) return;
        const msg = event.data.message;
        if (!msg?.type) return;
        for (const h of messageHandlers) h(msg);
      };
      window.addEventListener("message", listener);

      // Inject meta tag for discovery when enabled.
      if (
        options.discover !== false &&
        typeof document !== "undefined" &&
        !document.querySelector('meta[name="slop"][content="postmessage"]')
      ) {
        metaTag = document.createElement("meta");
        metaTag.name = "slop";
        metaTag.content = "postmessage";
        document.head.appendChild(metaTag);
      }
    },

    stop() {
      if (listener) {
        window.removeEventListener("message", listener);
        listener = null;
      }
      if (metaTag) {
        metaTag.remove();
        metaTag = null;
      }
    },
  };
}
