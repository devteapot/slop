import { useState } from "react";
import { useLlmStore } from "../hooks/use-llm-store";
import type { LlmProfile } from "../slop/profiles";

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
  const profiles = useLlmStore(s => s.profiles);
  const activeProfileId = useLlmStore(s => s.activeProfileId);
  const addProfile = useLlmStore(s => s.addProfile);
  const updateProfile = useLlmStore(s => s.updateProfile);
  const deleteProfile = useLlmStore(s => s.deleteProfile);
  const setActiveProfile = useLlmStore(s => s.setActiveProfile);

  const [editing, setEditing] = useState<LlmProfile | null>(null);
  const [isNew, setIsNew] = useState(false);

  function startNew() {
    setIsNew(true);
    setEditing({
      id: `profile-${Date.now()}`,
      name: "",
      llmProvider: "ollama",
      endpoint: DEFAULT_ENDPOINTS.ollama,
      apiKey: "",
      model: "",
    });
  }

  function startEdit(profile: LlmProfile) {
    setIsNew(false);
    setEditing({ ...profile });
  }

  function handleSave() {
    if (!editing) return;
    const profile = {
      ...editing,
      name: editing.name || `${editing.llmProvider} profile`,
      endpoint: editing.endpoint || DEFAULT_ENDPOINTS[editing.llmProvider],
    };
    if (isNew) {
      addProfile(profile);
    } else {
      updateProfile(profile.id, profile);
    }
    setEditing(null);
  }

  function handleProviderChange(llmProvider: LlmProfile["llmProvider"]) {
    if (!editing) return;
    setEditing({
      ...editing,
      llmProvider,
      endpoint: DEFAULT_ENDPOINTS[llmProvider],
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
                  {p.llmProvider} &middot; {p.model || "no model"} &middot; {p.endpoint}
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
                value={editing.llmProvider}
                onChange={e => handleProviderChange(e.target.value as LlmProfile["llmProvider"])}
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              <label>Endpoint</label>
              <input
                value={editing.endpoint}
                onChange={e => setEditing({ ...editing, endpoint: e.target.value })}
                placeholder={DEFAULT_ENDPOINTS[editing.llmProvider]}
              />

              {editing.llmProvider !== "ollama" && (
                <>
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editing.apiKey}
                    onChange={e => setEditing({ ...editing, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </>
              )}

              <label>Default Model</label>
              <input
                value={editing.model}
                onChange={e => setEditing({ ...editing, model: e.target.value })}
                placeholder={editing.llmProvider === "ollama" ? "qwen2.5:14b" : "gpt-4o"}
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
