import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  send: (msg: any) => ipcRenderer.send("action", msg),
  getState: () => ipcRenderer.invoke("get-state"),
  onStateUpdate: (cb: (state: any) => void) => {
    ipcRenderer.on("state-update", (_event, state) => cb(state));
  },
  onActivity: (cb: (activity: any) => void) => {
    ipcRenderer.on("activity", (_event, activity) => cb(activity));
  },
});
