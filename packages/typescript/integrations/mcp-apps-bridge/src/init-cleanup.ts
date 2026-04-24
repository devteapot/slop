/**
 * Connect a SLOP consumer and an ext-apps App in parallel with race-safe
 * cleanup. Promise.all rejects as soon as one side fails, but the other
 * connect promise may resolve *after* the catch handler ran — leaking the
 * late-connecting side. A shared `failed` flag lets each `.then` notice a
 * peer rejection and tear its own side down immediately.
 *
 * Exported so the race can be unit-tested with fakes; production callers
 * use it via `createMcpAppsBridge`.
 */
export interface DisposableConsumer {
  connect(): Promise<unknown>;
  disconnect(): void;
}

export interface DisposableApp {
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
}

export async function connectBoth(consumer: DisposableConsumer, app: DisposableApp): Promise<void> {
  let failed = false;
  let consumerOk = false;
  let appOk = false;

  const consumerPromise = consumer.connect().then(
    () => {
      if (failed) {
        consumer.disconnect();
        return;
      }
      consumerOk = true;
    },
    (err) => {
      failed = true;
      throw err;
    },
  );
  const appPromise = app.connect().then(
    () => {
      if (failed) {
        void app.close().catch(() => {});
        return;
      }
      appOk = true;
    },
    (err) => {
      failed = true;
      throw err;
    },
  );

  try {
    await Promise.all([consumerPromise, appPromise]);
  } catch (err) {
    // Wait for the other side to settle so its `.then` handler can run the
    // late-cleanup branch above. Without this, a Promise.all rejection
    // returns before the slower successful connect runs its handler.
    await Promise.allSettled([consumerPromise, appPromise]);
    if (consumerOk) consumer.disconnect();
    if (appOk) void app.close().catch(() => {});
    throw err;
  }
}
