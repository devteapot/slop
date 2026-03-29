let contacts = [
  { id: "1", name: "Alice Chen", email: "alice@example.com", phone: "+1 555-0101", favorite: true },
  { id: "2", name: "Bob Smith", email: "bob@example.com", phone: "+1 555-0102", favorite: false },
  { id: "3", name: "Carol Davis", email: "carol@example.com", phone: "+1 555-0103", favorite: false }
];
let version = 1;
const listeners = /* @__PURE__ */ new Set();
function getContacts() {
  return contacts;
}
function getVersion() {
  return version;
}
function addContact(name, email, phone) {
  contacts.push({ id: Date.now().toString(), name, email, phone, favorite: false });
  version++;
  notify();
}
function editContact(id, data) {
  const c = contacts.find((c2) => c2.id === id);
  if (!c) throw new Error(`Contact not found: ${id}`);
  if (data.name !== void 0) c.name = data.name;
  if (data.email !== void 0) c.email = data.email;
  if (data.phone !== void 0) c.phone = data.phone;
  version++;
  notify();
}
function deleteContact(id) {
  const len = contacts.length;
  contacts = contacts.filter((c) => c.id !== id);
  if (contacts.length === len) throw new Error(`Contact not found: ${id}`);
  version++;
  notify();
}
function toggleFavorite(id) {
  const c = contacts.find((c2) => c2.id === id);
  if (!c) throw new Error(`Contact not found: ${id}`);
  c.favorite = !c.favorite;
  version++;
  notify();
}
function onStateChange(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function notify() {
  listeners.forEach((fn) => fn());
}

export { addContact as a, getVersion as b, deleteContact as d, editContact as e, getContacts as g, onStateChange as o, toggleFavorite as t };
//# sourceMappingURL=state.mjs.map
