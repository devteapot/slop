/**
 * Bridge pairing token helpers.
 *
 * The desktop bridge requires a pairing token transported via the
 * Sec-WebSocket-Protocol pattern from spec/core/transport.md § Security
 * considerations: the client offers ["slop.bearer", "<token>"], the server
 * verifies during the upgrade and echoes back only the non-secret label.
 * The token itself is never logged.
 */

export const BRIDGE_BEARER_PROTOCOL = "slop.bearer";

const TOKEN_STORAGE_KEY = "bridgeToken";

/** Subprotocol list for the bridge WebSocket: the literal label plus the token. */
export function buildBridgeProtocols(token: string): [string, string] {
  return [BRIDGE_BEARER_PROTOCOL, token];
}

/**
 * After a successful upgrade the server must have selected only the
 * non-secret label. Anything else means we are not talking to a compliant
 * bridge and should not treat the connection as authenticated.
 */
export function isAcceptedBridgeProtocol(selectedProtocol: string): boolean {
  return selectedProtocol === BRIDGE_BEARER_PROTOCOL;
}

export async function getBridgeToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
  const value = result[TOKEN_STORAGE_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function saveBridgeToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (trimmed) {
    await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: trimmed });
  } else {
    await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
  }
}

export const BRIDGE_TOKEN_STORAGE_KEY = TOKEN_STORAGE_KEY;
