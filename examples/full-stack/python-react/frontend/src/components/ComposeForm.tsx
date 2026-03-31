import { useSlop } from "@slop-ai/react";
import { slop } from "../slop";
import * as api from "../api";

interface Props {
  open: boolean;
  name: string;
  email: string;
  company: string;
  onFieldChange: (field: "name" | "email" | "company", value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function ComposeForm({
  open,
  name,
  email,
  company,
  onFieldChange,
  onOpen,
  onClose,
  onSubmitted,
}: Props) {
  const handleSubmit = async () => {
    if (!name.trim()) return;
    await api.createContact({
      name: name.trim(),
      email: email.trim() || undefined,
      company: company.trim() || undefined,
    });
    onSubmitted();
  };

  useSlop(slop, "compose", {
    type: "view",
    props: { open, name, email, company },
    actions: {
      open: () => onOpen(),
      close: () => onClose(),
      fill: {
        params: { name: "string", email: "string", company: "string" },
        handler: (params) => {
          if (params.name !== undefined) onFieldChange("name", params.name as string);
          if (params.email !== undefined) onFieldChange("email", params.email as string);
          if (params.company !== undefined) onFieldChange("company", params.company as string);
        },
      },
      submit: () => { handleSubmit(); },
    },
  });

  if (!open) return null;

  return (
    <div className="compose-overlay" onClick={onClose}>
      <div className="compose-form" onClick={(e) => e.stopPropagation()}>
        <div className="compose-header">
          <h3>New Contact</h3>
          <button className="btn-icon" onClick={onClose}>&times;</button>
        </div>
        <div className="compose-fields">
          <input
            placeholder="Name *"
            value={name}
            onChange={(e) => onFieldChange("name", e.target.value)}
            autoFocus
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => onFieldChange("email", e.target.value)}
          />
          <input
            placeholder="Company"
            value={company}
            onChange={(e) => onFieldChange("company", e.target.value)}
          />
        </div>
        <div className="compose-actions">
          <button className="btn-primary" onClick={handleSubmit} disabled={!name.trim()}>
            Create Contact
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
