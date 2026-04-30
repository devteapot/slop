import { randomUUID } from "node:crypto";
import { type Down, RELAY_PROTOCOL_VERSION, type Up } from "./protocol";
import { type BridgeLogger, RelayError, type RelayHub, type RelaySocketLike, type RelayState } from "./types";

export interface CreateRelayHubOptions {
  logger?: BridgeLogger;
  requestTimeoutMs?: number;
  openReadyState?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_OPEN_READY_STATE = 1;

export function createRelayHub(options: CreateRelayHubOptions = {}): RelayHub {
  const logger = options.logger ?? { info: () => {}, error: () => {} };
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const openReadyState = options.openReadyState ?? DEFAULT_OPEN_READY_STATE;
  const states = new Map<string, RelayState>();

  function getOrCreateState(userId: string): RelayState {
    const existing = states.get(userId);
    if (existing) return existing;
    const state: RelayState = {
      userId,
      socket: null,
      providers: [],
      pending: new Map(),
      subs: new Map(),
      online: false,
    };
    states.set(userId, state);
    return state;
  }

  function sendFrame(state: RelayState, frame: Down): void {
    if (!state.socket || state.socket.readyState !== openReadyState) {
      throw new RelayError("relay_disconnected", "Relay is not connected.");
    }
    state.socket.send(JSON.stringify(frame));
  }

  function request(
    state: RelayState,
    frame: Extract<Down, { reqId: string }>,
    timeoutMs = requestTimeoutMs,
  ): Promise<Up> {
    if (state.pending.has(frame.reqId)) {
      throw new RelayError("duplicate_req_id", `Duplicate relay request id ${frame.reqId}.`);
    }

    return new Promise<Up>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(frame.reqId);
        reject(new RelayError("relay_timeout", `Timed out waiting for relay response ${frame.reqId}.`));
      }, timeoutMs);
      timer.unref?.();
      state.pending.set(frame.reqId, {
        resolve,
        reject,
        timer,
      });
      try {
        sendFrame(state, frame);
      } catch (error) {
        clearTimeout(timer);
        state.pending.delete(frame.reqId);
        reject(error);
      }
    });
  }

  function rejectPending(state: RelayState, error: RelayError): void {
    for (const [reqId, pending] of state.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      state.pending.delete(reqId);
    }
  }

  function markSubscriptionsStale(state: RelayState, error: RelayError): void {
    for (const subscription of state.subs.values()) {
      subscription.onStale(error);
    }
  }

  function closeSocket(socket: RelaySocketLike | null, code = 1000, reason = "closing"): void {
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {}
  }

  const hub: RelayHub = {
    getState(userId) {
      return states.get(userId) ?? null;
    },

    getOrCreateState,

    acceptRelay(userId, socket) {
      const state = getOrCreateState(userId);
      if (state.socket && state.socket !== socket) {
        rejectPending(state, new RelayError("relay_replaced", "Relay was replaced by a newer connection."));
        markSubscriptionsStale(state, new RelayError("relay_replaced", "Relay was replaced by a newer connection."));
        closeSocket(state.socket, 4000, "relay replaced");
      }
      state.socket = socket;
      state.online = true;
      state.providers = [];
      state.relayVersion = undefined;
      logger.info("[slop-bridge] relay connected", { userId });
    },

    handleRelayFrame(userId, frame) {
      const state = getOrCreateState(userId);
      switch (frame.t) {
        case "hello": {
          if (frame.protocolVersion !== RELAY_PROTOCOL_VERSION) {
            closeSocket(state.socket, 4002, "unsupported relay protocol");
            state.socket = null;
            state.online = false;
            throw new RelayError("unsupported_protocol", `Unsupported relay protocol ${frame.protocolVersion}.`);
          }
          state.relayVersion = frame.relayVersion;
          logger.info("[slop-bridge] relay hello", { userId, relayVersion: frame.relayVersion });
          for (const subscription of state.subs.values()) {
            const reqId = `req-${randomUUID()}`;
            void request(state, {
              t: "subscribe",
              reqId,
              subId: subscription.subId,
              providerId: subscription.providerId,
            }).catch((error) => {
              subscription.onStale(
                error instanceof RelayError
                  ? error
                  : new RelayError("resubscribe_failed", error instanceof Error ? error.message : String(error)),
              );
            });
          }
          break;
        }
        case "providers": {
          state.providers = frame.list;
          break;
        }
        case "snapshot": {
          const pending = state.pending.get(frame.reqId);
          if (pending) {
            clearTimeout(pending.timer);
            state.pending.delete(frame.reqId);
            pending.resolve(frame);
          }
          state.subs.get(frame.subId)?.onSnapshot(frame);
          break;
        }
        case "patch": {
          state.subs.get(frame.subId)?.onPatch(frame.ops, frame.version, frame.seq);
          break;
        }
        case "result": {
          const pending = state.pending.get(frame.reqId);
          if (!pending) return;
          clearTimeout(pending.timer);
          state.pending.delete(frame.reqId);
          pending.resolve(frame);
          break;
        }
      }
    },

    closeRelay(userId) {
      const state = getOrCreateState(userId);
      state.socket = null;
      state.online = false;
      rejectPending(state, new RelayError("relay_disconnected", "Relay disconnected."));
      markSubscriptionsStale(state, new RelayError("relay_disconnected", "Relay disconnected."));
      logger.info("[slop-bridge] relay disconnected", { userId });
    },

    async subscribe(input) {
      const state = getOrCreateState(input.userId);
      const reqId = `req-${randomUUID()}`;
      const subId = `sub-${randomUUID()}`;
      state.subs.set(subId, {
        userId: input.userId,
        sessionId: input.sessionId,
        providerId: input.providerId,
        subId,
        onSnapshot: input.onSnapshot,
        onPatch: input.onPatch,
        onStale: input.onStale,
      });

      try {
        const frame = await request(state, {
          t: "subscribe",
          reqId,
          subId,
          providerId: input.providerId,
        });
        if (frame.t === "result" && !frame.ok) {
          throw new RelayError(frame.error.code, frame.error.message);
        }
        if (frame.t !== "snapshot") {
          throw new RelayError("unexpected_relay_frame", `Expected snapshot, got ${frame.t}.`);
        }
        return { subId, snapshot: frame };
      } catch (error) {
        state.subs.delete(subId);
        throw error;
      }
    },

    unsubscribe(userId, subId) {
      const state = getOrCreateState(userId);
      state.subs.delete(subId);
      if (state.socket && state.socket.readyState === openReadyState) {
        sendFrame(state, { t: "unsubscribe", subId });
      }
    },

    async invoke(input) {
      const state = getOrCreateState(input.userId);
      const reqId = `req-${randomUUID()}`;
      const frame = await request(state, {
        t: "invoke",
        reqId,
        providerId: input.providerId,
        path: input.path,
        action: input.action,
        params: input.params,
      });
      if (frame.t !== "result") {
        throw new RelayError("unexpected_relay_frame", `Expected result, got ${frame.t}.`);
      }
      return frame;
    },

    markSessionClosed(userId, sessionId) {
      const state = getOrCreateState(userId);
      for (const [subId, subscription] of [...state.subs]) {
        if (subscription.sessionId === sessionId) {
          hub.unsubscribe(userId, subId);
        }
      }
    },

    resubscribeSession(userId, sessionId) {
      const state = getOrCreateState(userId);
      for (const subscription of [...state.subs.values()]) {
        if (subscription.sessionId !== sessionId) continue;
        const reqId = `req-${randomUUID()}`;
        void request(state, {
          t: "subscribe",
          reqId,
          subId: subscription.subId,
          providerId: subscription.providerId,
        }).catch((error) => {
          subscription.onStale(
            error instanceof RelayError
              ? error
              : new RelayError("resubscribe_failed", error instanceof Error ? error.message : String(error)),
          );
        });
      }
    },
  };

  return hub;
}
