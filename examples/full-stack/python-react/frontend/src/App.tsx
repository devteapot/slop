import { useState, useEffect, useCallback, useRef } from "react";
import type { Contact } from "./types";
import * as api from "./api";
import { slop } from "./slop";
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
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

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
      setSelectedId((current) => (
        current && !data.some((contact) => contact.id === current) ? null : current
      ));
    } catch (error) {
      console.warn("[slop] failed to load contacts:", error);
    }
  }, [search, activeTag]);

  const loadTags = useCallback(async () => {
    try {
      const data = await api.fetchTags();
      setTags(data);
    } catch (error) {
      console.warn("[slop] failed to load tags:", error);
    }
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);
  useEffect(() => { loadTags(); }, [loadTags]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadContacts(), loadTags()]);
    setDetailRefreshToken((current) => current + 1);
  }, [loadContacts, loadTags]);

  // Register __adapter node so AI consumers can trigger a data refetch
  const refreshRef = useRef(() => refreshAll());
  refreshRef.current = () => refreshAll();
  useEffect(() => {
    slop.register("__adapter", {
      type: "context",
      actions: { refresh: () => refreshRef.current() },
    });
    return () => { slop.unregister("__adapter"); };
  }, []);

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
    void refreshAll();
  };

  const handleContactUpdated = () => {
    void refreshAll();
  };

  const handleContactDeleted = () => {
    setSelectedId(null);
    void refreshAll();
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
              refreshToken={detailRefreshToken}
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
