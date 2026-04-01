import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/app-store";

interface TopBarProps {
  treeOpen: boolean;
  onToggleTree: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ treeOpen, onToggleTree, onOpenSettings }: TopBarProps) {
  const workspaces = useAppStore(s => s.workspaces);
  const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId);
  const profiles = useAppStore(s => s.profiles);
  const activeProfileId = useAppStore(s => s.activeProfileId);
  const models = useAppStore(s => s.models);
  const modelsLoading = useAppStore(s => s.modelsLoading);

  const createWorkspace = useAppStore(s => s.createWorkspace);
  const renameWorkspace = useAppStore(s => s.renameWorkspace);
  const deleteWorkspace = useAppStore(s => s.deleteWorkspace);
  const setActiveWorkspace = useAppStore(s => s.setActiveWorkspace);
  const setActiveProfile = useAppStore(s => s.setActiveProfile);
  const setModel = useAppStore(s => s.setModel);
  const fetchModels = useAppStore(s => s.fetchModels);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? profiles[0];

  useEffect(() => {
    fetchModels();
  }, [activeProfileId]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  function handleAddWorkspace() {
    createWorkspace(`Workspace ${workspaces.length + 1}`);
  }

  function startRename(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
  }

  function commitRename() {
    if (editingId && editName.trim()) {
      renameWorkspace(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  }

  return (
    <>
      <div className="workspace-bar">
        {workspaces.map(ws => (
          <div
            key={ws.id}
            className={`workspace-tab${ws.id === activeWorkspaceId ? " active" : ""}`}
            onClick={() => setActiveWorkspace(ws.id)}
            onContextMenu={e => { e.preventDefault(); startRename(ws.id, ws.name); }}
            onDoubleClick={() => startRename(ws.id, ws.name)}
          >
            {editingId === ws.id ? (
              <input
                ref={editRef}
                className="workspace-tab-edit"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setEditingId(null); setEditName(""); }
                }}
              />
            ) : (
              <span className="workspace-tab-label">{ws.name}</span>
            )}
            {workspaces.length > 1 && (
              <button
                className="close"
                onClick={e => { e.stopPropagation(); deleteWorkspace(ws.id); }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="workspace-add" onClick={handleAddWorkspace}>+</button>
      </div>

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
          value={activeProfile?.model ?? ""}
          onChange={e => setModel(e.target.value)}
        >
          {modelsLoading && <option value="">Loading models...</option>}
          {!modelsLoading && models.length === 0 && (
            <option value={activeProfile?.model ?? ""}>{activeProfile?.model || "No models"}</option>
          )}
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
          {!modelsLoading && activeProfile?.model && !models.includes(activeProfile.model) && (
            <option value={activeProfile.model}>{activeProfile.model}</option>
          )}
        </select>

        <button onClick={onToggleTree}>
          {treeOpen ? "Hide Tree" : "Show Tree"}
        </button>

        <button onClick={onOpenSettings}>Settings</button>
      </div>
    </>
  );
}
