import type { SlopMessage } from "./messages";

export type MessageHandler = (message: SlopMessage) => void;

/** A bidirectional connection between one consumer and one provider */
export interface Connection {
  send(message: SlopMessage): void;
  onMessage(handler: MessageHandler): void;
  onClose(handler: () => void): void;
  close(): void;
}

/** Provider-side: accepts connections, sends/receives per-connection */
export interface ServerTransport {
  listen(onConnection: (connection: Connection) => void): Promise<void>;
  close(): Promise<void>;
}

/** Consumer-side: connects to a provider */
export interface ClientTransport {
  connect(): Promise<Connection>;
}
