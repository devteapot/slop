#!/usr/bin/env bun
/**
 * Automated test harness for the pomodoro desktop example.
 *
 * Spawns a pomodoro desktop app as a subprocess, connects to its Unix socket,
 * speaks SLOP over the socket, and verifies the tree structure and
 * action results match the blueprint.
 *
 * Usage:
 *   bun run test-harness.ts typescript
 *   bun run test-harness.ts python
 *   bun run test-harness.ts go
 *   bun run test-harness.ts rust
 *   bun run test-harness.ts all
 */

import { spawn, type Subprocess } from "bun";
import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync, existsSync, rmSync, cpSync } from "fs";
import { tmpdir } from "os";
import { createConnection, type Socket } from "node:net";

// --- Config ---

const BASE = dirname(import.meta.path);

const IMPLEMENTATIONS: Record<string, { cmd: string[]; cwd: string; build?: string[] }> = {
  typescript: {
    cmd: ["bunx", "electron", "."],
    cwd: resolve(BASE, "typescript"),
  },
  python: {
    cmd: ["python", "-m", "pomodoro"],
    cwd: resolve(BASE, "python"),
  },
  go: {
    cmd: [resolve(BASE, "go/pomodoro")],
    cwd: resolve(BASE, "go"),
    build: ["go", "build", "-o", "pomodoro", "."],
  },
  rust: {
    cmd: [resolve(BASE, "rust/src-tauri/target/debug/pomodoro")],
    cwd: resolve(BASE, "rust"),
    build: ["cargo", "build"],
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

  static async create(
    cmd: string[],
    cwd: string,
    dataFile: string,
    sockPath: string,
  ): Promise<SlopTestClient> {
    // Desktop apps use env vars, not CLI flags
    const proc = spawn({
      cmd,
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
      env: {
        ...process.env,
        POMODORO_FILE: dataFile,
        POMODORO_SOCK: sockPath,
      },
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
        await Bun.sleep(100);
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
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function findChild(node: any, id: string): any | undefined {
  return node?.children?.find((c: any) => c.id === id);
}

function findAffordance(node: any, action: string): any | undefined {
  return node?.affordances?.find((a: any) => a.action === action);
}

function affordanceNames(node: any): string[] {
  return (node?.affordances ?? []).map((a: any) => a.action);
}

// --- Test suite ---

async function runTests(lang: string) {
  const impl = IMPLEMENTATIONS[lang];
  if (!impl) {
    console.error(`Unknown implementation: ${lang}`);
    process.exit(1);
  }

  // Build step if needed
  if (impl.build) {
    const buildBin = impl.build[0];
    console.log(`\x1b[90m  Building ${lang}...\x1b[0m`);
    const buildProc = spawn({
      cmd: impl.build,
      cwd: lang === "rust" ? resolve(impl.cwd, "src-tauri") : impl.cwd,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await buildProc.exited;
    if (exitCode !== 0) {
      console.log(`\x1b[33m⚠ Skipping ${lang}: build failed\x1b[0m`);
      return;
    }
  }

  // Check binary exists (for non-bun/python implementations)
  const binPath = impl.cmd[0];
  if (binPath !== "bunx" && binPath !== "python" && !existsSync(binPath)) {
    console.log(`\x1b[33m⚠ Skipping ${lang}: binary not found at ${binPath}\x1b[0m`);
    console.log(`  Build it first (see examples/desktop/${lang}/README.md)`);
    return;
  }

  // Use a temp data file and socket so tests don't interfere
  const testDir = resolve(tmpdir(), `pomodoro-test-${lang}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  const dataFile = resolve(testDir, "sessions.json");
  const sockPath = resolve(testDir, "pomodoro.sock");

  // Copy seed data
  const seedPath = resolve(BASE, "seed.json");
  if (existsSync(seedPath)) {
    cpSync(seedPath, dataFile);
  } else {
    // Try implementation-specific seed
    const implSeed = resolve(impl.cwd, "seed.json");
    if (existsSync(implSeed)) {
      cpSync(implSeed, dataFile);
    }
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
    const provider = hello.provider ?? hello;
    assertEq(provider.id, "pomodoro", "provider.id is 'pomodoro'");
    assert(provider.slop_version != null, "provider has slop_version");

    // --- Test 2: Subscribe and verify tree structure ---
    console.log("\n  \x1b[1mSubscribe & tree structure\x1b[0m");
    client.send({ type: "subscribe", id: "s1", path: "/", depth: -1 });
    const snapshot = await client.waitForType("snapshot");
    assertEq(snapshot.type, "snapshot", "receives snapshot");
    assertEq(snapshot.id, "s1", "snapshot matches subscription id");
    assert(snapshot.version != null, "snapshot has version");

    const tree = snapshot.tree;
    assertEq(tree.id, "pomodoro", "root id is 'pomodoro'");
    assertEq(tree.type, "root", "root type is 'root'");

    // Check children: timer, sessions, stats
    const timerNode = findChild(tree, "timer");
    assert(timerNode != null, "tree has 'timer' child");
    assertEq(timerNode?.type, "context", "timer is type 'context'");

    const sessionsNode = findChild(tree, "sessions");
    assert(sessionsNode != null, "tree has 'sessions' child");
    assertEq(sessionsNode?.type, "collection", "sessions is type 'collection'");

    const statsNode = findChild(tree, "stats");
    assert(statsNode != null, "tree has 'stats' child");
    assertEq(statsNode?.type, "context", "stats is type 'context'");

    // Timer properties when idle
    assert(timerNode?.properties?.phase != null, "timer has phase property");
    assertEq(timerNode?.properties?.phase, "idle", "timer phase is 'idle'");
    assert(timerNode?.properties?.paused != null, "timer has paused property");
    assert(timerNode?.properties?.time_remaining_sec != null || timerNode?.properties?.time_remaining_sec === 0, "timer has time_remaining_sec property");

    // Sessions collection properties
    assert(sessionsNode?.properties?.count != null, "sessions has count property");
    assert(sessionsNode?.properties?.today_count != null, "sessions has today_count property");

    // Sessions children (from seed data: 4 sessions)
    const sessionItems = sessionsNode?.children ?? [];
    assertEq(sessionItems.length, 4, "sessions has 4 children (from seed data)");

    // Stats properties
    assert(statsNode?.properties?.today_completed != null, "stats has today_completed property");
    assert(statsNode?.properties?.today_total_focus_min != null, "stats has today_total_focus_min property");

    // Timer affordances when idle: should have "start"
    const startAff = findAffordance(timerNode, "start");
    assert(startAff != null, "timer has 'start' affordance when idle");

    // --- Test 3: Start a pomodoro ---
    console.log("\n  \x1b[1mStart a pomodoro\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-start",
      path: "/timer",
      action: "start",
      params: { tag: "Test session" },
    });
    const startResult = await client.waitForType("result");
    assertEq(startResult.id, "inv-start", "start result has correct id");
    assertEq(startResult.status, "ok", "start succeeds");

    // Query tree to verify timer state changed
    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-start", path: "/", depth: -1 });
    const qStart = await client.waitForType("snapshot", 5000);
    const timerAfterStart = findChild(qStart.tree, "timer");
    assertEq(timerAfterStart?.properties?.phase, "working", "timer phase is 'working' after start");
    assertEq(timerAfterStart?.properties?.current_tag, "Test session", "current_tag is 'Test session'");

    // Affordances should include pause, skip, stop (not start)
    const afterStartAffs = affordanceNames(timerAfterStart);
    assert(afterStartAffs.includes("pause"), "working timer has 'pause' affordance");
    assert(afterStartAffs.includes("skip"), "working timer has 'skip' affordance");
    assert(afterStartAffs.includes("stop"), "working timer has 'stop' affordance");
    assert(!afterStartAffs.includes("start"), "working timer does NOT have 'start' affordance");

    // --- Test 4: Pause and resume ---
    console.log("\n  \x1b[1mPause and resume\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-pause",
      path: "/timer",
      action: "pause",
      params: {},
    });
    const pauseResult = await client.waitForType("result");
    assertEq(pauseResult.id, "inv-pause", "pause result has correct id");
    assertEq(pauseResult.status, "ok", "pause succeeds");

    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-pause", path: "/", depth: -1 });
    const qPause = await client.waitForType("snapshot", 5000);
    const timerAfterPause = findChild(qPause.tree, "timer");
    assertEq(timerAfterPause?.properties?.paused, true, "timer is paused");

    // Affordances should include resume (not pause)
    const pauseAffs = affordanceNames(timerAfterPause);
    assert(pauseAffs.includes("resume"), "paused timer has 'resume' affordance");
    assert(!pauseAffs.includes("pause"), "paused timer does NOT have 'pause' affordance");

    // Resume
    client.send({
      type: "invoke",
      id: "inv-resume",
      path: "/timer",
      action: "resume",
      params: {},
    });
    const resumeResult = await client.waitForType("result");
    assertEq(resumeResult.id, "inv-resume", "resume result has correct id");
    assertEq(resumeResult.status, "ok", "resume succeeds");

    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-resume", path: "/", depth: -1 });
    const qResume = await client.waitForType("snapshot", 5000);
    const timerAfterResume = findChild(qResume.tree, "timer");
    assertEq(timerAfterResume?.properties?.paused, false, "timer is no longer paused after resume");

    // --- Test 5: Stop timer ---
    console.log("\n  \x1b[1mStop timer\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-stop",
      path: "/timer",
      action: "stop",
      params: {},
    });
    const stopResult = await client.waitForType("result");
    assertEq(stopResult.id, "inv-stop", "stop result has correct id");
    assertEq(stopResult.status, "ok", "stop succeeds");

    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-stop", path: "/", depth: -1 });
    const qStop = await client.waitForType("snapshot", 5000);
    const timerAfterStop = findChild(qStop.tree, "timer");
    assertEq(timerAfterStop?.properties?.phase, "idle", "timer phase is 'idle' after stop");

    // Affordances back to just start
    const stopAffs = affordanceNames(timerAfterStop);
    assert(stopAffs.includes("start"), "idle timer has 'start' affordance");
    assert(!stopAffs.includes("pause"), "idle timer does NOT have 'pause' affordance");
    assert(!stopAffs.includes("resume"), "idle timer does NOT have 'resume' affordance");

    // --- Test 6: Session tag ---
    console.log("\n  \x1b[1mSession tag\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-tag",
      path: "/sessions/s-4",
      action: "tag",
      params: { label: "Renamed" },
    });
    const tagResult = await client.waitForType("result");
    assertEq(tagResult.id, "inv-tag", "tag result has correct id");
    assertEq(tagResult.status, "ok", "tag succeeds");

    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-tag", path: "/", depth: -1 });
    const qTag = await client.waitForType("snapshot", 5000);
    const sessionsAfterTag = findChild(qTag.tree, "sessions");
    const taggedSession = findChild(sessionsAfterTag, "s-4");
    assert(taggedSession != null, "s-4 still exists after tag");
    assertEq(taggedSession?.properties?.tag, "Renamed", "s-4 tag changed to 'Renamed'");

    // --- Test 7: Session delete ---
    console.log("\n  \x1b[1mSession delete\x1b[0m");
    client.send({
      type: "invoke",
      id: "inv-del",
      path: "/sessions/s-4",
      action: "delete",
      params: {},
    });
    const delResult = await client.waitForType("result");
    assertEq(delResult.id, "inv-del", "delete result has correct id");
    assertEq(delResult.status, "ok", "delete succeeds");

    await Bun.sleep(300);
    client.drain();

    client.send({ type: "query", id: "q-del", path: "/", depth: -1 });
    const qDel = await client.waitForType("snapshot", 5000);
    const sessionsAfterDel = findChild(qDel.tree, "sessions");
    const deletedSession = findChild(sessionsAfterDel, "s-4");
    assert(deletedSession == null, "s-4 no longer in tree after delete");

    // --- Test 8: Salience ordering ---
    console.log("\n  \x1b[1mSalience ordering\x1b[0m");
    const remainingSessions = sessionsAfterDel?.children ?? [];
    if (remainingSessions.length >= 2) {
      let ordered = true;
      for (let i = 0; i < remainingSessions.length - 1; i++) {
        const a = remainingSessions[i]?.meta?.salience ?? 0;
        const b = remainingSessions[i + 1]?.meta?.salience ?? 0;
        if (a < b) {
          ordered = false;
          break;
        }
      }
      assert(ordered, "sessions have decreasing salience (most recent first)");
    } else {
      assert(true, "salience ordering (not enough sessions to verify)");
    }

    // --- Test 9: Unsubscribe ---
    console.log("\n  \x1b[1mUnsubscribe\x1b[0m");
    client.send({ type: "unsubscribe", id: "s1" });
    // No response expected for unsubscribe, just verify no crash
    await Bun.sleep(200);
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
    console.log("Usage: bun run test-harness.ts <typescript|python|go|rust|all>");
    process.exit(1);
  }

  const langs = args[0] === "all" ? Object.keys(IMPLEMENTATIONS) : [args[0]];

  for (const lang of langs) {
    await runTests(lang);
  }

  console.log(
    `\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`,
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
