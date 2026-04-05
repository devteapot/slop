# Agent Guide

- This repository is a multi-language monorepo for the SLOP protocol and SDKs.
- Primary stacks are TypeScript/Bun, Go, Rust, Python, plus app/example code.
- Prefer the smallest correct change and keep behavior aligned across SDKs when touching protocol logic.
- `spec/` and `website/docs` are important source-of-truth areas, not just marketing content.

## Repo-Specific Agent Rules

- No repo-local Cursor rules were found in `.cursor/rules/` or `.cursorrules`.
- No repo-local Copilot instructions were found in `.github/copilot-instructions.md`.
- Do not assume ESLint, Prettier, Biome, Ruff, or golangci-lint are enforced here unless you add them intentionally.
- Existing enforcement is mostly build, typecheck, generated-content checks, and tests.

## Workspace Basics

- Use `bun` for root workspace installs and most TypeScript tasks.
- Root workspace packages live under `packages/typescript/`, plus apps, websites, examples, and benchmarks.
- Python SDK lives in `packages/python/slop-ai`.
- Go SDK lives in `packages/go/slop-ai`.
- Rust SDK lives in `packages/rust/slop-ai`.
- Desktop app frontend is in `apps/desktop`; native Tauri code is in `apps/desktop/src-tauri`.
- Chrome extension is in `apps/extension`.
- CLI inspector is Go code in `apps/cli`.

## Core Commands

- Install workspace JS dependencies: `bun install --frozen-lockfile`
- Root TypeScript build: `bun run build`
- Root TypeScript tests: `bun run test`
- List scoped checks for current changes: `bun run preflight --list`
- Run scoped checks for current worktree: `bun run preflight`
- Run scoped checks since a base ref: `bun run preflight --since origin/main`
- Run scoped checks for explicit paths: `bun run preflight --files path/to/file another/path`
- There is no repo-wide `lint` script or repo-wide TS `typecheck` script.

## Single-Test Recipes

- Single Bun test file: `cd packages/typescript/sdk/core && bun test __tests__/tree-assembler.test.ts`
- Another Bun single file example: `cd packages/typescript/adapters/react && bun test __tests__/use-slop.test.tsx`
- TanStack Start single test file: `cd examples/full-stack/tanstack-start && bunx vitest run path/to/test-file.test.ts`
- One Python test file: `cd packages/python/slop-ai && python -m pytest tests/test_server.py`
- One Python test case: `cd packages/python/slop-ai && python -m pytest tests/test_server.py -k test_invoke`
- One Go test: `cd packages/go/slop-ai && go test ./... -run '^TestInvoke$'`
- One Rust test: `cd packages/rust/slop-ai && cargo test test_register_static`
- Root `bun run test` is a loop over publishable TS packages; it is not the right command for a single test.
- If you need a single test case, run the package-local runner and narrow further with Bun test-name filtering if needed.

## App And Site Commands

- Extension typecheck: `cd apps/extension && bun run typecheck`
- Extension build: `cd apps/extension && bun run build`
- Desktop frontend typecheck: `cd apps/desktop && bun run typecheck`
- Desktop web bundle build: `cd apps/desktop && bun run vite:build`
- Desktop full Tauri dev app: `cd apps/desktop && bun run dev`
- Desktop full Tauri build: `cd apps/desktop && bun run build`
- Docs generated-content check: `cd website/docs && bun run check:content`
- Docs build: `cd website/docs && bun run build`
- Landing/demo/playground build pattern: `cd website/<site> && bun run build`
- TanStack Start example build/test: `cd examples/full-stack/tanstack-start && bun run build` and `bun run test`
- Benchmarks: `cd benchmarks/mcp-vs-slop && bun run bench`

## Python Commands

- Install Python SDK in editable mode with test extras: `python -m pip install -e "packages/python/slop-ai[all]"`
- Run Python SDK tests from repo root: `python -m pytest packages/python/slop-ai/tests`
- Run Python SDK tests from package dir: `cd packages/python/slop-ai && python -m pytest tests`
- There is no checked-in Ruff or Black config here.

## Go Commands

- Build Go CLI inspector: `cd apps/cli && go build -o slop-inspect .`
- Run Go CLI inspector: `cd apps/cli && go run .`
- Run Go SDK tests: `cd packages/go/slop-ai && go test ./...`
- Use `go test` as both test and basic compile validation.
- There is no checked-in golangci-lint config.

## Rust Commands

- Run Rust SDK tests: `cd packages/rust/slop-ai && cargo test`
- Build Rust SDK: `cd packages/rust/slop-ai && cargo build`
- Build desktop native side directly if needed: `cd apps/desktop/src-tauri && cargo build`
- CI mainly validates Rust with `cargo test` in `packages/rust/slop-ai` and Tauri build via `apps/desktop`.

