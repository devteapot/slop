/** Bridge SLOP postMessage traffic between the page and the background port */
export function startBridge(port: chrome.runtime.Port): void {
  // Page → Background
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.slop !== true) return;
    port.postMessage({ type: "slop-from-provider", message: event.data.message });
  });

  // Background → Page
  port.onMessage.addListener((msg: any) => {
    if (msg.type === "slop-to-provider") {
      window.postMessage({ slop: true, message: msg.message }, "*");
    }
  });
}
