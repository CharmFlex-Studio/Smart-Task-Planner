# Smart Task Planner — Plan (v2, markdown-vault edition)

> **`plan_compact.md` is superseded.** It stays in the repo as an idea bank — the progress
> timeline, momentum, "where I left off" and blocker-clock concepts are still good and get
> pulled in later. But its architecture (SQLite, Kotlin/Ktor, three-tier model catalog,
> signed desktop packages) is **not** what we're building. This file is authoritative.

---

## 1. What we're building

A local web planner where **the database is a folder of markdown files**, and an **optional
AI plugin** downloads `llama-server` + a model and runs a chatbot that can read and change
your tasks.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser  http://127.0.0.1:5123                             │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │ Task views           │  │ Chat panel                 │   │
│  │ today / list / detail│  │ "what was I doing?"        │   │
│  └──────────────────────┘  └────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP + SSE
┌────────────────────────▼────────────────────────────────────┐
│  Node server (Hono)                                          │
│                                                              │
│   vault/     parse + index + atomic write + file watcher     │
│   tools/     THE single write path — typed ops               │
│   ai/        plugin: provision · runtime · chat loop         │
└────────────────────────┬────────────────────────────────────┘
          ┌──────────────┴───────────────┐
          ▼                              ▼
  ~/planner-vault/*.md          127.0.0.1:<port> llama-server
  (your files. yours.)          (spawned on demand, killed when idle)
```

Three properties that make this worth building:

1. **The vault is just a folder.** Open it in Obsidian, VS Code, `grep`, or `git`. Delete
   the app and your data is still readable. No export feature needed — it's already exported.
2. **One write path.** The UI and the LLM call the *same* typed operations. The model never
   touches a file directly, so "the chatbot corrupted my tasks" is structurally impossible.
3. **AI is a plugin, not a foundation.** The planner is fully usable with no model installed.

---

## 2. The vault format

One file per task. Frontmatter for structured fields, an append-only `## Log` for the story.

```
~/planner-vault/
├── main/                    a workspace
│   ├── board.md             the lanes, in order, and the workspace's name
│   ├── tasks/
│   │   ├── improve-korean-translation.md
│   │   └── payment-integration.md
│   └── archive/
│       └── 2026-07-ship-offline-summary.md
├── client-work/             every workspace is the same shape
│   ├── board.md
│   ├── tasks/
│   └── archive/
└── .planner/
    ├── config.json          settings
    └── index.json           cache only — safe to delete, rebuilt on boot
```

**Workspaces are folders, and there is no special one.** One `VaultStore` per folder, so
the tools, the board and the chat handed that store can only reach that folder; the
assistant's scope is not a filter over a shared index, because there is no shared index to
filter. An earlier cut let the vault root be a workspace so that nothing had to move — the
result was a vault whose folders did not match each other and a workspace whose id was the
empty string, which made it the one workspace that could not be renamed. Vaults from that
layout are moved into a folder once, on startup, as a recorded, revertable commit.

```markdown
---
lanes:
  - id: "todo"
    name: "To Do"
  - id: "in-progress"
    name: "In Progress"
  - id: "done"
    name: "Done"
    done: true
---
```

Lanes are the user's to name, add, reorder and delete. The `id` is the identity, so a
rename never touches a task file; deleting a lane relocates its tasks first, through the
normal task write path. A `status:` no lane matches still gets a column, merged in at read
time — a task that cannot be seen is a worse failure than an extra column.

```markdown
---
id: 01JQ8ZK3M4N5P6Q7R8S9T0V1W2
title: Improve Korean live translation
status: in-progress            # a lane id from board.md
created: 2026-08-20T09:30:00+08:00
updated: 2026-08-20T17:20:00+08:00
due: 2026-08-25
tags: [translation, latency]
---

Latency on live translation is too high on mid-range devices. This prose is the task's
description, and it is edited in place from the UI.

## Log

- 2026-08-20 09:30 · note · Started investigating translation delay
- 2026-08-20 10:40 · note · Sentence buffering adds ~600 ms
- 2026-08-20 13:20 · note · Reduced buffering window
- 2026-08-20 16:30 · note · Keeping two previous segments as context
```

**Design rules — these are the ones that matter:**

| Rule | Why |
|---|---|
| Log lines follow one strict grammar: `- <date> <HH:mm> · <type> · <text>` | Round-trips losslessly. The UI writes plain comments (`note`); the other types are still parsed so older vaults survive untouched. |
| **Adding an update is a file append**, not a rewrite | Cheapest possible write, and the least likely to lose data if something goes wrong mid-write. |
| **Never rewrite bytes you didn't change** | Frontmatter edits replace only the frontmatter block; log appends touch only the tail; the description body is passed through verbatim. Unknown frontmatter keys are preserved. Someone's hand-written formatting must survive a round trip. |
| Filename is a slug; `id` in frontmatter is the identity | Rename the file freely; links don't break. |
| `id` is a ULID | Sortable by creation, no collisions, no counter to maintain. |
| Everything else (momentum, staleness, attention) is **derived at read time** | Never stored, never stale, no migration. They're pure functions of `updated` + log entries + which lane the board marks done. |

**Concurrency.** Single user, but you will absolutely have the file open in an editor while
the app writes. So: read hash+mtime at load; before writing, re-check; write to a temp file
in the same directory and `rename()` over the target. If the file changed underneath, reject
the write and surface a conflict in the UI rather than clobbering.

**Watching.** `chokidar` on `vault/**/*.md`, 100ms debounce, reparse the changed file, push
to the browser over SSE. Editing a task in Obsidian and watching the web UI update is
roughly a day of work and is the demo that sells the whole design.

**Search.** In-memory substring + fuzzy over titles and log text. At personal scale
(hundreds of tasks) this is sub-millisecond. No FTS, no index, no embeddings. Revisit only
if it ever gets slow, which it won't.

---

## 3. The tools layer — one write path

Every mutation in the system is one of these. The UI calls them. The LLM calls them. There
is no other way to change a file.

```ts
listTasks(filter?: { status?, tag?, q? }): Task[]
getTask(id): Task
searchTasks(query): TaskMatch[]

