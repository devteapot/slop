/**
 * Persisted user approvals for cross-origin discovery targets.
 *
 * Keyed by (page origin -> target URL) in chrome.storage.local so the user is
 * asked once per page/target pair. See spec/core/transport.md § Origin binding.
 */

import { approvalKey } from "./origin";

const STORAGE_KEY = "crossOriginApprovals";

type ApprovalRecord = Record<string, true>;

async function load(): Promise<ApprovalRecord> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return value && typeof value === "object" ? (value as ApprovalRecord) : {};
}

export async function isApproved(pageOrigin: string, targetUrl: string): Promise<boolean> {
  const approvals = await load();
  return approvals[approvalKey(pageOrigin, targetUrl)] === true;
}

export async function saveApproval(pageOrigin: string, targetUrl: string): Promise<void> {
  const approvals = await load();
  approvals[approvalKey(pageOrigin, targetUrl)] = true;
  await chrome.storage.local.set({ [STORAGE_KEY]: approvals });
}
