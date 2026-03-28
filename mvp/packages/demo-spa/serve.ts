import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Build first
await import("./build.ts");

const PORT = Number(process.env.PORT) || 3838;
const publicDir = join(import.meta.dir, "public");
const distDir = join(import.meta.dir, "dist");

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Serve built JS
    if (path === "/app.js") {
      const js = readFileSync(join(distDir, "app.js"), "utf-8");
      return new Response(js, { headers: { "Content-Type": "application/javascript" } });
    }

    // Serve HTML (SPA — all routes serve index.html)
    const htmlPath = join(publicDir, "index.html");
    const html = readFileSync(htmlPath, "utf-8");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`Notes app (SPA) running at http://localhost:${PORT}`);
console.log(`  SLOP: postMessage (in-browser provider)`);
console.log(`  Extension will auto-detect via <meta name="slop" content="postmessage">`);
