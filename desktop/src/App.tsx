import { useState, useEffect } from "react";
import "./App.css";
import { useAppStore } from "./stores/app-store";
import { useChatStore } from "./stores/chat-store";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { StateTree } from "./components/StateTree";
import { Settings } from "./components/Settings";

export function App() {
  const [treeOpen, setTreeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const initialized = useAppStore(s => s.initialized);
  const activeWorkspaceId = useAppStore(s => s.activeWorkspaceId);

  useEffect(() => {
    useAppStore.getState().init().then(() => {
      const wsId = useAppStore.getState().activeWorkspaceId;
      useChatStore.getState().init(wsId);
    });
    return () => {
      useAppStore.getState().destroy();
      useChatStore.getState().destroy();
    };
  }, []);

  // Load messages when switching workspaces
  useEffect(() => {
    if (activeWorkspaceId) {
      useChatStore.getState().loadWorkspace(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  if (!initialized) {
    return (
      <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6e7681", fontFamily: "JetBrains Mono, monospace", fontSize: "12px" }}>
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className={`app${treeOpen ? " tree-open" : ""}`}>
      <TopBar
        treeOpen={treeOpen}
        onToggleTree={() => setTreeOpen(!treeOpen)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Sidebar />
      <ChatPanel />
      {treeOpen && <StateTree />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