createTask({ title, status?, due?, tags?, description? }): Task
addLog(id, { type, text, at? }): Task
setField(id, field: 'title'|'status'|'due'|'tags'|'description', value): Task
archiveTask(id): void
```

Seven operations, one setter instead of five. `description` is the file's prose body rather
than a frontmatter key, and gets its own surgical writer; it stays inside `setField` so the
operation count — and so the model's tool count — does not grow.

Lanes have their own small operation set (`createLane`, `updateLane`, `removeLane`,
`reorderLanes`) in `tools/lanes.ts`, and workspaces theirs (`create`, `rename`, `remove`) in
`tools/workspaces.ts`. Both are UI-only and never reach the model's schema, to hold the tool
count down and because restructuring someone's board — or discovering that their other
workspaces exist — is not a thing a 3B model should be able to do. That flatness is deliberate — small models
degrade sharply as the tool count grows, and this same list becomes the LLM's tool schema
in P6 verbatim.

**Every write op is also a dry run.** Each returns `{ result, diff }` where `diff` is the
unified diff it *would* apply. That single design choice gives you the chatbot's confirm-UI
for free (§5) and makes the whole tools layer testable without touching a disk.

---

## 4. The AI plugin

Two jobs, cleanly separable. Ship the first without the second.

### 4.1 Provisioning — "pull llama server and model"

```
POST /api/ai/install  →  SSE progress stream

1. detect platform+arch          darwin-arm64 | win-x64 | linux-x64
2. fetch pinned llama.cpp release asset from GitHub Releases
3. unzip → ~/.planner/runtime/<build>/ , chmod +x
4. fetch GGUF model from a pinned direct URL
5. verify sha256                 both binary and model
6. smoke test                    spawn, /health, one 5-token completion, kill
7. mark ready
```

States surfaced to the UI: `not_installed → downloading → verifying → smoke_testing →
ready`, plus `error`. Support cancel, retry, and cleanup of partial downloads. Resume is
nice-to-have, not required.

**Pin an exact llama.cpp release tag and record the sha256 of every asset.** llama.cpp moves
fast and breaks things; an unpinned "latest" download is a time bomb. Upgrading is a
deliberate PR, never automatic.

### 4.2 Runtime

```
first AI request → spawn llama-server on a free loopback port
                   --model <gguf> --ctx-size 8192 --jinja --port <n>
                 → poll /health until ready (with timeout)
                 → proxy the request
                 → reset idle timer
