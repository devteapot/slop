# SLOP 1.0 — Pre-Launch Verification Checklist

Run through every item before going public. One broken install path on launch day undoes all the marketing work.

---

## 1. Git & Repo Hygiene

- [ ] Squash to clean initial commit (`git checkout --orphan launch && git add -A && git commit -m "Initial release" && git branch -M main`)
- [ ] Verify no secrets, tokens, or private paths leaked in any file (`grep -r "secret\|token\|password\|apikey\|\.env" --include="*.ts" --include="*.py" --include="*.go" --include="*.rs" --include="*.json" --include="*.toml"`)
- [ ] Verify `.gitignore` excludes `node_modules/`, `dist/`, `target/`, `__pycache__/`, `.env`, `*.lock` (decide if `bun.lock` stays)
- [ ] Verify no large binaries or build artifacts in git history (check repo size after squash)
- [ ] LICENSE file exists and reads MIT
- [ ] CONTRIBUTING.md exists and has useful content
- [ ] Social preview image set in GitHub repo settings (owl logo + tagline)
- [ ] GitHub topics added: `ai`, `protocol`, `llm`, `agent`, `state-management`, `open-source`
- [ ] GitHub repo description set: "A protocol for AI to observe and interact with application state"
- [ ] Verify repo URL matches all package.json/pyproject.toml/Cargo.toml/go.mod references (`github.com/devteapot/slop`)

---

## 2. Spec Verification

- [ ] All 14 spec docs render correctly on GitHub (tables, code blocks, diagrams)
- [ ] All internal cross-references resolve (e.g., `./messages.md`, `../extensions/async-actions.md`)
- [ ] Read each spec doc top to bottom — flag any TODO/FIXME/placeholder text
- [ ] Verify spec/core/: overview.md, state-tree.md, affordances.md, transport.md, messages.md, attention.md (6 docs)
- [ ] Verify spec/extensions/: async-actions.md, content-references.md, scaling.md (3 docs)
- [ ] Verify spec/integrations/: adapters.md, agents.md, desktop.md, openclaw.md, web.md (5 docs)
- [ ] Confirm total = 14 docs as claimed in launch copy

---

## 3. TypeScript Packages (10 packages under @slop-ai/*)

For **each** package, run these checks:

### @slop-ai/core
- [ ] `cd packages/typescript/core && bun install && bun run build` succeeds
- [ ] `bun test` passes (if tests exist)
- [ ] `dist/` contains `index.js` + `index.d.ts`
- [ ] Dry-run publish: `npm pack --dry-run` — verify contents look right

### @slop-ai/client
- [ ] `cd packages/typescript/client && bun install && bun run build` succeeds
- [ ] `bun test` passes
- [ ] Depends on `@slop-ai/core` — verify it resolves

### @slop-ai/server
- [ ] `cd packages/typescript/server && bun install && bun run build` succeeds
- [ ] `bun test` passes
- [ ] Verify all transport exports work: `./node`, `./bun`, `./stdio`

### @slop-ai/consumer
- [ ] `cd packages/typescript/consumer && bun install && bun run build` succeeds
- [ ] `bun test` passes

### @slop-ai/react
- [ ] `cd packages/typescript/react && bun install && bun run build` succeeds
- [ ] Verify `react` is a peer dependency (not bundled)

### @slop-ai/vue
- [ ] `cd packages/typescript/vue && bun install && bun run build` succeeds
- [ ] Verify `vue` is a peer dependency

### @slop-ai/solid
- [ ] `cd packages/typescript/solid && bun install && bun run build` succeeds
- [ ] Verify `solid-js` is a peer dependency

### @slop-ai/angular
- [ ] `cd packages/typescript/angular && bun install && bun run build` succeeds
- [ ] Verify `@angular/core` is a peer dependency

### @slop-ai/tanstack-start
- [ ] `cd packages/typescript/tanstack-start && bun install && bun run build` succeeds
- [ ] Verify server export works: `import {} from '@slop-ai/tanstack-start/server'`

### @slop-ai/openclaw-plugin
- [ ] `cd packages/typescript/openclaw-plugin && bun install && bun run build` succeeds

### Cross-package
- [ ] Run full build from root: `bun run build` — all 10 packages build in correct order
- [ ] Run full test suite from root: `bun run test` — all tests pass
- [ ] All packages at version `0.1.0` — verify consistency
- [ ] All package.json files have correct `repository`, `license`, `description` fields
- [ ] npm org `@slop-ai` is registered and you have publish access
- [ ] Dry-run publish all: `for d in packages/typescript/*/; do (cd "$d" && npm pack --dry-run); done`

---

## 4. Python Package (slop-ai)

- [ ] `cd packages/python/slop-ai`
- [ ] `pyproject.toml` has correct metadata (name, version, description, license, URLs)
- [ ] Package name on PyPI is available (`slop-ai`) — check https://pypi.org/project/slop-ai/
- [ ] `pip install -e .` works in a clean venv
- [ ] `python -m pytest tests/` passes
- [ ] Build: `python -m build` produces `.whl` and `.tar.gz`
- [ ] Dry-run upload: `twine check dist/*`
- [ ] PyPI credentials/token ready

