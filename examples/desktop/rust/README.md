# Pomodoro Timer — Tauri (Rust)

A native desktop Pomodoro timer built with Tauri v2. Acts as a SLOP provider over a Unix socket so AI consumers can observe timer state, start/pause sessions, and read session history.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Tauri CLI v2](https://tauri.app/): `cargo install tauri-cli --version "^2"`
- macOS: `brew install pkg-config` (if not already installed)

## Setup

Seed the session data (optional, provides sample sessions):

```bash
mkdir -p ~/.pomodoro && cp seed.json ~/.pomodoro/sessions.json
```

## Development

```bash
cargo tauri dev
```

## Production build

```bash
cargo tauri build
```

## SLOP integration

The app starts a SLOP provider on launch, listening on `/tmp/slop/pomodoro.sock`. Connect a CLI consumer:

```bash
go run ../../../cli --connect /tmp/slop/pomodoro.sock
```

The provider exposes the full timer state tree, session history, and affordances (start, pause, resume, skip, stop, tag) over NDJSON.
