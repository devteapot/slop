import { useState } from "react";
import { useAppStore } from "../stores/app-store";
import type { LlmProfile } from "../lib/types";

interface SettingsProps {
  onClose: () => void;
}

const PROVIDERS = [
  { value: "ollama", label: "Ollama (Local)" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Gemini" },
] as const;

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama: "http://localhost:11434",
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai/api",
  gemini: "https://generativelanguage.googleapis.com",
};

export function Settings({ onClose }: SettingsProps) {
  const profiles = useAppStore(s => s.profiles);
  const activeProfileId = useAppStore(s => s.activeProfileId);
  const addProfile = useAppStore(s => s.addProfile);
  const updateProfile = useAppStore(s => s.updateProfile);
  const deleteProfile = useAppStore(s => s.deleteProfile);
  const setActiveProfile = useAppStore(s => s.setActiveProfile);

  const [editing, setEditing] = useState<LlmProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  function startNew() {
    setIsNew(true);
    setEditing({
      id: `profile-${Date.now()}`,
      name: "",
      provider: "ollama",
      endpoint: DEFAULT_ENDPOINTS.ollama,
      api_key: "",
      model: "",
    });
  }

  function startEdit(profile: LlmProfile) {
    setIsNew(false);
    setEditing({ ...profile });
  }

  function handleSave() {
    if (!editing) return;
    const profile: LlmProfile = {
      ...editing,
      name: editing.name || `${editing.provider} profile`,
      endpoint: editing.endpoint || DEFAULT_ENDPOINTS[editing.provider],
    };
    if (isNew) {
      addProfile(profile);
    } else {
      updateProfile(profile.id, profile);
    }
    setEditing(null);
  }

  function handleProviderChange(provider: string) {
    if (!editing) return;
    setEditing({
      ...editing,
      provider,
      endpoint: DEFAULT_ENDPOINTS[provider],
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>LLM Profiles</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <button className="add-profile-btn" onClick={startNew}>
            + New Profile
          </button>

          {profiles.map(p => (
            <div
              key={p.id}
              className={`profile-list-item${p.id === activeProfileId ? " active" : ""}`}
            >
              <div className="info">
                <div className="name">
                  {p.name} {p.id === activeProfileId && "(active)"}
                </div>
                <div className="detail">
                  {p.provider} &middot; {p.model || "no model"} &middot; {p.endpoint}
                </div>
              </div>
              {p.id !== activeProfileId && (
                <button onClick={() => setActiveProfile(p.id)}>Use</button>
              )}
              <button onClick={() => startEdit(p)}>Edit</button>
              {profiles.length > 1 && (
                <button className="danger" onClick={() => deleteProfile(p.id)}>Del</button>
              )}
            </div>
          ))}

          {editing && (
            <div className="profile-form">
              <label>Name</label>
              <input
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="My Profile"
              />

              <label>Provider</label>
              <select
                value={editing.provider}
                onChange={e => handleProviderChange(e.target.value)}
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              <label>Endpoint</label>
              <input
                value={editing.endpoint}
                onChange={e => setEditing({ ...editing, endpoint: e.target.value })}
                placeholder={DEFAULT_ENDPOINTS[editing.provider]}
              />

              {editing.provider !== "ollama" && (
                <>
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editing.api_key}
                    onChange={e => setEditing({ ...editing, api_key: e.target.value })}
                    placeholder="sk-..."
                  />
                </>
              )}

              <label>Default Model</label>
              <input
                value={editing.model}
                onChange={e => setEditing({ ...editing, model: e.target.value })}
                placeholder={editing.provider === "ollama" ? "qwen2.5:14b" : "gpt-4o"}
              />

              <div className="actions">
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={handleSave}>Save</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
