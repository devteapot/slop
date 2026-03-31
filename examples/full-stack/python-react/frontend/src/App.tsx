import { useState, useEffect, useCallback } from "react";
import type { Contact } from "./types";
import * as api from "./api";
import SearchBar from "./components/SearchBar";
import TagFilter from "./components/TagFilter";
import ContactList from "./components/ContactList";
import ContactDetail from "./components/ContactDetail";
import ComposeForm from "./components/ComposeForm";

export default function App() {
  // --- State ---
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Compose form state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeName, setComposeName] = useState("");
  const [composeEmail, setComposeEmail] = useState("");
  const [composeCompany, setComposeCompany] = useState("");

  // --- Data fetching ---
  const loadContacts = useCallback(async () => {
    try {
      const data = await api.fetchContacts(search || undefined, activeTag || undefined);
      setContacts(data);
    } catch {
      // Backend might not be running yet
    }
  }, [search, activeTag]);

  const loadTags = useCallback(async () => {
    try {
      const data = await api.fetchTags();
      setTags(data);
    } catch {
      // Backend might not be running yet
    }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { loadTags(); }, [loadTags]);

  // --- Compose handlers ---
  const handleComposeFieldChange = (field: "name" | "email" | "company", value: string) => {
    if (field === "name") setComposeName(value);
    else if (field === "email") setComposeEmail(value);
    else setComposeCompany(value);
  };

  const handleComposeOpen = () => {
    setComposeName("");
    setComposeEmail("");
    setComposeCompany("");
    setComposeOpen(true);
  };

  const handleComposeClose = () => {
    setComposeOpen(false);
  };

  const handleComposeSubmitted = () => {
    setComposeOpen(false);
    setComposeName("");
    setComposeEmail("");
    setComposeCompany("");
    loadContacts();
    loadTags();
  };

  const handleContactUpdated = () => {
    loadContacts();
    loadTags();
  };

  const handleContactDeleted = () => {
    setSelectedId(null);
    loadContacts();
    loadTags();
  };

  // --- Render ---
  return (
    <div className="app">
      <header className="app-header">
        <h1>Contacts</h1>
        <SearchBar query={search} resultCount={contacts.length} onQueryChange={setSearch} />
        <button className="btn-primary" onClick={handleComposeOpen}>
          + New Contact
        </button>
      </header>

      <TagFilter activeTag={activeTag} availableTags={tags} onTagChange={setActiveTag} />

      <div className="app-body">
        <ContactList
          contacts={contacts}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <main className="app-main">
          {selectedId ? (
            <ContactDetail
              contactId={selectedId}
              onContactUpdated={handleContactUpdated}
              onContactDeleted={handleContactDeleted}
            />
          ) : (
            <div className="empty-state">
              <p>Select a contact to view details</p>
            </div>
          )}
        </main>
      </div>

      <ComposeForm
        open={composeOpen}
        name={composeName}
        email={composeEmail}
        company={composeCompany}
        onFieldChange={handleComposeFieldChange}
        onOpen={handleComposeOpen}
        onClose={handleComposeClose}
        onSubmitted={handleComposeSubmitted}
      />
    </div>
  );
}
