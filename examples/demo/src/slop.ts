/**
 * In-memory SLOP provider + transport for the demo.
 *
 * Architecture decision: the demo runs the SLOP provider entirely in-browser
 * using SlopClientImpl with an InMemoryTransport instead of a network transport.
 * This means no server, no WebSocket, no extension — the full protocol loop
 * (subscribe → snapshot → invoke → result → patch) happens in-process.
 *
 * The InMemoryTransport implements the provider-side Transport interface.
 * External code (the tree panel, the AI agent) talks to it using standard
 * SLOP protocol messages via sendToProvider/onProviderMessage — the same
 * messages that would go over a WebSocket in production.
 *
 * One React-specific constraint: the provider's tree is driven by useSlop()
 * registrations which run during React renders. When an invoke handler calls
 * setState, the tree doesn't update until React re-renders and useSlop
 * re-registers. This creates a brief async gap between "handler ran" and
 * "tree reflects the change" that doesn't exist in server-side providers
 * (where handlers mutate state synchronously). Consumers in this demo
 * account for this with a short delay after invoke results — this is a
 * React rendering constraint, not a protocol deviation.
 */

import { SlopClientImpl } from "@slop-ai/client";
import type { Transport } from "@slop-ai/core";

type MessageHandler = (msg: any) => void;

class InMemoryTransport implements Transport {
  private providerHandlers: MessageHandler[] = [];
  private listeners = new Set<MessageHandler>();

  start() {}
  stop() {}

  onMessage(handler: MessageHandler) {
    this.providerHandlers.push(handler);
  }

  /** Provider → consumers (hello, snapshot, patch, result) */
  send(msg: any) {
    for (const fn of this.listeners) fn(msg);
  }

  /** Subscribe to messages the provider pushes */
  onProviderMessage(fn: MessageHandler): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Send a SLOP protocol message to the provider (connect, subscribe, invoke) */
  sendToProvider(msg: any) {
    for (const handler of this.providerHandlers) handler(msg);
  }
}

export const transport = new InMemoryTransport();

export const slop = new SlopClientImpl(
  { id: "shop", name: "SLOP Shop" },
  [transport],
);
slop.start();

// Send connect so the provider is ready to accept subscriptions
transport.sendToProvider({ type: "connect" });
