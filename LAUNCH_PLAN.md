# SLOP 1.0 — Open Source Launch Plan

## Context

SLOP has a solid spec (10 docs), a working MVP (9 packages), and a browser extension. The goal is to open-source the project and drive maximum adoption in 2-4 weeks, positioning for acquisition by a major AI player (Anthropic, OpenAI, Google, etc.).

The strategy: ship a compelling 1.0 with clear value over MCP, get featured by tech influencers, build community fast.

## What makes SLOP acquistion-worthy

The pitch to a big player: **SLOP is the missing perception layer for AI agents.** MCP lets AI act. SLOP lets AI see. Whoever owns SLOP owns the standard for how AI understands applications. It's the accessibility tree for the AI era.

Acquisition value comes from:
1. **Protocol adoption** — if apps implement SLOP, the acquirer controls the interface between AI and software
2. **Network effects** — more SLOP apps → more useful AI agents → more SLOP apps
3. **Strategic position** — complements (not competes with) existing tool-calling standards

## 1.0 Feature scope

### Extension (Chrome)
- [x] SLOP-native apps: WebSocket transport (server-backed)
- [x] SLOP-native apps: postMessage transport (SPAs)
- [ ] Compatibility mode: accessibility tree adapter (Tier 3) for non-SLOP apps
- [ ] Bridge mode: expose in-page providers to desktop app via native messaging
- [x] Multi-provider profiles (Ollama, OpenAI, OpenRouter, Gemini)
- [x] Dynamic model selection
- [ ] Stable connection handling (fix disconnect issues)

### Desktop app
- [ ] List and connect to local SLOP providers (Unix socket discovery)
- [ ] Connect to web apps via WebSocket
- [ ] Connect to in-page SPAs via extension bridge (native messaging)
- [ ] Chat UI with model selection
- [ ] System tray / menu bar presence

### OpenClaw integration
- [ ] SLOP provider plugin for OpenClaw — lets OpenClaw observe any SLOP app's state instead of screen scraping
- [ ] OpenClaw skill that connects to SLOP providers and exposes affordances as OpenClaw actions
- [ ] Document how SLOP + OpenClaw work together (OpenClaw = agent, SLOP = perception)

### SDKs (for app developers to adopt SLOP)
- [x] TypeScript/Bun: @slop-ai/types, @slop-ai/provider, @slop-ai/consumer
- [ ] Python: slop-py (provider + consumer)
- [ ] Browser: @slop-ai/provider-browser (postMessage transport, useSlop hook)
- [ ] Documentation site with integration guides

### Spec
- [x] 10 documents covering the full protocol
- [ ] Final review pass for consistency and completeness
- [ ] Version number: 0.1 → 1.0-rc1

## Repo structure for launch

```
slop/                              ← rename from slop-slop-slop
├── README.md                      ← landing page with demo GIF, quick start
├── LICENSE                        ← MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── .gitignore
├── spec/                          ← the protocol spec (language-agnostic)
│   ├── 01-overview.md
│   ├── ...
│   └── 10-desktop-integration.md
├── sdks/
│   ├── typescript/                ← current mvp/packages/{types,provider,consumer}
│   │   ├── packages/
│   │   │   ├── types/
│   │   │   ├── provider/
│   │   │   ├── consumer/
│   │   │   └── provider-browser/  ← NEW: browser build with postMessage + useSlop
│   │   └── package.json
│   └── python/                    ← NEW: Python SDK
│       ├── slop_types/
│       ├── slop_provider/
│       └── slop_consumer/
├── extension/                     ← Chrome extension
├── desktop/                       ← Desktop app (future)
├── examples/
│   ├── kanban-board/              ← current demo-web
│   ├── notes-spa/                 ← current demo-spa
│   ├── todo-cli/                  ← current demo-app + demo-consumer
│   └── agent/                     ← current demo-agent
└── website/                       ← docs site (future, can use GitHub Pages initially)
```

