import { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../hooks/use-workspace-store";
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

  const workspaces = useWorkspaceStore(s => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore(s => s.createWorkspace);
  const renameWorkspace = useWorkspaceStore(s => s.renameWorkspace);
  const deleteWorkspace = useWorkspaceStore(s => s.deleteWorkspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchModels();
  }, [activeProfileId]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const activeProfile = getActiveProfile();

  function handleAddWorkspace() {
    const count = workspaces.length + 1;
    createWorkspace(`Workspace ${count}`);
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

  function handleTabContextMenu(e: React.MouseEvent, id: string, name: string) {
    e.preventDefault();
    startRename(id, name);
  }

  function handleTabDoubleClick(id: string, name: string) {
    startRename(id, name);
  }

  return (
    <>
      {/* Row 1: Workspace tab bar */}
      <div className="workspace-bar">
        {workspaces.map(ws => (
          <div
            key={ws.id}
            className={`workspace-tab${ws.id === activeWorkspaceId ? " active" : ""}`}
            onClick={() => setActiveWorkspace(ws.id)}
            onContextMenu={e => handleTabContextMenu(e, ws.id, ws.name)}
            onDoubleClick={() => handleTabDoubleClick(ws.id, ws.name)}
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

      {/* Row 2: Toolbar */}
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
    </>
  );
}
