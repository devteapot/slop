# tsk - Task Manager CLI with SLOP

A task manager CLI that works normally for humans, and becomes a SLOP provider when invoked with `--slop`.

## Setup

```bash
bun install
```

## Usage

### Normal mode

```bash
# List pending tasks
bun run src/index.ts

# Add a task
bun run src/index.ts add "Review PR" --due tomorrow --tag work

# Complete a task
bun run src/index.ts done 1

# Search
bun run src/index.ts search work

# Export
bun run src/index.ts export markdown
```

### SLOP mode

```bash
bun run src/index.ts --slop                          # Unix socket on /tmp/slop/tsk.sock
bun run src/index.ts --slop --sock /tmp/my-app.sock  # custom socket path
```

Starts a Unix socket provider and an interactive CLI prompt. AI consumers connect via the socket; you interact via stdin/stdout.

### Seed data

On first run, if no `~/.tsk/tasks.json` exists, the seed data from `seed.json` is copied automatically.

### Custom data file

```bash
bun run src/index.ts --file ./my-tasks.json list
TSK_FILE=./my-tasks.json bun run src/index.ts list
```

## Install as binary

```bash
bun link
tsk list
tsk --slop
```
