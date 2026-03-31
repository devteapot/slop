import { useSlop } from "@slop-ai/react";
import { slop } from "../slop";
import type { Contact } from "../types";

interface Props {
  contacts: Contact[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function ContactList({ contacts, selectedId, onSelect }: Props) {
  const selected = contacts.find((c) => c.id === selectedId);

  useSlop(slop, "selection", {
    type: "status",
    props: {
      contact_id: selectedId,
      contact_name: selected?.name ?? null,
    },
    actions: {
      select: {
        params: { contact_id: "string" },
        handler: ({ contact_id }) => onSelect(contact_id as string),
      },
      deselect: () => onSelect(null),
    },
  });

  // Sort: starred first, then alphabetical
  const sorted = [...contacts].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <aside className="contact-list">
      {sorted.map((c) => (
        <button
          key={c.id}
          className={`contact-row ${selectedId === c.id ? "selected" : ""}`}
          onClick={() => onSelect(c.id)}
        >
          <div className="contact-row-main">
            {c.starred && <span className="star-indicator">&#9733;</span>}
            <div className="contact-row-text">
              <span className="contact-name">{c.name}</span>
              <span className="contact-meta">
                {c.title}
                {c.title && c.company ? " · " : ""}
                {c.company}
              </span>
            </div>
          </div>
        </button>
      ))}
      {contacts.length === 0 && (
        <p className="empty-list">No contacts found.</p>
      )}
      <div className="contact-count">{contacts.length} contacts</div>
    </aside>
  );
}
