import { useEffect, useState } from "react";
import type { Contact, Activity } from "../types";
import * as api from "../api";

interface Props {
  contactId: string;
  onContactUpdated: () => void;
  onContactDeleted: () => void;
}

export default function ContactDetail({ contactId, onContactUpdated, onContactDeleted }: Props) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", company: "", title: "" });
  const [newNote, setNewNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.fetchContact(contactId).then((data) => {
      if (cancelled) return;
      setContact(data);
      setActivity(data.activity ?? []);
      setEditing(false);
      setNewNote("");
    });
    return () => { cancelled = true; };
  }, [contactId]);

  if (!contact) {
    return <section className="contact-detail"><p className="loading">Loading...</p></section>;
  }

  const startEdit = () => {
    setEditForm({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      title: contact.title,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    await api.editContact(contact.id, editForm);
    setEditing(false);
    onContactUpdated();
    const updated = await api.fetchContact(contact.id);
    setContact(updated);
    setActivity(updated.activity ?? []);
  };

  const toggleStar = async () => {
    if (contact.starred) {
      await api.unstarContact(contact.id);
    } else {
      await api.starContact(contact.id);
    }
    onContactUpdated();
    const updated = await api.fetchContact(contact.id);
    setContact(updated);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${contact.name}?`)) return;
    await api.deleteContact(contact.id);
    onContactDeleted();
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    await api.addNote(contact.id, newNote.trim());
    setNewNote("");
    onContactUpdated();
    const updated = await api.fetchContact(contact.id);
    setContact(updated);
    setActivity(updated.activity ?? []);
  };

  const handleRemoveTag = async (tag: string) => {
    await api.removeTag(contact.id, tag);
    onContactUpdated();
    const updated = await api.fetchContact(contact.id);
    setContact(updated);
  };

  const handleAddTag = async () => {
    const tag = prompt("Add tag:");
    if (!tag?.trim()) return;
    await api.addTag(contact.id, tag.trim());
    onContactUpdated();
    const updated = await api.fetchContact(contact.id);
    setContact(updated);
  };

  const formatDate = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
    return d.toLocaleDateString();
  };

  return (
    <section className="contact-detail">
      <div className="detail-header">
        {editing ? (
          <div className="edit-form">
            <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" />
            <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" />
            <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="Phone" />
            <input value={editForm.company} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} placeholder="Company" />
            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Title" />
            <div className="edit-actions">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="detail-title-row">
              <h2>{contact.name}</h2>
              <button className="btn-icon star-btn" onClick={toggleStar} title={contact.starred ? "Unstar" : "Star"}>
                {contact.starred ? "\u2605" : "\u2606"}
              </button>
            </div>
            <p className="detail-subtitle">
              {contact.email}
              {contact.phone ? ` \u00B7 ${contact.phone}` : ""}
            </p>
            {(contact.title || contact.company) && (
              <p className="detail-role">
                {contact.title}
                {contact.title && contact.company ? " at " : ""}
                {contact.company}
              </p>
            )}
            <div className="detail-actions">
              <button className="btn-secondary" onClick={startEdit}>Edit</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </>
        )}
      </div>

      <div className="detail-tags">
        <span className="section-label">Tags</span>
        <div className="tag-list">
          {contact.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
              <button className="tag-remove" onClick={() => handleRemoveTag(tag)}>&times;</button>
            </span>
          ))}
          <button className="tag-add" onClick={handleAddTag}>+ tag</button>
        </div>
      </div>

      {contact.notes && (
        <div className="detail-notes">
          <span className="section-label">Notes</span>
          <div className="notes-content">{contact.notes}</div>
        </div>
      )}

      <div className="detail-add-note">
        <textarea
          placeholder="Add a note..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          rows={2}
        />
        <button className="btn-primary btn-small" onClick={handleAddNote} disabled={!newNote.trim()}>
          Add Note
        </button>
      </div>

      {activity.length > 0 && (
        <div className="detail-activity">
          <span className="section-label">Activity</span>
          <ul className="activity-list">
            {activity.map((a) => (
              <li key={a.id} className="activity-item">
                <span className="activity-type">{a.type}</span>
                <span className="activity-desc">{a.description}</span>
                <span className="activity-time">{formatDate(a.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
