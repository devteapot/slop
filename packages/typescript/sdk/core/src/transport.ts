export interface Transport {
  send(message: unknown): void;
  onMessage(handler: (msg: any) => void): void;
  start(): void;
  stop(): void;
}