## Change-Validation Expectations

- Run the narrowest commands that cover the files you changed.
- If you touch a publishable TS package, at minimum run that package's `bun run build` and relevant `bun test` commands.
- Package-local TS command pattern: `cd packages/typescript/<group>/<pkg> && bun run build` and `bun test`
- If you touch shared protocol behavior, inspect sibling SDKs and update tests/docs as needed.
- If you touch `spec/` or docs generation inputs, run `cd website/docs && bun run check:content`.
- If you touch desktop frontend code, run `cd apps/desktop && bun run typecheck`.
- If you touch extension code, run `cd apps/extension && bun run typecheck`.
- If you touch Python, Go, or Rust SDK code, run that language's package-local tests.
- CI mainly enforces root TS build/test, extension typecheck/build, docs check/build, desktop typecheck plus unsigned Tauri build, and Python/Rust/Go SDK tests.

## TypeScript Style

- Use ESM imports and exports.
- Use `import type` for type-only imports; this pattern is common across the TS packages.
- Node built-ins should use the `node:` prefix.
- Prefer named exports over default exports in library code, and re-export public API from package entrypoints.
- Keep React component files in PascalCase like `TopBar.tsx` and module files in kebab-case like `tree-assembler.ts`.
- Use 2-space indentation.
- Use semicolons, double quotes, and trailing commas in multiline structures when nearby code does.
- Favor explicit public types for package APIs.
- `tsconfig` is strict in the TS packages and desktop app; preserve strict typing.
- Avoid `any` unless the boundary is truly dynamic protocol data, and narrow unknown wire data at the boundary.
- In tests, use Bun's `bun:test` APIs in publishable TS packages.
- Do not add runtime dependencies to `@slop-ai/core` without a strong reason; it is treated as the low-level browser-safe core.

## React And Frontend Style

- Match the established style in each app instead of introducing a new design system.
- Keep side-effect CSS imports separate and obvious.
- Follow existing Zustand store patterns in desktop app code.
- Prefer small components and state transitions over heavy abstractions; avoid premature memoization unless the surrounding code already relies on it.

## Python Style

- Use Python 3.10+ typing syntax throughout.
- Keep `from __future__ import annotations` at the top when needed, use 4-space indentation, and keep stdlib imports before local imports.
- Prefer module, class, and function docstrings for public surfaces.
- Use `dict[str, Any]`, `list[T]`, and `Protocol` patterns rather than untyped containers.
- Keep the runtime dependency surface minimal; the core package intentionally has zero required runtime dependencies.
- Raise specific errors when possible; broad exception handling is acceptable only around connection fan-out, cleanup, or optional dependency boundaries.

## Go Style

- Let `gofmt` decide formatting.
- Follow normal Go naming: exported identifiers in PascalCase, internal helpers in lowerCamelCase.
- Keep `context.Context` as the first parameter in handler-style functions.
- Return `error` values instead of panicking in library code, and use `fmt.Errorf` or structured logging for operational failures.
- Preserve the existing `Handler` and `HandlerFunc` style that mirrors `net/http` patterns.
- Use `map[string]any` only at JSON/wire boundaries.

## Rust Style

- Let `rustfmt` style drive formatting.
- Use `snake_case` for modules and functions and `PascalCase` for types.
- Prefer the crate's `Result<T>` alias and `SlopError` for fallible APIs.
- Use `thiserror`-based typed errors, keep transport-specific code behind feature flags, and avoid new `unwrap()` calls in user-facing fallible paths.
- Re-export stable public surface from `src/lib.rs`.

## Error-Handling Conventions

- Preserve structured protocol errors with codes and messages at transport boundaries.
- Do not crash the whole server because one client connection failed to send.
- Cleanup paths may warn/log and continue.
- User-facing library APIs should prefer returning errors over printing directly.
- When behavior changes, add or update tests that exercise both happy paths and protocol-error paths.

## Cross-Language Consistency

- The same protocol concepts exist in TS, Python, Go, and Rust implementations.
- When changing descriptors, tree assembly, diffing, scaling, consumers, or affordance formatting, check whether the equivalent code exists in the other SDKs.
- Do not update one SDK's protocol semantics casually if the others will drift.
- If semantics intentionally change, update docs in `spec/` and relevant READMEs.

## Generated And Special Files

- `examples/full-stack/tanstack-start/src/routeTree.gen.ts` is generated by TanStack Router; avoid hand-editing it unless the generator workflow requires it.
- `website/docs` content is partially generated; use `bun run check:content` to detect stale generated files.
