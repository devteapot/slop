# tsk — Task Manager CLI + SLOP Provider (Python)

A task manager CLI that works normally for humans, and becomes a SLOP provider when invoked with `--slop`.

## Install

```bash
pip install -e .
```

Requires the `slop-ai` SDK. Install it first from the monorepo:

```bash
pip install -e ../../../packages/python/slop-ai
```

## Usage

### Normal CLI mode

```bash
tsk                          # list pending tasks
tsk list --all               # include completed
tsk list --tag work          # filter by tag
tsk add "Review PR" --due tomorrow --tag work
tsk done 1                   # mark complete
tsk undo 1                   # mark incomplete
tsk edit 1 --title "New title" --due today
tsk delete 1
tsk notes 1                  # show notes
tsk notes 1 --set "New notes"
tsk search "work"
tsk export markdown
```

### SLOP provider mode

```bash
tsk --slop                                # Unix socket on /tmp/slop/tsk.sock
tsk --slop --sock /tmp/my-app.sock        # custom socket path
tsk --slop --file /tmp/tasks.json         # custom data file
```

Starts a Unix socket provider and an interactive CLI prompt. AI consumers connect via the socket; you interact via stdin/stdout.

### Data file

Default: `~/.tsk/tasks.json`. Override with `--file` or `TSK_FILE` env var.

On first run, seed data is copied from `seed.json`.
