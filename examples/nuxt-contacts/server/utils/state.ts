interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  favorite: boolean;
}

let contacts: Contact[] = [
  { id: "1", name: "Alice Chen", email: "alice@example.com", phone: "+1 555-0101", favorite: true },
  { id: "2", name: "Bob Smith", email: "bob@example.com", phone: "+1 555-0102", favorite: false },
  { id: "3", name: "Carol Davis", email: "carol@example.com", phone: "+1 555-0103", favorite: false },
];

let version = 1;
const listeners: Set<() => void> = new Set();

export function getContacts() {
  return contacts;
}

export function getVersion() {
  return version;
}

export function addContact(name: string, email: string, phone: string) {
  contacts.push({ id: Date.now().toString(), name, email, phone, favorite: false });
  version++;
  notify();
}

export function editContact(id: string, data: Partial<Contact>) {
  const c = contacts.find((c) => c.id === id);
  if (!c) throw new Error(`Contact not found: ${id}`);
  if (data.name !== undefined) c.name = data.name;
  if (data.email !== undefined) c.email = data.email;
  if (data.phone !== undefined) c.phone = data.phone;
  version++;
  notify();
}

export function deleteContact(id: string) {
  const len = contacts.length;
  contacts = contacts.filter((c) => c.id !== id);
  if (contacts.length === len) throw new Error(`Contact not found: ${id}`);
  version++;
  notify();
}

export function toggleFavorite(id: string) {
  const c = contacts.find((c) => c.id === id);
  if (!c) throw new Error(`Contact not found: ${id}`);
  c.favorite = !c.favorite;
  version++;
  notify();
}

export function onStateChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  listeners.forEach((fn) => fn());
}
