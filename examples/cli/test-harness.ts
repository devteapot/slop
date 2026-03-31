#!/usr/bin/env bun
/**
 * Automated test harness for the tsk CLI example.
 *
 * Spawns `tsk --slop` as a subprocess, connects to its Unix socket,
 * speaks SLOP over the socket, and verifies the tree structure and
 * action results match the blueprint.
 *
 * Usage:
 *   bun run test-harness.ts bun      # test Bun implementation
 *   bun run test-harness.ts python   # test Python implementation
 *   bun run test-harness.ts go       # test Go implementation
 *   bun run test-harness.ts rust     # test Rust implementation
 *   bun run test-harness.ts all      # test all implementations
 */

import { spawn, type Subprocess } from "bun";
import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync, existsSync, rmSync, cpSync } from "fs";
import { homedir, tmpdir } from "os";
import { createConnection, type Socket } from "node:net";

// --- Config ---

const IMPLEMENTATIONS: Record<string, { cmd: string[]; cwd: string }> = {
  bun: {
    cmd: ["bun", "run", "src/index.ts", "--slop"],
    cwd: resolve(dirname(import.meta.path), "bun"),
  },
  python: {
    cmd: [resolve(dirname(import.meta.path), "python/.venv/bin/tsk"), "--slop"],
    cwd: resolve(dirname(import.meta.path), "python"),
  },
  go: {
    cmd: [resolve(dirname(import.meta.path), "go/tsk"), "--slop"],
    cwd: resolve(dirname(import.meta.path), "go"),
  },
  rust: {
    cmd: [resolve(dirname(import.meta.path), "rust/target/debug/tsk"), "--slop"],
    cwd: resolve(dirname(import.meta.path), "rust"),
  },
};

// --- Test runner ---

interface SlopMessage {
  type: string;
  [key: string]: any;
}

class SlopTestClient {
  private proc: Subprocess;
  private socket!: Socket;
  private buffer = "";
  private messages: SlopMessage[] = [];
  private waiting: ((msg: SlopMessage) => void)[] = [];
  private dataFile: string;
  private sockPath: string;

  private constructor(proc: Subprocess, dataFile: string, sockPath: string) {
    this.proc = proc;
    this.dataFile = dataFile;
    this.sockPath = sockPath;
  }

  static async create(cmd: string[], cwd: string, dataFile: string, sockPath: string): Promise<SlopTestClient> {
    const proc = spawn({
      cmd: [...cmd, "--file", dataFile, "--sock", sockPath],
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });

    const client = new SlopTestClient(proc, dataFile, sockPath);

    // Wait for socket to be ready by attempting to connect with retries
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        await client.connectToSocket(sockPath);
        client.readLoop();
        return client;
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error(`Socket ${sockPath} not ready within 8s`);
  }

