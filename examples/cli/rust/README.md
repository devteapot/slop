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
tsk --slop                                # Unix socket on /tmp/slop/tsk.sock
tsk --slop --sock /tmp/my-app.sock        # custom socket path
```

Starts a Unix socket provider and an interactive CLI prompt. AI consumers connect via the socket (NDJSON); you interact via stdin/stdout.

### Options

- `--file <path>` — use an alternate data file (default: `~/.tsk/tasks.json`)
- `--sock <path>` — use an alternate socket path (default: `/tmp/slop/tsk.sock`)
- `TSK_FILE` env var — same as `--file`
- `TSK_SOCK` env var — same as `--sock`

## Seed data

On first run, if `~/.tsk/tasks.json` doesn't exist, the tool copies `seed.json` to bootstrap sample data.
