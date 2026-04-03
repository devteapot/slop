import type { SlopServer } from "@slop-ai/server";
import type { UiMountSession } from "./ui-mount";

declare global {
  var __slop_ui_mounts:
    | WeakMap<SlopServer<unknown>, Map<string, UiMountSession>>
    | undefined;
}

const activeMounts = (
  globalThis.__slop_ui_mounts ??=
    new WeakMap<SlopServer<unknown>, Map<string, UiMountSession>>()
) as WeakMap<SlopServer, Map<string, UiMountSession>>;

export function registerUiMountSession(
  slop: SlopServer,
  mountPath: string,
  session: UiMountSession,
): UiMountSession | undefined {
  const mounts = ensureMountMap(slop);
  const existing = mounts.get(mountPath);
  mounts.set(mountPath, session);
  return existing;
}

export function unregisterUiMountSession(
  slop: SlopServer,
  mountPath: string,
  session: UiMountSession,
): void {
  const mounts = activeMounts.get(slop);
  if (!mounts) return;
  if (mounts.get(mountPath) === session) {
    mounts.delete(mountPath);
  }
}

export async function refreshMountedUi(
  slop: SlopServer,
  options?: { skipPath?: string },
): Promise<void> {
  const mounts = activeMounts.get(slop);
  if (!mounts || mounts.size === 0) return;

  const refreshes: Promise<unknown>[] = [];
  for (const [mountPath, session] of mounts) {
    if (options?.skipPath && pathTargetsMount(slop.id, options.skipPath, mountPath)) {
      continue;
    }
    refreshes.push(session.requestRefresh());
  }

  if (refreshes.length === 0) return;
  await Promise.allSettled(refreshes);
}

function ensureMountMap(slop: SlopServer): Map<string, UiMountSession> {
  let mounts = activeMounts.get(slop);
  if (!mounts) {
    mounts = new Map<string, UiMountSession>();
    activeMounts.set(slop, mounts);
  }
  return mounts;
}

function pathTargetsMount(providerId: string, path: string, mountPath: string): boolean {
  const rootPrefix = `/${providerId}/`;
  let cleanPath = path;

  if (cleanPath.startsWith(rootPrefix)) {
    cleanPath = cleanPath.slice(rootPrefix.length);
  } else if (cleanPath.startsWith("/")) {
    cleanPath = cleanPath.slice(1);
  }

  return cleanPath === mountPath || cleanPath.startsWith(`${mountPath}/`);
}
