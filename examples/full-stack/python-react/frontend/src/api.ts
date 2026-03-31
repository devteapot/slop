import type { Contact, Activity } from "./types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// --- Contacts ---

export async function fetchContacts(query?: string, tag?: string): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  const data = await json<{ contacts: Contact[] }>(await fetch(`${BASE}/contacts${qs ? `?${qs}` : ""}`));
  return data.contacts;
}

export async function fetchContact(id: string): Promise<Contact & { activity: Activity[] }> {
  return json(await fetch(`${BASE}/contacts/${id}`));
}

export async function createContact(data: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  tags?: string[];
}): Promise<Contact> {
  return json(
    await fetch(`${BASE}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
  );
}

export async function editContact(
  id: string,
  data: { name?: string; email?: string; phone?: string; company?: string; title?: string }
): Promise<Contact> {
  return json(
    await fetch(`${BASE}/contacts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
  );
}

export async function deleteContact(id: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// --- Star ---

export async function starContact(id: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/star`, { method: "POST" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export async function unstarContact(id: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/star`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// --- Tags ---

export async function addTag(id: string, tag: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export async function removeTag(id: string, tag: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// --- Notes & Activity ---

export async function addNote(id: string, content: string): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

export async function logActivity(
  id: string,
  type: string,
  description: string
): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${id}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, description }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}

// --- Global tags ---

export async function fetchTags(): Promise<string[]> {
  const data = await json<{ tags: { name: string; contact_count: number }[] }>(await fetch(`${BASE}/tags`));
  return data.tags.map(t => t.name);
}

export async function renameTag(oldName: string, newName: string): Promise<void> {
  const res = await fetch(`${BASE}/tags/${encodeURIComponent(oldName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
}
