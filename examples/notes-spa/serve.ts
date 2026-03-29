import { readFileSync } from "fs";
import { join } from "path";

await import("./build.ts");

const PORT = Number(process.env.PORT) || 3838;
const publicDir = join(import.meta.dir, "public");
const distDir = join(import.meta.dir, "dist");

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/app.js") {
      return new Response(readFileSync(join(distDir, "app.js"), "utf-8"), {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    return new Response(readFileSync(join(publicDir, "index.html"), "utf-8"), {
      headers: { "Content-Type": "text/html" },
    });
  },
});

console.log(`Notes app running at http://localhost:${PORT}`);
console.log(`  SLOP: postMessage (in-browser, via @slop/core)`);
console.log(`  Extension auto-discovers via <meta name="slop" content="postmessage">`);
