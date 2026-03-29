import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { parse } from "url";
import next from "next";
import { attachSlop } from "@slop-ai/server/node";
import { slop } from "./lib/slop-server";
import { getTodos, addTodo, toggleTodo, deleteTodo } from "./lib/state";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

await app.prepare();

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk; });
    req.on("end", () => { resolve(body ? JSON.parse(body) : {}); });
  });
}

const server = createServer(async (req, res) => {
  const parsedUrl = parse(req.url!, true);

  // REST API — mutations call slop.refresh() to broadcast to SLOP subscribers
  if (parsedUrl.pathname === "/api/todos") {
    if (req.method === "GET") return json(res, getTodos());
    if (req.method === "POST") {
      const { title } = await readBody(req);
      addTodo(title);
      slop.refresh();
      return json(res, { ok: true });
    }
    if (req.method === "PATCH") {
      const id = parsedUrl.query.id as string;
      if (id) { toggleTodo(id); slop.refresh(); }
      return json(res, { ok: true });
    }
    if (req.method === "DELETE") {
      const id = parsedUrl.query.id as string;
      if (id) { deleteTodo(id); slop.refresh(); }
      return json(res, { ok: true });
    }
  }

  handle(req, res, parsedUrl);
});

// Attach SLOP WebSocket endpoint — handles /api/slop upgrade + /.well-known/slop
attachSlop(slop, server, { path: "/api/slop" });

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, () => {
  console.log(`> Ready on http://localhost:${port}`);
  console.log(`> SLOP WebSocket at ws://localhost:${port}/api/slop`);
});
