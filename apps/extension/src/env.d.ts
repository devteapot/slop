declare module "*.css" {
  const content: string;
  export default content;
}

declare namespace chrome {
  interface Event<TCallback extends (...args: any[]) => void> {
    addListener(callback: TCallback): void;
    removeListener(callback: TCallback): void;
  }

  namespace alarms {
    interface AlarmCreateInfo {
      periodInMinutes?: number;
    }

    function create(name: string, alarmInfo: AlarmCreateInfo): void;
    const onAlarm: Event<() => void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      title?: string;
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function sendMessage(
      tabId: number,
      message: unknown,
      responseCallback?: (response?: unknown) => void,
    ): void;
    const onRemoved: Event<(tabId: number) => void>;
  }

  namespace runtime {
    interface LastError {
      message?: string;
    }

    interface MessageSender {
      tab?: tabs.Tab;
    }

    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: Event<(message: unknown) => void>;
      onDisconnect: Event<() => void>;
    }

    interface ConnectInfo {
      name?: string;
    }

    function connect(connectInfo?: ConnectInfo): Port;
    function openOptionsPage(): void;

    const onConnect: Event<(port: Port) => void>;
    const onMessage: Event<(
      message: unknown,
      sender: MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => void>;
    const lastError: LastError | undefined;
  }

  namespace storage {
    type StorageAreaName = "sync" | "local" | "managed" | "session";

    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    interface StorageArea {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      get(
        keys: string | string[] | Record<string, unknown> | null,
        callback: (items: Record<string, unknown>) => void,
      ): void;
      set(items: Record<string, unknown>): Promise<void>;
      set(items: Record<string, unknown>, callback: () => void): void;
    }

    const local: StorageArea;
    const sync: StorageArea;
    const onChanged: Event<(
      changes: Record<string, StorageChange>,
      areaName: StorageAreaName,
    ) => void>;
  }
}
