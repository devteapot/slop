export interface SlopDiscovery {
  transport: "ws" | "postmessage";
  endpoint?: string;
}

export function discoverSlop(): SlopDiscovery | null {
  const meta = document.querySelector('meta[name="slop"]');
  if (!meta) return null;

  const content = meta.getAttribute("content");
  if (!content) return null;

  if (content === "postmessage") {
    return { transport: "postmessage" };
  }

  if (content.startsWith("ws://") || content.startsWith("wss://")) {
    return { transport: "ws", endpoint: content };
  }

  return null;
}

/** Watch for dynamically added meta tags (SPAs) */
export function observeDiscovery(callback: (discovery: SlopDiscovery) => void): void {
  const observer = new MutationObserver(() => {
    const result = discoverSlop();
    if (result) {
      callback(result);
      observer.disconnect();
    }
  });

  observer.observe(document.head, { childList: true, subtree: true });
}
