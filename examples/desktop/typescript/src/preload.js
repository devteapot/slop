const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pomodoro", {
  getState: () => ipcRenderer.invoke("get-state"),
  start: (tag) => ipcRenderer.invoke("start", tag),
  pause: () => ipcRenderer.invoke("pause"),
  resume: () => ipcRenderer.invoke("resume"),
  skip: () => ipcRenderer.invoke("skip"),
  stop: () => ipcRenderer.invoke("stop"),
  tag: (label) => ipcRenderer.invoke("tag", label),
  onStateChange: (callback) => {
    ipcRenderer.on("state-change", (_event, state) => callback(state));
  },
});
