# Pomodoro Timer (PySide6 + SLOP)

A desktop Pomodoro timer that acts as a SLOP provider via Unix socket. AI consumers can observe timer state, start/pause sessions, and read session history.

## Prerequisites

- Python 3.11+
- PySide6
- `slop-ai` SDK (from `packages/python/slop-ai`)

## Install

```bash
uv venv && source .venv/bin/activate
uv pip install -e . -e ../../../packages/python/slop-ai
```

## Seed data

On first run the app copies `seed.json` to `~/.pomodoro/sessions.json` automatically. To reset:

```bash
mkdir -p ~/.pomodoro && cp seed.json ~/.pomodoro/sessions.json
```

## Run

```bash
python3 -m pomodoro
```

The app opens a PySide6 window and starts listening on `/tmp/slop/pomodoro.sock`.

## Connect a SLOP consumer

```bash
slop connect /tmp/slop/pomodoro.sock
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POMODORO_SOCK` | `/tmp/slop/pomodoro.sock` | Unix socket path |
| `POMODORO_FILE` | `~/.pomodoro/sessions.json` | Session data file |
