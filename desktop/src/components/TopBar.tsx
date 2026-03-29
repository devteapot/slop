import { useEffect } from "react";
import { useLlmStore } from "../hooks/use-llm-store";

interface TopBarProps {
  treeOpen: boolean;
  onToggleTree: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ treeOpen, onToggleTree, onOpenSettings }: TopBarProps) {
  const profiles = useLlmStore(s => s.profiles);
  const activeProfileId = useLlmStore(s => s.activeProfileId);
  const models = useLlmStore(s => s.models);
  const modelsLoading = useLlmStore(s => s.modelsLoading);
  const setActiveProfile = useLlmStore(s => s.setActiveProfile);
  const setModel = useLlmStore(s => s.setModel);
  const fetchModels = useLlmStore(s => s.fetchModels);
  const getActiveProfile = useLlmStore(s => s.getActiveProfile);

  useEffect(() => {
    fetchModels();
  }, [activeProfileId]);

  const activeProfile = getActiveProfile();

  return (
    <div className="top-bar">
      <span className="title">SLOP Desktop</span>

      <select
        value={activeProfileId}
        onChange={e => setActiveProfile(e.target.value)}
      >
        {profiles.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <select
        value={activeProfile.model}
        onChange={e => setModel(e.target.value)}
      >
        {modelsLoading && <option value="">Loading models...</option>}
        {!modelsLoading && models.length === 0 && (
          <option value={activeProfile.model}>{activeProfile.model || "No models"}</option>
        )}
        {models.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
        {!modelsLoading && activeProfile.model && !models.includes(activeProfile.model) && (
          <option value={activeProfile.model}>{activeProfile.model}</option>
        )}
      </select>

      <button onClick={onToggleTree}>
        {treeOpen ? "Hide Tree" : "Show Tree"}
      </button>

      <button onClick={onOpenSettings}>Settings</button>
    </div>
  );
}
