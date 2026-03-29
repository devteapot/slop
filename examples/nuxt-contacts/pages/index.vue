<script setup lang="ts">
interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  favorite: boolean;
}

const contacts = ref<Contact[]>([]);
const loading = ref(true);
const editingId = ref<string | null>(null);
const editForm = ref({ name: "", email: "", phone: "" });
const newContact = ref({ name: "", email: "", phone: "" });
const showAddForm = ref(false);

async function fetchContacts() {
  contacts.value = await $fetch<Contact[]>("/api/contacts");
  loading.value = false;
}

async function addContact() {
  if (!newContact.value.name || !newContact.value.email) return;
  await $fetch("/api/contacts", { method: "POST", body: newContact.value });
  newContact.value = { name: "", email: "", phone: "" };
  showAddForm.value = false;
  await fetchContacts();
}

async function deleteContact(id: string) {
  await $fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
  await fetchContacts();
}

async function toggleFavorite(id: string) {
  await $fetch(`/api/contacts?id=${id}`, {
    method: "PATCH",
    body: { toggleFavorite: true },
  });
  await fetchContacts();
}

function startEdit(contact: Contact) {
  editingId.value = contact.id;
  editForm.value = {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
  };
}

function cancelEdit() {
  editingId.value = null;
}

async function saveEdit(id: string) {
  await $fetch(`/api/contacts?id=${id}`, {
    method: "PATCH",
    body: editForm.value,
  });
  editingId.value = null;
  await fetchContacts();
}