## Implementation plan (2-4 weeks)

### Week 1: Polish + open-source foundation

**Day 1-2: Repo cleanup**
- Restructure repo to the layout above
- Add LICENSE (MIT), CONTRIBUTING.md, CODE_OF_CONDUCT.md, .gitignore
- Add proper metadata to all package.json files (description, license, repository)
- Update README with: hero demo GIF/video, quick start code, installation instructions, architecture diagram
- Final spec review pass — version to 1.0-rc1

**Day 3-4: Fix known issues**
- Fix extension disconnect/reconnect stability
- Fix state sync issue (snapshot vs patch handling)
- Add accessibility tree adapter to extension (Tier 3 compatibility mode) — this is the killer feature for launch since it works on ANY website
- Test extension end-to-end with demo-web and demo-spa

**Day 5: Browser SDK**
- Extract `BrowserSlopProvider` + `useSlop` hook from demo-spa into `@slop-ai/provider-browser` package
- Add Vue composable (`useSlop`) and vanilla JS API (`createSlop`)
- Write integration guide: "Add SLOP to your React app in 5 minutes"

### Week 2: SDKs + OpenClaw + content

**Day 6-7: Python SDK**
- `slop-py` package: types, provider, consumer
- Transport: Unix socket + WebSocket
- Test with a simple Python provider + the extension as consumer
- Publish to PyPI

**Day 8-9: OpenClaw integration**
- Build an OpenClaw skill/plugin that connects to SLOP providers
- OpenClaw can observe any SLOP app's state tree and invoke affordances
- Write a tutorial: "Connect OpenClaw to any SLOP app"
- Submit to ClawHub

**Day 10: Content production**
- Record demo video (2-3 min): show the extension working on a real app, LLM observing + acting
- Write launch blog post: "SLOP: The missing perception layer for AI"
- Prepare Twitter/X thread with key insights + demo clips
- Create GitHub repo description, topics, social preview image

### Week 3: Launch + outreach

**Day 11: Soft launch**
- Push to GitHub (public)
- Publish npm packages (@slop-ai/types, @slop-ai/provider, @slop-ai/consumer, @slop-ai/provider-browser)
- Publish Python package to PyPI
- Submit extension to Chrome Web Store (or provide sideload instructions)

**Day 12-14: Outreach blitz**
- Post on: Hacker News, Reddit (r/programming, r/artificial, r/LocalLLaMA), Product Hunt
- Twitter/X thread from personal account + ask for retweets from AI community
- Direct outreach to influencers (see below)
- Submit to newsletters: TLDR, The Pragmatic Engineer, AI News
- Open GitHub Discussions for community feedback

### Week 4: Community + iterate

- Respond to issues, PRs, and feedback
- Iterate on the spec based on community input
- Start conversations with AI companies (Anthropic, OpenAI, Google) about adoption
- Track metrics: GitHub stars, npm downloads, extension installs

## Influencer / channel targets

**Tier 1 — Tech YouTube (100k+ subscribers, AI/dev focus):**
- Fireship — perfect format for "X in 100 seconds" style coverage
- Theo (t3.gg) — covers new web dev tools, strong opinions
- ThePrimeagen — systems/protocol level, would appreciate the design
- Matt Pocock — TypeScript ecosystem, SDK angle
- AI Jason — AI tools/agents focus

**Tier 2 — Tech Twitter/X (AI builders, high signal):**
- Swyx (@swyx) — AI engineering, coined "AI engineer", would get the MCP comparison
- Simon Willison (@simonw) — AI tools, open source, very influential
- Harrison Chase (LangChain) — agent frameworks, SLOP complements their stack
- Peter Steinberger (@steipete) — OpenClaw creator, direct partnership opportunity
- Devin AI team — SLOP is relevant to their agent-in-browser approach

