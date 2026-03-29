# Contributing to SLOP

Thanks for your interest in contributing to SLOP! Here's how to get started.

## Development setup

```bash
# Clone the repo
git clone https://github.com/devteapot/slop.git
cd slop

# Install dependencies (requires Bun)
bun install

# Run tests
bun test packages/

# Run the Notes SPA example
cd examples/notes-spa && bun run serve.ts

# Run the Kanban board example
cd mvp && bun run demo:web

# Build the extension
cd extension && bun run build.ts
```

## Project structure

- `spec/` — Protocol specification (language-agnostic)
- `packages/` — Publishable npm packages (`@slop-ai/core`, `@slop-ai/react`, `@slop-ai/consumer`)
- `extension/` — Chrome extension
- `desktop/` — Tauri desktop app
- `examples/` — Runnable example apps
- `mvp/` — Prototyping sandbox

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
- Language SDKs (Python, Go, Rust, etc.)
- Example apps showing SLOP integration
- Spec improvements and clarifications
- Documentation fixes

## Code style

- TypeScript for all packages
- No external runtime dependencies in `@slop-ai/core` (browser-only)
- Tests use Bun's built-in test runner (`bun:test`)
- Keep it simple — prefer small, focused changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
