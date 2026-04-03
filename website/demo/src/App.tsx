import { DemoProvider } from "./context";
import { StatusBar } from "./components/StatusBar";
import { AppPanel } from "./panels/AppPanel";
import { ChatPanel } from "./panels/ChatPanel";
import { TreePanel } from "./panels/TreePanel";
import { ReplayController } from "./replay/player";
import { ClickIndicator } from "./components/ClickIndicator";

export function App() {
  return (
    <DemoProvider>
      <div className="h-screen flex flex-col">
        {/* Status bar */}
        <StatusBar />

        {/* Three-panel layout — each panel handles its own overflow */}
        <div className="flex-1 grid grid-cols-3 min-h-0 overflow-hidden">
          <AppPanel />
          <ChatPanel />
          <TreePanel />
        </div>
      </div>

      {/* Replay controller (headless — drives the demo) */}
      <ReplayController />
      {/* Click indicator overlay for simulated user clicks */}
      <ClickIndicator />
    </DemoProvider>
  );
}
