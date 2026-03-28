export interface Transport {
  send(message: unknown): void;
  onMessage(handler: (msg: any) => void): void;
  start(): void;
  stop(): void;
}

/**
 * postMessage transport for in-browser SLOP providers.
 * Wraps all messages in { slop: true, message } envelope.
 */
export function createPostMessageTransport(): Transport {
  const messageHandlers: ((msg: any) => void)[] = [];
  let listener: ((event: MessageEvent) => void) | null = null;
  let metaTag: HTMLMetaElement | null = null;

  return {
    send(message: unknown) {
      window.postMessage({ slop: true, message }, "*");
    },

    onMessage(handler: (msg: any) => void) {
      messageHandlers.push(handler);
    },

    start() {
      listener = (event: MessageEvent) => {
        if (event.source !== window) return;
        if (event.data?.slop !== true) return;
        const msg = event.data.message;
        if (!msg?.type) return;
        for (const h of messageHandlers) h(msg);
      };
      window.addEventListener("message", listener);

      // Inject meta tag for discovery
      if (typeof document !== "undefined" && !document.querySelector('meta[name="slop"]')) {
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