  private connectToSocket(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection({ path }, () => {
        this.socket = sock;
        resolve();
      });
      sock.once("error", reject);
    });
  }

  private readLoop() {
    this.socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (this.waiting.length > 0) {
            this.waiting.shift()!(msg);
          } else {
            this.messages.push(msg);
          }
        } catch {
          // skip non-JSON lines
        }
      }
    });

    this.socket.on("error", () => {
      // connection ended
    });
  }

  async nextMessage(timeoutMs = 5000): Promise<SlopMessage> {
    if (this.messages.length > 0) {
      return this.messages.shift()!;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiting.indexOf(resolve);
        if (idx >= 0) this.waiting.splice(idx, 1);
        reject(new Error(`Timeout waiting for message (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiting.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  async waitForType(type: string, timeoutMs = 5000): Promise<SlopMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.nextMessage(deadline - Date.now());
      if (msg.type === type) return msg;
      // collect other messages (like patches) but skip them
    }
    throw new Error(`Timeout waiting for message type: ${type}`);
  }

  drain() {
    this.messages = [];
  }

  send(msg: SlopMessage) {
    this.socket.write(JSON.stringify(msg) + "\n");
  }

  async close() {
    try {
      if (this.socket) this.socket.end();
    } catch {}
    try {
      this.proc.kill();
      await this.proc.exited;
    } catch {}
    try {
      rmSync(this.sockPath);
    } catch {}
  }
}

// --- Assertions ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

function assertEq(actual: any, expected: any, name: string) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    name,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function assertIncludes(arr: any[], value: any, name: string) {
  assert(
    arr.some((v) => JSON.stringify(v) === JSON.stringify(value)),
    name,
    `${JSON.stringify(value)} not found in array`
  );
}

function findChild(node: any, id: string): any | undefined {
  return node?.children?.find((c: any) => c.id === id);
}

function findAffordance(node: any, action: string): any | undefined {
  return node?.affordances?.find((a: any) => a.action === action);
}

// --- Test suite ---

async function runTests(lang: string) {
  const impl = IMPLEMENTATIONS[lang];
  if (!impl) {
    console.error(`Unknown implementation: ${lang}`);
    process.exit(1);
  }

  // Check binary exists
  const binPath = impl.cmd[0] === "bun" ? "bun" : impl.cmd[0];
  if (binPath !== "bun" && !existsSync(binPath)) {
    console.log(`\x1b[33m⚠ Skipping ${lang}: binary not found at ${binPath}\x1b[0m`);
    console.log(`  Build it first (see examples/cli/${lang}/README.md)`);
    return;
  }

  // Use a temp data file so tests don't interfere
  const testDir = resolve(tmpdir(), `tsk-test-${lang}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  const dataFile = resolve(testDir, "tasks.json");
  const sockPath = resolve(testDir, "tsk.sock");

  // Copy seed data
  const seedPath = resolve(dirname(import.meta.path), `${lang}/seed.json`);
  if (existsSync(seedPath)) {
    cpSync(seedPath, dataFile);
  }

  console.log(`\n\x1b[1m=== Testing ${lang.toUpperCase()} ===\x1b[0m`);
  console.log(`  data: ${dataFile}`);
  console.log(`  sock: ${sockPath}`);

  const client = await SlopTestClient.create(impl.cmd, impl.cwd, dataFile, sockPath);

  try {
    // --- Test 1: Hello message ---
    console.log("\n  \x1b[1mHandshake\x1b[0m");
    const hello = await client.nextMessage();
    assertEq(hello.type, "hello", "receives hello message");
    // hello format: { type: "hello", provider: { id, name, slop_version } }
    const provider = hello.provider ?? hello;
    assertEq(provider.id, "tsk", "provider.id is 'tsk'");
    assert(provider.slop_version != null, "provider has slop_version");

    // --- Test 2: Subscribe and verify tree ---
    console.log("\n  \x1b[1mSubscribe & tree structure\x1b[0m");
    client.send({ type: "subscribe", id: "s1", path: "/", depth: -1 });
    const snapshot = await client.waitForType("snapshot");
    assertEq(snapshot.type, "snapshot", "receives snapshot");
    assertEq(snapshot.id, "s1", "snapshot matches subscription id");
    assert(snapshot.version != null, "snapshot has version");

    const tree = snapshot.tree;
    assertEq(tree.id, "tsk", "root id is 'tsk'");
    assertEq(tree.type, "root", "root type is 'root'");

    // Check children exist
    const tasksNode = findChild(tree, "tasks");
    assert(tasksNode != null, "tree has 'tasks' child");
    assertEq(tasksNode?.type, "collection", "tasks is a collection");

    const userNode = findChild(tree, "user");
    assert(userNode != null, "tree has 'user' child");

    const tagsNode = findChild(tree, "tags");
    assert(tagsNode != null, "tree has 'tags' child");

    // Check tasks collection properties
    assert(tasksNode?.properties?.count != null, "tasks has count property");
    assert(tasksNode?.properties?.pending != null, "tasks has pending property");

    // Check tasks meta
    assert(tasksNode?.meta?.summary != null, "tasks has summary");
    assert(tasksNode?.meta?.total_children != null, "tasks has total_children");

    // Check tasks affordances
    const searchAff = findAffordance(tasksNode, "search");
    assert(searchAff != null, "tasks has 'search' affordance");
    const addAff = findAffordance(tasksNode, "add");
    assert(addAff != null, "tasks has 'add' affordance");
    const clearAff = findAffordance(tasksNode, "clear_done");
    assert(clearAff != null, "tasks has 'clear_done' affordance");
    assert(clearAff?.dangerous === true, "clear_done is dangerous");
    const exportAff = findAffordance(tasksNode, "export");
    assert(exportAff != null, "tasks has 'export' affordance");

    // Check task items exist and have structure
    const taskItems = tasksNode?.children ?? [];
    assert(taskItems.length > 0, "tasks has children (items)");

    const firstTask = taskItems[0];
    assert(firstTask?.properties?.title != null, "first task has title");
    assert(firstTask?.properties?.done != null, "first task has done flag");
    assert(firstTask?.meta?.salience != null, "first task has salience");

    // Check first task affordances (should be pending task)
    const doneAff = findAffordance(firstTask, "done");
    const editAff = findAffordance(firstTask, "edit");
    const deleteAff = findAffordance(firstTask, "delete");
    assert(doneAff != null || findAffordance(firstTask, "undo") != null, "task has done or undo affordance");
    assert(deleteAff != null, "task has delete affordance");

    // Check salience ordering (first task should have highest salience)
    if (taskItems.length >= 2) {
      const s1 = firstTask?.meta?.salience ?? 0;
      const sLast = taskItems[taskItems.length - 1]?.meta?.salience ?? 0;
      assert(s1 >= sLast, "tasks sorted by salience (highest first)");
    }

    // --- Test 3: Add a task ---
    console.log("\n  \x1b[1mAdd task\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-add",
      path: "/tasks",
      action: "add",
      params: { title: "Test task from harness", due: "2026-04-15", tags: "test" },
    });
    const addResult = await client.waitForType("result");
    assertEq(addResult.id, "inv-add", "add result has correct id");
    assertEq(addResult.status, "ok", "add succeeds");
    assert(addResult.data?.id != null, "add returns new task id");
    const newTaskId = addResult.data.id;

    // Drain any automatic updates after add
    await Bun.sleep(300);
    client.drain();

    // --- Test 4: Query to verify the new task exists ---
    console.log("\n  \x1b[1mQuery after add\x1b[0m");
    client.send({ type: "query", id: "q1", path: "/", depth: -1 });
    const queryResult = await client.waitForType("snapshot", 5000);
    const updatedTasks = findChild(queryResult.tree, "tasks");
    const newTask = findChild(updatedTasks, newTaskId);
    assert(newTask != null, `new task ${newTaskId} exists in tree after add`);
    if (newTask) {
      assertEq(newTask.properties?.title, "Test task from harness", "new task has correct title");
    }

    // --- Test 5: Complete a task ---
    console.log("\n  \x1b[1mComplete task\x1b[0m");
    // Find a pending task to complete
    const pendingTask = updatedTasks?.children?.find(
      (c: any) => c.properties?.done === false && findAffordance(c, "done")
    );
    if (pendingTask) {
      client.send({
        type: "invoke",
        id: "inv-done",
        path: `/tasks/${pendingTask.id}`,
        action: "done",
        params: {},
      });
      const doneResult = await client.waitForType("result");
      assertEq(doneResult.id, "inv-done", "done result has correct id");
      assertEq(doneResult.status, "ok", "done succeeds");

      // Verify the task is now done
      await Bun.sleep(300);
      client.drain();

      client.send({ type: "query", id: "q2", path: "/", depth: -1 });
      const q2 = await client.waitForType("snapshot", 5000);
      const completedTask = findChild(findChild(q2.tree, "tasks"), pendingTask.id);
      if (completedTask) {
        assertEq(completedTask.properties?.done, true, "task is marked done after completion");
        const undoAff = findAffordance(completedTask, "undo");
        assert(undoAff != null, "completed task has 'undo' affordance");
        const noDoneAff = findAffordance(completedTask, "done");
        assert(noDoneAff == null, "completed task does not have 'done' affordance");
      } else {
        assert(false, "completed task still in tree");
      }
    } else {
      console.log("  \x1b[33m⚠ No pending task found to test completion\x1b[0m");
    }

    // --- Test 6: Read notes (content reference) ---
    console.log("\n  \x1b[1mRead notes (content ref)\x1b[0m");
    // t-1 has notes in the seed data
    client.send({
      type: "invoke",
      id: "inv-notes",
      path: "/tasks/t-1",
      action: "read_notes",
      params: {},
    });
    const notesResult = await client.waitForType("result");
    assertEq(notesResult.id, "inv-notes", "read_notes result has correct id");
    assertEq(notesResult.status, "ok", "read_notes succeeds");
    assert(
      notesResult.data?.content != null && notesResult.data.content.length > 0,
      "read_notes returns content"
    );
    assert(
      notesResult.data?.content?.includes("Milk") || notesResult.data?.content?.includes("milk"),
      "notes content matches seed data for t-1"
    );

    // --- Test 7: Search ---
    console.log("\n  \x1b[1mSearch\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-search",
      path: "/tasks",
      action: "search",
      params: { query: "work" },
    });
    const searchResult = await client.waitForType("result");
    assertEq(searchResult.id, "inv-search", "search result has correct id");
    assertEq(searchResult.status, "ok", "search succeeds");
    assert(searchResult.data != null, "search returns data");

    // --- Test 8: Delete task ---
    console.log("\n  \x1b[1mDelete task\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-del",
      path: `/tasks/${newTaskId}`,
      action: "delete",
      params: {},
    });
    const delResult = await client.waitForType("result");
    assertEq(delResult.id, "inv-del", "delete result has correct id");
    assertEq(delResult.status, "ok", "delete succeeds");

    await Bun.sleep(300);
    client.drain();

    // Verify deleted
    client.send({ type: "query", id: "q3", path: "/", depth: -1 });
    const q3 = await client.waitForType("snapshot", 5000);
    const deletedTask = findChild(findChild(q3.tree, "tasks"), newTaskId);
    assert(deletedTask == null, "deleted task no longer in tree");

    // --- Test 9: Unsubscribe ---
    console.log("\n  \x1b[1mUnsubscribe\x1b[0m");
    client.send({ type: "unsubscribe", id: "s1" });
    // No response expected for unsubscribe, just verify no crash
    assert(true, "unsubscribe sent without error");

  } catch (err: any) {
    console.log(`  \x1b[31m✗ Error: ${err.message}\x1b[0m`);
    failed++;
    failures.push(err.message);
  } finally {
    await client.close();
    // Cleanup temp files
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: bun run test-harness.ts <bun|python|go|rust|all>");
    process.exit(1);
  }

  const langs = args[0] === "all" ? Object.keys(IMPLEMENTATIONS) : [args[0]];

  for (const lang of langs) {
    await runTests(lang);
  }

  console.log(
    `\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  \x1b[31m- ${f}\x1b[0m`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