---

## 5. Rust Crate (slop-ai)

- [ ] `cd packages/rust/slop-ai`
- [ ] `Cargo.toml` has correct metadata (name, version, description, license, repository)
- [ ] Crate name on crates.io is available — check https://crates.io/crates/slop-ai
- [ ] `cargo build` succeeds
- [ ] `cargo test` passes
- [ ] `cargo clippy` passes with no warnings
- [ ] `cargo doc --no-deps` generates docs without errors
- [ ] Dry-run publish: `cargo publish --dry-run`
- [ ] crates.io token ready

---

## 6. Go Module (slop-ai)

- [ ] `cd packages/go/slop-ai`
- [ ] `go.mod` has correct module path (should match `github.com/devteapot/slop/packages/go/slop-ai` or similar)
- [ ] `go build ./...` succeeds
- [ ] `go test ./...` passes
- [ ] `go vet ./...` passes
- [ ] Module is taggable: decide on tag format (e.g., `packages/go/slop-ai/v0.1.0` or top-level `v0.1.0`)
- [ ] Verify `go install` path works after push

---

## 7. Chrome Extension

- [ ] `cd extension && bun install && bun run build` (or equivalent)
- [ ] `dist/` contains valid extension files (manifest.json, popup, background, content scripts)
- [ ] Sideload in Chrome: chrome://extensions → Load unpacked → select `extension/dist/`
- [ ] Extension detects a running SLOP provider (test with one of the examples)
- [ ] Extension can subscribe to state and display the tree
- [ ] Extension can invoke affordances
- [ ] Sideload instructions are clear in extension/README.md or main README
- [ ] Note in README: Chrome Web Store submission takes days — sideload is the launch-day path

---

## 8. Examples

### CLI Task Manager (examples/cli/)
- [ ] Bun implementation: `cd examples/cli/bun && bun install && bun run slop` works
- [ ] Python implementation: runs and exposes SLOP tree over Unix socket
- [ ] Go implementation: runs and exposes SLOP tree over Unix socket
- [ ] Rust implementation: runs and exposes SLOP tree over Unix socket
- [ ] All four implementations expose the **same** SLOP tree structure (verify node types, IDs)
- [ ] Consumer can connect to each and see state + invoke affordances

### Notes SPA (examples/spa/notes/)
- [ ] `bun install && bun run dev` starts the app
- [ ] SLOP provider is active (check meta tag or postMessage)
- [ ] Extension connects and shows state tree
- [ ] Creating/editing notes shows up as patches in the extension

### TanStack Start App (examples/full-stack/tanstack-start/)
- [ ] `bun install && bun run dev` starts the app
- [ ] Both server-side and client-side SLOP work
- [ ] Extension connects and shows full state

---

## 9. README Polish

- [ ] Hero GIF/video at the top (15-20s showing user action → AI sees state → AI invokes affordance → state updates)
- [ ] "What is this?" answered in the first paragraph
- [ ] "Why should I care?" answered in the second paragraph
- [ ] Comparison table is accurate and up to date
- [ ] Quick start code blocks: copy-paste each one into a fresh project and verify they work
- [ ] `bun run demo` script exists in root package.json and runs a working example
- [ ] All spec links point to correct paths (spec/core/, spec/extensions/, spec/integrations/)
- [ ] All SDK links point to existing packages
- [ ] All badge images render (if any)
- [ ] No broken links (run a link checker or manually verify)

---

## 10. Publishing Sequence (do this in order on launch day)

### Phase 1: Publish packages (do this BEFORE making repo public)
- [ ] `npm publish` for all 10 @slop-ai/* packages (core first, then the rest)
- [ ] `twine upload dist/*` for Python
- [ ] `cargo publish` for Rust
- [ ] `git tag` for Go module + `git push --tags`
- [ ] Wait 5 minutes, then verify each install works from a clean environment:
  - [ ] `npm install @slop-ai/core` → resolves
  - [ ] `npm install @slop-ai/react` → resolves
  - [ ] `pip install slop-ai` → resolves
  - [ ] `cargo add slop-ai` → resolves
  - [ ] `go get <module-path>` → resolves

### Phase 2: Make repo public
- [ ] Flip repo to public on GitHub
- [ ] Verify README renders correctly on github.com
- [ ] Verify all links work from the public URL
- [ ] Click through every spec doc on github.com

### Phase 3: Post (follow LAUNCH_PLAN.md timing)
- [ ] Submit Show HN + first comment
- [ ] T+15min: Twitter/X thread
- [ ] T+30min: r/programming + r/LocalLLaMA
- [ ] T+45min: LinkedIn

---

## 11. Emergency Kit

Have these ready before posting:

- [ ] Quick-fix branch for any broken links or typos (can push without re-publishing packages)
- [ ] npm token and PyPI token accessible (not locked in a vault you can't reach from your phone)
- [ ] Know how to `npm deprecate` a broken package version if needed
- [ ] Know how to yank a Rust crate version if needed
- [ ] Phone with GitHub/Twitter/Reddit/LinkedIn/HN logged in for rapid response
- [ ] 2-hour block of uninterrupted time after posting for HN engagement
