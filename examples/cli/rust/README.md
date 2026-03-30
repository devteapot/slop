# tsk — Rust CLI Example

A task manager CLI that becomes a SLOP provider when invoked with `--slop`.

## Build

```bash
cargo build --release
```

The binary is named `tsk`.

## Usage

### Normal mode

```bash
tsk                          # list pending tasks
tsk list --all               # include completed
tsk list --tag work          # filter by tag
tsk add "Deploy v2" --due tomorrow --tag work
tsk done 1                   # mark complete
tsk undo 1                   # mark incomplete
tsk edit 1 --title "New title" --due 2026-04-01
tsk delete 1
tsk notes 1                  # show notes
tsk notes 1 --set "New note"
tsk search "work"
tsk export markdown
```

### SLOP mode

```bash
tsk --slop
```

Enters SLOP provider mode: prints a hello message, then listens on stdin for NDJSON messages.

### Options

- `--file <path>` — use an alternate data file (default: `~/.tsk/tasks.json`)
- `TSK_FILE` env var — same as `--file`

## Seed data

On first run, if `~/.tsk/tasks.json` doesn't exist, the tool copies `seed.json` to bootstrap sample data.