**Tier 3 — Communities:**
- Hacker News (Show HN post)
- Reddit r/LocalLLaMA (Ollama integration angle)
- Discord: Ollama, LangChain, OpenClaw communities
- Dev.to / Hashnode blog cross-posts

## Messaging / positioning

**One-liner:** "SLOP is a protocol that lets AI see and interact with any application — like the accessibility tree, but for AI agents."

**vs MCP:** "MCP gives AI tools to act. SLOP gives AI eyes to see. They're complementary — SLOP is the perception layer MCP is missing."

**For app developers:** "Add 50 lines of code and any AI agent can understand your app's state and take actions in context."

**For AI companies:** "SLOP standardizes how AI agents perceive application state. Own the standard, own the interface."

## Hacker News launch strategy

HN is the highest-leverage platform. A front-page Show HN can generate 10,000+ repo visits in a day.

### The post

**Title:** `Show HN: SLOP – A protocol for AI to observe and interact with application state`

- Factual, no hype. HN downvotes marketing language.
- URL points to the **GitHub repo**, not a blog post or landing page. HN rewards substance.

**First comment** (posted by you immediately after submission):

Must cover:
1. Who you are (one line)
2. The problem: "AI agents interact with apps through two extremes — screenshots (expensive, lossy) or blind tool calls (no context). SLOP fills the gap."
3. How it differs from MCP: "MCP gives AI tools to act. SLOP gives AI eyes to see. They're complementary."
4. Live demo: link to the Kanban board or a hosted demo
5. What's missing / honest limitations
6. Invite feedback on the spec

HN loves: technical depth, honest trade-offs, solo builders, protocols/standards. SLOP hits all four.

### Timing

- **Tuesday–Thursday, 8–9am EST** — peak HN traffic
- Avoid Mondays (crowded), Fridays (low engagement), weekends
- Avoid days with major tech news (Apple events, big launches)

### What gets upvotes

- **Working demo > pitch deck.** The README GIF must show the full loop: user drags card → LLM sees the change → LLM acts → UI updates. That's the "wow" moment.
- **Spec quality.** HN readers will click into the spec docs. 10 well-written docs = massive credibility.
- **Comparison table.** SLOP vs MCP vs Accessibility APIs in the README gives instant mental model.
- **Local-first / self-hostable.** Ollama integration means no API keys needed to try it. HN loves this.

### What gets you killed

- Vote rings (HN detects and penalizes coordinated upvoting)
- Marketing language ("disrupting", "10x", "AI-powered")
- Broken demo link
- No source code
- Responding defensively to criticism

### Pre-launch prep

1. **README hero section**: GIF showing extension in action (15-20s, no audio)
2. **Zero-friction try-it**: `git clone` → `bun install` → `bun run demo:web` works in under 2 minutes
3. **Extension sideload instructions**: Chrome Web Store takes days, provide manual load steps
4. **Spec is clean and versioned**: linked prominently from README
5. **Seed discussion**: have 3-4 people ready to leave genuine technical *comments* (not upvotes). Early thoughtful discussion signals quality to the HN ranking algorithm.

### README must answer in 10 seconds

1. What is this? → protocol for AI to see app state
2. Why should I care? → screenshots are expensive, tool calls are blind
3. How is it different from X? → comparison table
4. Can I try it now? → yes, 3-step quickstart or live demo link

### Simultaneous cross-posting

Don't rely on HN alone. Post within the same 2-hour window:

| Platform | Format | Angle |
|---|---|---|
| **Hacker News** | Show HN + first comment | Technical protocol design |
| **Twitter/X** | Thread with demo GIF + key insight | "MCP lets AI act. SLOP lets AI see." |
| **Reddit r/programming** | Link post with technical summary | Protocol comparison angle |
| **Reddit r/LocalLLaMA** | Self-post with Ollama focus | "Your local LLM can now see any app" |
| **Dev.to** | Blog post with code examples | Integration tutorial angle |
| **Product Hunt** | Product page (schedule for same day) | "AI assistant for any web app" |

