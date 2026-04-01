import { createRoot } from "react-dom/client";
import { App } from "./App";

// Catch unhandled errors
window.addEventListener("error", (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap">${e.message}\n${e.filename}:${e.lineno}\n\n${e.error?.stack ?? ""}</pre>`;
});
window.addEventListener("unhandledrejection", (e) => {
  document.body.innerHTML += `<pre style="color:orange;padding:20px;white-space:pre-wrap">Unhandled rejection: ${e.reason}</pre>`;
});

createRoot(document.getElementById("root")!).render(<App />);