onMounted(() => {
  fetchContacts();

  // Subscribe to SLOP WebSocket for real-time sync with AI actions
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/slop`);
  ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", id: "ui-sync", path: "/", depth: 0 }));
  ws.onmessage = () => fetchContacts();
  onUnmounted(() => ws.close());
});
</script>

<template>
  <div class="container">
    <header class="header">
      <div class="header-top">
        <h1>Contacts</h1>
        <span class="badge">{{ contacts.length }}</span>
      </div>
      <p class="subtitle">
        SLOP-powered contacts manager
        <span class="slop-badge">SLOP ws://localhost:3000/slop</span>
      </p>
    </header>

    <div class="actions-bar">
      <button
        class="btn btn-primary"
        @click="showAddForm = !showAddForm"
      >
        {{ showAddForm ? "Cancel" : "+ Add Contact" }}
      </button>
      <span class="fav-count">
        {{ contacts.filter((c) => c.favorite).length }} favorite{{
          contacts.filter((c) => c.favorite).length !== 1 ? "s" : ""
        }}
      </span>
    </div>

    <Transition name="slide">
      <form v-if="showAddForm" class="add-form" @submit.prevent="addContact">
        <h3>New Contact</h3>
        <div class="form-row">
          <input
            v-model="newContact.name"
            placeholder="Name *"
            required
            class="input"
          />
          <input
            v-model="newContact.email"
            placeholder="Email *"
            type="email"
            required
            class="input"
          />
          <input
            v-model="newContact.phone"
            placeholder="Phone"
            class="input"
          />
          <button type="submit" class="btn btn-primary">Add</button>
        </div>
      </form>
    </Transition>

    <div v-if="loading" class="loading">Loading contacts...</div>

    <TransitionGroup v-else name="list" tag="div" class="contact-list">
      <div
        v-for="contact in contacts"
        :key="contact.id"
        class="contact-card"
        :class="{ 'is-favorite': contact.favorite }"
      >
        <template v-if="editingId === contact.id">
          <form class="edit-form" @submit.prevent="saveEdit(contact.id)">
            <input v-model="editForm.name" class="input" placeholder="Name" />
            <input
              v-model="editForm.email"
              class="input"
              placeholder="Email"
              type="email"
            />
            <input
              v-model="editForm.phone"
              class="input"
              placeholder="Phone"
            />
            <div class="edit-actions">
              <button type="submit" class="btn btn-small btn-primary">
                Save
              </button>
              <button
                type="button"
                class="btn btn-small btn-ghost"
                @click="cancelEdit"
              >
                Cancel
              </button>
            </div>
          </form>
        </template>

        <template v-else>
          <button
            class="star-btn"
            :class="{ active: contact.favorite }"
            @click="toggleFavorite(contact.id)"
            :title="
              contact.favorite
                ? 'Remove from favorites'
                : 'Add to favorites'
            "
          >
            {{ contact.favorite ? "\u2605" : "\u2606" }}
          </button>

          <div class="contact-info">
            <div class="contact-name">{{ contact.name }}</div>
            <div class="contact-detail">{{ contact.email }}</div>
            <div v-if="contact.phone" class="contact-detail contact-phone">
              {{ contact.phone }}
            </div>
          </div>

          <div class="contact-actions">
            <button
              class="btn btn-small btn-ghost"
              @click="startEdit(contact)"
            >
              Edit
            </button>
            <button
              class="btn btn-small btn-danger"
              @click="deleteContact(contact.id)"
            >
              Delete
            </button>
          </div>
        </template>
      </div>
    </TransitionGroup>

    <footer class="footer">
      <p>
        State is served via WebSocket at
        <code>/slop</code> using the SLOP protocol.
      </p>
    </footer>
  </div>
</template>

<style scoped>
.container {
  max-width: 680px;
  margin: 0 auto;
  padding: 40px 20px;
}

.header {
  margin-bottom: 24px;
}

.header-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
}

.badge {
  background: #30363d;
  color: #8b949e;
  font-size: 13px;
  padding: 2px 10px;
  border-radius: 12px;
}

.subtitle {
  color: #8b949e;
  font-size: 14px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.slop-badge {
  font-family: monospace;
  font-size: 11px;
  background: rgba(88, 166, 255, 0.1);
  color: #58a6ff;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(88, 166, 255, 0.2);
}

.actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.fav-count {
  color: #e3b341;
  font-size: 13px;
}

.btn {
  border: none;
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-primary {
  background: #238636;
  color: #fff;
  padding: 8px 16px;
}

.btn-primary:hover {
  background: #2ea043;
}

.btn-small {
  padding: 4px 12px;
  font-size: 12px;
}

.btn-ghost {
  background: transparent;
  color: #8b949e;
  border: 1px solid #30363d;
}

.btn-ghost:hover {
  color: #e1e4e8;
  border-color: #8b949e;
}

.btn-danger {
  background: transparent;
  color: #da3633;
  border: 1px solid #da363355;
}

.btn-danger:hover {
  background: #da363320;
  border-color: #da3633;
}

.add-form {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.add-form h3 {
  font-size: 15px;
  font-weight: 500;
  margin-bottom: 12px;
  color: #e1e4e8;
}

.form-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.input {
  background: #0f1117;
  border: 1px solid #30363d;
  color: #e1e4e8;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  flex: 1;
  min-width: 120px;
  outline: none;
  transition: border-color 0.15s;
}

.input:focus {
  border-color: #58a6ff;
}

.input::placeholder {
  color: #484f58;
}

.loading {
  text-align: center;
  color: #8b949e;
  padding: 40px 0;
}

.contact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.contact-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color 0.15s;
}

.contact-card:hover {
  border-color: #484f58;
}

.contact-card.is-favorite {
  border-color: #e3b34133;
}

.star-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #484f58;
  transition: color 0.15s;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}

.star-btn:hover {
  color: #e3b341;
}

.star-btn.active {
  color: #e3b341;
}

.contact-info {
  flex: 1;
  min-width: 0;
}

.contact-name {
  font-weight: 500;
  font-size: 15px;
  margin-bottom: 2px;
}

.contact-detail {
  color: #8b949e;
  font-size: 13px;
}

.contact-phone {
  margin-top: 1px;
}

.contact-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.edit-form {
  display: flex;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
}

.edit-form .input {
  min-width: 100px;
}

.edit-actions {
  display: flex;
  gap: 6px;
}

.footer {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid #30363d;
  text-align: center;
}

.footer p {
  color: #484f58;
  font-size: 13px;
}

.footer code {
  background: #161b22;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #58a6ff;
}

/* Transitions */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.list-enter-active,
.list-leave-active {
  transition: all 0.2s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.list-move {
  transition: transform 0.2s ease;
}
</style>