If HN catches, the others amplify. If HN doesn't catch, the others are independent shots on goal.

### The viral hook

The accessibility tree mode (Tier 3) — "install this extension and AI can see ANY website" — is the viral angle. The native SLOP protocol is the long-term value, but "works everywhere without any app changes" is what makes someone click, install, and share. Lead with that in the demo GIF.

### Post-launch HN engagement

- Respond to every comment within the first 2 hours (this keeps the post active in the ranking algorithm)
- Be genuinely receptive to criticism — "good point, I'll add that to the spec" wins more goodwill than defending
- If someone asks a technical question, give a thorough answer with links to the relevant spec doc
- If it hits front page, post an update comment at the 6-hour mark with stats/feedback so far

## Defense against big players copying

**You can't prevent it. You can make it more expensive to compete than to acquire.**

### Ecosystem penetration = moat

| Week | Action | Switching cost created |
|---|---|---|
| Launch | Extension works on any site (Tier 3) | Users depend on the extension |
| Week 1 | npm + PyPI packages published | Developers build on @slop-ai/provider |
| Week 2 | OpenClaw integration live | OpenClaw ecosystem tied to SLOP |
| Week 2 | 2-3 real apps ship SLOP support | Apps would need to support two protocols |
| Week 3 | Community PRs for Go, Rust, Swift SDKs | Multi-language ecosystem |
| Week 4 | Spec governance established | SLOP = the standard, not just a project |

### Strategic outreach to AI companies

Start relationships **before** they think about competing:

- **Week of launch**: Email DevRel at Anthropic, OpenAI, Google: "We built SLOP, the perception complement to tool calling. Here's the spec, here's the adoption. We'd love your input."
- **Frame as collaboration, not competition**: "SLOP + MCP together" not "SLOP vs MCP"
- **Offer spec co-authorship**: If Anthropic wants to influence the spec, let them. Their involvement = their investment in SLOP surviving.

### Spec ownership

- Publish under MIT license (code) + Creative Commons (spec docs)
- Establish a lightweight governance process (RFC-style for spec changes)
- You control the spec repo, the versioning, the roadmap
- Companies can implement freely, but spec evolution is under your stewardship

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| MCP team builds something similar | Ship fast, build community, position as complementary not competitive |
| Low adoption from app developers | The extension's compatibility mode (accessibility tree) works without any app changes — adoption isn't gated on developers |
| Name "SLOP" turns off enterprise | Lean into it — memorable > professional. LAMP, CRUD, REST all sounded weird at first |
| Big player builds their own | That's the acquisition signal — approach them before they build |

## Success metrics (first 30 days)

- 1,000+ GitHub stars
- 500+ npm weekly downloads
- 100+ Chrome extension installs
- 5+ community-contributed issues/PRs
- 2+ tech influencer mentions
- 1+ integration from an existing app/tool

## Files to create/modify

### New files
- `/LICENSE` (MIT)
- `/CONTRIBUTING.md`
- `/CODE_OF_CONDUCT.md`
- `/.gitignore`
- `/sdks/python/` — Python SDK
- `/sdks/typescript/packages/provider-browser/` — Browser SDK with useSlop
- Extension: accessibility tree adapter (Tier 3)

### Files to modify
- `/README.md` — complete rewrite for launch (hero section, quick start, demo)
- All `package.json` files — add description, license, repository
- `/spec/*.md` — final review, version to 1.0-rc1
- Extension: fix disconnect/reconnect stability
- Restructure repo directories

## Verification

Before launch:
1. Fresh clone → `bun install` → `bun test` passes
2. `bun run demo:web` → extension connects → LLM chat works
3. `bun run demo:spa` → extension connects via postMessage → LLM chat works
4. Extension works on a non-SLOP site (accessibility tree mode)
5. Python SDK: `pip install slop-py` → provider + consumer work
6. README quick start code works when copy-pasted
7. Demo video recorded and hosted
