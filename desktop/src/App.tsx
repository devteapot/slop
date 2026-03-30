import { useState } from "react";
import "./App.css";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { StateTree } from "./components/StateTree";
import { Settings } from "./components/Settings";

// The TopBar now renders workspace tabs + toolbar in two rows
// Grid layout: rows are [auto, auto, 1fr], columns are [260px, 1fr, optional 300px]

export function App() {
  const [treeOpen, setTreeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
