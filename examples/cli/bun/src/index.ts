#!/usr/bin/env bun

import { setFilePath } from "./store";
import { listTasks, addTask, doneTask, undoTask, editTask, deleteTask, showNotes, searchTasks, exportTasks } from "./cli";
import { startSlopMode } from "./slop";

const args = process.argv.slice(2);

// --- Parse global flags ---

let slopMode = false;
let sockPath: string | undefined;
const filtered: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--slop") {
    slopMode = true;
  } else if (args[i] === "--file" && i + 1 < args.length) {
    setFilePath(args[++i]);
  } else if (args[i] === "--sock" && i + 1 < args.length) {
    sockPath = args[++i];
  } else {
    filtered.push(args[i]);
  }
}

// --- SLOP mode ---

if (slopMode) {
  await startSlopMode(sockPath);
} else {
  // --- Normal CLI mode ---
  await runCli(filtered);
}

async function runCli(args: string[]) {
  const command = args[0] ?? "list";

  switch (command) {
    case "list": {
      const opts: { all?: boolean; tag?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--all") opts.all = true;
        else if (args[i] === "--tag" && i + 1 < args.length) opts.tag = args[++i];
      }
      await listTasks(opts);
      break;
    }

    case "add": {
      const title = args[1];
      if (!title) {
        console.error("Usage: tsk add <title> [--due <date>] [--tag <tags>]");
        process.exit(1);
      }
      const opts: { due?: string; tag?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--due" && i + 1 < args.length) opts.due = args[++i];
        else if (args[i] === "--tag" && i + 1 < args.length) opts.tag = args[++i];
      }
      await addTask(title, opts);
      break;
    }

    case "done": {
      const id = args[1];
      if (!id) { console.error("Usage: tsk done <id>"); process.exit(1); }
      await doneTask(id);
      break;
    }

    case "undo": {
      const id = args[1];
      if (!id) { console.error("Usage: tsk undo <id>"); process.exit(1); }
      await undoTask(id);
      break;
    }

    case "edit": {
      const id = args[1];
      if (!id) { console.error("Usage: tsk edit <id> [--title <t>] [--due <d>] [--tag <t>]"); process.exit(1); }
      const opts: { title?: string; due?: string; tag?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--title" && i + 1 < args.length) opts.title = args[++i];
        else if (args[i] === "--due" && i + 1 < args.length) opts.due = args[++i];
        else if (args[i] === "--tag" && i + 1 < args.length) opts.tag = args[++i];
      }
      await editTask(id, opts);
      break;
    }

    case "delete": {
      const id = args[1];
      if (!id) { console.error("Usage: tsk delete <id>"); process.exit(1); }
      await deleteTask(id);
      break;
    }

    case "notes": {
      const id = args[1];
      if (!id) { console.error("Usage: tsk notes <id> [--set <text>]"); process.exit(1); }
      const opts: { set?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--set" && i + 1 < args.length) opts.set = args[++i];
      }
      await showNotes(id, opts);
      break;
    }

    case "search": {
      const query = args[1];
      if (!query) { console.error("Usage: tsk search <query>"); process.exit(1); }
      await searchTasks(query);
      break;
    }

    case "export": {
      const format = args[1] ?? "json";
      await exportTasks(format);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Commands: list, add, done, undo, edit, delete, notes, search, export");
      process.exit(1);
  }
}
