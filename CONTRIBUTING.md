# Contributing to SLOP

Thanks for your interest in contributing to SLOP! Here's how to get started.

## Development setup

### JavaScript / TypeScript

```bash
# Clone the repo
git clone https://github.com/devteapot/slop.git
cd slop

# Install dependencies (requires Bun)
bun install

# Run tests
bun test packages/

# Run the Notes SPA example
cd examples/spa/notes && bun run serve.ts

# Run the Kanban board example
cd mvp && bun run demo:web

# Build the extension
cd extension && bun run build.ts
```

### Python

```bash
# Create a virtual environment
cd packages/python
python3 -m venv .venv

# Install in editable mode
.venv/bin/pip install -e slop-ai

# Run tests
.venv/bin/pip install pytest
.venv/bin/pytest slop-ai/tests/
```

### Go

```bash
cd packages/go/slop-ai
go test ./...
```

### Rust

```bash
cd packages/rust/slop-ai
cargo test
```

## Project structure

- `spec/` — Protocol specification (language-agnostic)
- `packages/` — Publishable SDK packages
  - TypeScript: `@slop-ai/core`, `@slop-ai/client`, `@slop-ai/server`, `@slop-ai/react`, `@slop-ai/consumer`, etc.
  - Python: `slop-ai` (in `packages/python/slop-ai/`)
  - Rust: `slop-ai` (in `packages/rust/slop-ai/`)
  - Go: `github.com/slop-ai/slop-go` (in `packages/go/slop-ai/`)
- `apps/` — Standalone consumer applications
  - `extension/` — Chrome extension
  - `desktop/` — Tauri desktop app
  - `cli/` — Go CLI inspector
- `examples/` — Runnable example apps

## How to contribute

### Reporting bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, browser, Bun version)

### Suggesting features

Open an issue describing:
- The use case
- Why existing features don't solve it
- A rough idea of the solution (optional)

### Submitting code

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Run tests (`bun test packages/`)
5. Commit with a clear message
6. Open a pull request

### What we're looking for

- Bug fixes
- New transport implementations
- Framework adapters (`@slop-ai/vue`, `@slop-ai/svelte`, etc.)
- Language SDKs (Swift, C#, etc. — Python, Rust, and Go SDKs already exist)
- Example apps showing SLOP integration
- Spec improvements and clarifications
- Documentation fixes

## Code style

### TypeScript packages
- No external runtime dependencies in `@slop-ai/core` (browser-only)
- Tests use Bun's built-in test runner (`bun:test`)

### Python packages
- Python 3.10+ with type hints throughout
- Zero required dependencies in `slop-ai`
- Tests use pytest
- Pythonic API (decorators, context managers, properties)

### Rust crate
- Core engine has no async runtime dependency (WASM-ready)
- Feature flags for transports (`websocket`, `unix`, `stdio`, `axum`)
- `serde` + `thiserror`

### Go package
- Single external dependency (`nhooyr.io/websocket`)
- `Handler`/`HandlerFunc` mirrors `http.Handler` pattern
- `context.Context` in all handlers
- `net/http` native — `server.Mount(mux)` works with any HTTP framework

### General
- Keep it simple — prefer small, focused changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
