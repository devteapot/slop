export interface SlopDiscovery {
  transport: "ws" | "postmessage";
  endpoint?: string;
}

/** Find all SLOP meta tags on the page. A page can have multiple providers. */
export function discoverSlop(): SlopDiscovery[] {
  const metas = document.querySelectorAll('meta[name="slop"]');
  const results: SlopDiscovery[] = [];

  for (const meta of metas) {
    const content = meta.getAttribute("content");
    if (!content) continue;

    if (content === "postmessage") {
      results.push({ transport: "postmessage" });
    } else if (content.startsWith("ws://") || content.startsWith("wss://")) {
      results.push({ transport: "ws", endpoint: content });
    }
  }

  return results;
}

/** Watch for dynamically added meta tags (SPAs inject them after load). */
export function observeDiscovery(callback: (discoveries: SlopDiscovery[]) => void): () => void {
  let knownCount = 0;

  const check = (mutations: MutationRecord[]) => {
    // Only check if a meta element was actually added
    let metaAdded = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLMetaElement && node.name === "slop") {
          metaAdded = true;
          break;
        }
      }
      if (metaAdded) break;
    }
    if (!metaAdded) return;

    const all = discoverSlop();
    if (all.length > knownCount) {
      knownCount = all.length;
      callback(all);
    }
  };

  const observer = new MutationObserver(check);
  observer.observe(document.head, { childList: true });
  return () => observer.disconnect();
}
