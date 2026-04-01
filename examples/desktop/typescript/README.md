# Pomodoro Timer — Electron + SLOP

A desktop Pomodoro timer that doubles as a SLOP provider. An AI consumer can observe timer state, start/pause sessions, and read session history through a Unix socket.

## Prerequisites

- Node.js 18+
- [bun](https://bun.sh)

## Install

```bash
bun install
```

## Seed data

Copy the sample sessions so the app starts with history:

```bash
mkdir -p ~/.pomodoro && cp seed.json ~/.pomodoro/sessions.json
```

## Run

```bash
bunx electron .
```

## Connect a CLI consumer

```bash
go run ../../../cli --connect /tmp/slop/pomodoro.sock
```

## SLOP provider

The app automatically starts a SLOP provider on launch:

- **Socket**: `/tmp/slop/pomodoro.sock`
- **Discovery**: `~/.slop/providers/pomodoro.json`
- **Capabilities**: state, patches, affordances, attention

The provider exposes timer state, session history, and daily stats. Available actions change based on the current timer phase (idle, working, paused, break).
