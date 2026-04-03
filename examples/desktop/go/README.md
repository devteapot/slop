# Pomodoro Timer (Go / Fyne)

A desktop Pomodoro timer that acts as a SLOP provider via Unix socket. AI consumers can observe timer state, start/pause sessions, and read session history.

## Prerequisites

- Go 1.22+
- Fyne system dependencies (see [fyne.io/fyne/v2](https://docs.fyne.io/started/) for OS-specific requirements)
  - macOS: Xcode command line tools
  - Linux: `gcc`, `libgl1-mesa-dev`, `xorg-dev`

## Build

```bash
go build -o pomodoro .
```

## Seed data

```bash
mkdir -p ~/.pomodoro && cp seed.json ~/.pomodoro/sessions.json
```

## Run

```bash
./pomodoro
```

The SLOP provider starts automatically on `/tmp/slop/pomodoro.sock`.

## Connect a CLI consumer

```bash
go run ../../cli/go --connect /tmp/slop/pomodoro.sock
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POMODORO_FILE` | `~/.pomodoro/sessions.json` | Session data file path |
| `POMODORO_SOCK` | `/tmp/slop/pomodoro.sock` | Unix socket path |

## Design

Follows DESIGN.md: dark theme (#111319), neon green (#91db37) accent, monospace timer digits, card-based session list.

Note: Uses system fonts as fallback. For full design fidelity, bundle Space Grotesk and JetBrains Mono as Fyne resources.
