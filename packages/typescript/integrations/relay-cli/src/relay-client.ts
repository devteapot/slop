import WebSocket from "ws";
import { type Down, isDownFrame, type Logger, RELAY_PROTOCOL_VERSION, type Up } from "./protocol";

export interface RelayClientOptions {
  url: string;
  token: string;
  relayVersion: string;
  logger?: Logger;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  stableConnectionMs?: number;
}

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_STABLE_CONNECTION_MS = 60_000;

export class RelayClient {
  private readonly logger: Logger;
  private readonly openListeners = new Set<() => void>();
  private readonly closeListeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: Down) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private socket: WebSocket | null = null;
  private stopped = true;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private latestProviders: Extract<Up, { t: "providers" }> | null = null;

  constructor(private readonly options: RelayClientOptions) {
    this.logger = options.logger ?? { info: () => {}, error: () => {} };
  }

  on(event: "open", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "frame", listener: (frame: Down) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(
    event: "open" | "close" | "frame" | "error",
    listener: (() => void) | ((frame: Down) => void) | ((error: Error) => void),
  ): void {
    if (event === "open") this.openListeners.add(listener as () => void);
    if (event === "close") this.closeListeners.add(listener as () => void);
    if (event === "frame") this.frameListeners.add(listener as (frame: Down) => void);
    if (event === "error") this.errorListeners.add(listener as (error: Error) => void);
  }

  off(event: "open", listener: () => void): void;
  off(event: "close", listener: () => void): void;
  off(event: "frame", listener: (frame: Down) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  off(
    event: "open" | "close" | "frame" | "error",
    listener: (() => void) | ((frame: Down) => void) | ((error: Error) => void),
  ): void {
    if (event === "open") this.openListeners.delete(listener as () => void);
    if (event === "close") this.closeListeners.delete(listener as () => void);
    if (event === "frame") this.frameListeners.delete(listener as (frame: Down) => void);
    if (event === "error") this.errorListeners.delete(listener as (error: Error) => void);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }

  send(frame: Up): void {
    if (frame.t === "providers") {
      this.latestProviders = frame;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.write(frame);
  }

  private connect(): void {
    if (this.stopped) return;

    const socket = new WebSocket(this.options.url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
    });
    this.socket = socket;

    socket.on("open", () => {
      this.write({
        t: "hello",
        relayVersion: this.options.relayVersion,
        protocolVersion: RELAY_PROTOCOL_VERSION,
      });
      if (this.latestProviders) {
        this.write(this.latestProviders);
      }
      this.emitOpen();
      this.stableTimer = setTimeout(() => {
        this.attempts = 0;
      }, this.options.stableConnectionMs ?? DEFAULT_STABLE_CONNECTION_MS);
      this.stableTimer.unref?.();
    });

    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as unknown;
        if (!isDownFrame(parsed)) {
          this.logger.error("[slop-relay] Ignoring invalid bridge frame");
          return;
        }
        this.emitFrame(parsed);
      } catch (error) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.clearStableTimer();
      this.emitClose();
      this.scheduleReconnect();
    });

    socket.on("error", (error) => {
      this.emitError(error);
    });
  }

  private write(frame: Up): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempts += 1;
    const base = this.options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const cap = this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(base * 2 ** Math.max(0, this.attempts - 1), cap);
    const jittered = Math.round(delay * (0.75 + Math.random() * 0.5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jittered);
    this.reconnectTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearStableTimer();
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  private emitOpen(): void {
    for (const listener of this.openListeners) listener();
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }

  private emitFrame(frame: Down): void {
    for (const listener of this.frameListeners) listener(frame);
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

export function createRelayClient(options: RelayClientOptions): RelayClient {
  return new RelayClient(options);
}
