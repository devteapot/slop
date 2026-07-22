/**
 * Discovery origin binding (spec/core/transport.md § Web discovery — Origin binding).
 *
 * A `<meta name="slop">` tag is attacker-influenced input: any page can point
 * at a WebSocket it does not own, including another local app's loopback
 * provider. These pure helpers classify a declared WebSocket target relative
 * to the advertising page so the background can decide whether to auto-connect
 * (same-origin) or require explicit user approval (cross-origin).
 */

export type TargetClassification = "same-origin" | "cross-origin";

/** Loopback hosts per spec: localhost / 127.0.0.1 / ::1 (plus the 127/8 block and *.localhost). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function parseHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a discovered WebSocket target relative to the advertising page.
 *
 * - SAME-ORIGIN: target hostname matches the page's hostname (port is
 *   intentionally ignored — `http://localhost:3000` declaring
 *   `ws://localhost:3737/slop` is the canonical legitimate case), or both
 *   page and target are loopback.
 * - CROSS-ORIGIN: any other host, and in particular a loopback target
 *   declared by a non-loopback page (a page on the internet pointing at
 *   someone else's local provider).
 *
 * Unparseable inputs classify as cross-origin (untrusted by default).
 */
export function classifyDiscoveryTarget(pageUrl: string, targetUrl: string): TargetClassification {
  const pageHost = parseHostname(pageUrl);
  const targetHost = parseHostname(targetUrl);
  if (!pageHost || !targetHost) return "cross-origin";

  const pageLoopback = isLoopbackHostname(pageHost);
  const targetLoopback = isLoopbackHostname(targetHost);

  // Loopback target declared by a non-loopback page: always untrusted.
  if (targetLoopback && !pageLoopback) return "cross-origin";

  // Loopback family is treated as one host (localhost vs 127.0.0.1 vs ::1).
  if (pageLoopback && targetLoopback) return "same-origin";

  return pageHost === targetHost ? "same-origin" : "cross-origin";
}

/** Web origin of a page URL (scheme://host[:port]), or null if unparseable. */
export function pageOriginOf(pageUrl: string): string | null {
  try {
    const origin = new URL(pageUrl).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/** Stable storage key for a persisted (page origin -> target URL) approval. */
export function approvalKey(pageOrigin: string, targetUrl: string): string {
  return `${pageOrigin} -> ${targetUrl}`;
}