no request for 5 min → SIGTERM → (SIGKILL after grace) → RAM released
```

Config: `keepLoaded: false` by default, `idleTimeoutMs: 300_000`. Crash detection restarts
on the next request rather than eagerly. Logs captured to `~/.planner/logs/`.

The server talks to it over **OpenAI-compatible `/v1/chat/completions`**, which means the
exact same code path works against an already-running Ollama — useful in dev, and a free
escape hatch for users who already have one.

---

## 5. The chatbot

Standard tool-calling loop against `/v1/chat/completions`, with the §3 tools as the schema.

**The safety design, which is the whole point:**

```
read tools   (listTasks, getTask, searchTasks)   → execute immediately
write tools  (createTask, addLog, setField, ...) → return the DIFF, apply nothing
```

A write tool call renders in the chat as a proposed change:

```
  ┌ proposed change ─────────────────────────────┐
  │ tasks/payment-integration.md                 │
  │                                              │
  │ - status: in-progress                        │
  │ + status: review                             │
  │                                              │
  │   ## Log                                     │
  │ + - 2026-08-20 14:02 · note · Still no logs  │
  │ +   after 4 days, escalating                 │
  └──────────────────────────────────────────────┘
        [Apply]   [Edit]   [Discard]
```

Setting `autoApplyWrites` defaults to **off**. This is what makes an unreliable 4B model
*safe* rather than *scary* — a bad tool call costs you one click, not your data.

**Git as undo.** If the vault is a git repo, every applied change is a commit
(`planner: log "Payment integration"`). Undo is `git revert`. Full history, branchable,
diffable, and under a hundred lines of code. Optional; turning a plain folder into a repo is
one button in the History tab and never happens on its own.

**Model sizing — be honest about this.** Tool calling is substantially harder than
summarizing, and this is the risk that decides whether the chatbot is good:

| Class | Summarize / classify | Tool calling |
|---|---|---|
| ~1–2B | Fine | Unreliable — don't ship it for this |
| **~4B (default)** | Good | Workable with few tools + confirm UI |
| ~7–8B (opt-in) | Very good | Reliably good. ~5 GB Q4, ~6 GB RAM |

Default to 4B, offer 8B as "better, needs more RAM", and **never let the chatbot be the only
way to do anything** — a keyboard command palette does "mark done" or "add a comment"
faster than typing a sentence anyway, and dragging a card is faster still.

---

## 6. Build order

Each phase ends with something you can actually use.

| P | Phase | Status | Done when |
|---|---|---|---|
| **P0** | Scaffold — package.json, tsconfig, Vite, Hono, Vitest | ✅ | `npm run dev` runs both; tests pass |
| **P1** | **Vault read** — parse md → `Task[]`, list + detail with timeline | ✅ | Point it at a folder of hand-written .md files and browse them |
| **P2** | **Vault write** — tools layer, atomic writes, conflict detect, watcher + SSE | ✅ | Verified live: edited a file outside the app, UI updated with no reload |
| **P3** | **Planner UX** — Today view, filters, quick-add, ⌘K palette, search, derived signals | ✅ | **Use it for a week before going further.** |
| **P4** | **AI plugin: provisioning** — model discovery, live HF browse, download, checksums, smoke test, status UI | ✅ verified on darwin-arm64 | Install runs end to end: pinned runtime (checksum-verified) → GGUF → smoke test → `ready` → chat. Model catalog replaced by runtime discovery. |
| **P5** | **Chat, read-only** — chat panel, read tools | ✅ | Verified against qwen2.5:3b: "what am I blocked on?" answered correctly from real files |
| **P6** | **Chat, write tools** — proposals + diff confirm UI, git undo | ✅ | Verified live: model drafted an `add_log` and a `set_field`, both applied only on approval |
| **P7** | Polish — reminders, weekly summaries, packaging | ⬜ not started | |

**What is left before this is finished software**, in priority order:

1. **Verify the AI catalog end to end** (R9) — download each pinned asset once, record the
   real `sha256`, confirm the archive layout still contains `llama-server`. Until then the
   tested path is `PLANNER_AI_BASE_URL` against an existing Ollama.
2. **Dogfood P3 for a week.** Nothing else on this list matters if the plain planner is not
   pleasant to use.
3. Frontend tests. The server has 112; the React layer has none, and the CSS collision in
   R10 is the kind of thing only a rendering test or a human eye catches.
4. P7: reminders, weekly/monthly summaries, journey compression, packaging.

## 7. Risks

| id | Risk | Mitigation |
|---|---|---|
| **R1** | **4B-class tool calling is unreliable.** The chatbot mis-calls, hallucinates task ids, or loops. | Only 7 flat tools; strict JSON-schema-constrained tool arguments; propose-never-apply (§5); resolve tasks by fuzzy title match server-side so the model doesn't have to get an ID right; 8B opt-in tier; the planner works fully without it. |
| **R2** | **Markdown round-trip damage** — the parser mangles a file someone hand-edited. | Surgical writes only: never rewrite regions you didn't change; preserve unknown frontmatter keys and body text byte-for-byte. Golden-file round-trip tests (`parse → serialize` must be identity on a corpus of ugly real files) from P1, not later. |
| **R3** | External edit races the app's write. | Hash+mtime check, temp-file + `rename()`, surface conflicts instead of clobbering. Designed in at P2. |
| **R4** | llama.cpp release churn breaks the bundled binary or the GGUF format. | Pin an exact release tag + per-asset sha256. Upgrades are deliberate PRs. |
| **R5** | Model download URL is behind a license gate → 403 during install. | Only ungated repos in the catalog; verify each URL anonymously before adding it. |
| **R6** | `avengers-12/config.yml` is written for Kotlin/Ktor + Gradle. The loop cannot verify a TS repo as configured. | Rewrite it at P0 — see §8. Until then the loop's `verify` steps will fail loudly (which is correct behaviour, just not useful). |
| **R7** | Scope creep back toward `plan_compact.md`. | §9 is the deferral list. |

---

## 8. Repo tasks before P1

- [ ] **Rewrite `avengers-12/config.yml` for the TS stack** — `verify` becomes
      `npm ci && npm run build && npm test`; drop the Gradle step, the Java runtime block and
      the Gradle cache keys; `gate.deny` keeps `package-lock.json`, adds `vite.config.ts` and
      `tsconfig*.json`; fill in `tests.directory` once P0 lands.
- [ ] **Install `gh`** — the loop's triage and board scripts need it (`brew install gh`).
- [ ] Decide the default vault path (`~/planner-vault`, overridable) and add `.planner/index.json`
      plus `.planner/logs/` to the vault's own `.gitignore`.
- [ ] Node 22 is already installed. Java is no longer needed.

---

## 9. Deliberately deferred

Good ideas from `plan_compact.md` that are **not** in this plan, in roughly the order I'd add
them back:

```
Daily / end-of-day AI summary, stored     (§6.9)   — natural P7, cheap once chat works
"Where I left off" resume card            (§6.2)   — a prompt over the log tail
Attention scoring                         (§6.11)  — derived, easy, but earn it with real usage first
Reminders + scheduler + OS notifications  (§13)    — a whole subsystem; only if you'd actually use it
Journey compression for long tasks        (§6.13)  — only when a task's log stops fitting in context
Progress heatmap                          (§6.12)
Desktop packaging, signing, notarization  (§34–35) — a `npx` / single-binary story is enough for a long time
SQLite anywhere                                    — the vault is the database
```

The one thing to protect: **the vault stays plain, readable markdown.** Every feature above
must be expressible as files a human can read, or derived at runtime and never stored. The
moment there's a sidecar database that the .md files can't reconstruct, the main advantage
of this design is gone.
