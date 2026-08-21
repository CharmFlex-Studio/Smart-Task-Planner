# watsmytask

A local task planner whose **database is a folder of markdown files**, with an **optional
local-AI chat** that can read your tasks and draft changes for you to approve.

Nothing leaves your machine. There is no account, no cloud, and no telemetry. The one time
the app touches the network is when *you* ask it to download a model.

```
~/watsmytask-vault/
├── main/              a workspace: its own board, its own tasks
│   ├── board.md       the columns, in order, and what this workspace is called
│   ├── tasks/
│   │   ├── improve-korean-translation.md
│   │   └── payment-integration.md
│   └── archive/
├── client-work/       every other workspace is the same shape
│   ├── board.md
│   ├── tasks/
│   └── archive/
└── .planner/          settings + caches (safe to delete)
```

```markdown
---
id: 01JQ8ZK3M4N5P6Q7R8S9T0V1W2
title: Improve Korean live translation
status: in-progress
created: 2026-08-14T09:30:00+08:00
updated: 2026-08-20T21:31:33+08:00
due: 2026-08-25
---

Live translation lags badly on mid-range phones. Target is under 400 ms end to end
on a Pixel 6a.

## Log

- 2026-08-14 09:30 · note · Started investigating translation delay
- 2026-08-15 10:40 · note · Sentence buffering adds ~600 ms
- 2026-08-19 16:30 · note · Keeping two previous segments as context
```

The prose under the frontmatter is the task's description. `status:` holds a lane id from
`board.md`, which is the whole of the board's structure:

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

Rename a lane and only that file changes — the id is the identity, so no task is touched.
Delete a lane and its tasks are moved somewhere you choose before it goes. Put a
`status:` in a task by hand that no lane matches and the column appears anyway, because a
task that cannot be seen is worse than a column you did not ask for.

## Workspaces

A workspace is a folder, and they are all the same shape — there is no special first one.
Make one in the app or in Finder (a folder with a `tasks/` in it is a workspace the next
time the planner looks) and it gets its own board, its own lanes and its own cards.
`board.md` carries the name, so renaming a workspace rewrites one line and never moves a
folder or touches a task.

A vault from before workspaces existed — `tasks/`, `archive/` and `board.md` at the top —
is moved into a folder once, on the first start, keeping whatever the board called itself.
The files are moved, never rewritten, never onto anything already there, and the move is a
commit in History with an Undo next to it.

**The assistant only ever sees the workspace you are in.** Not as a filter it applies, but
because it is handed that one folder's store and has no reference to any other: it cannot
list, search, read or write across the boundary, and it is not told the other workspaces
exist. Ask it about work in another workspace and the honest answer it has is "not in this
one". The chat panel says which workspace it is reading, in the panel, where you can see it
while you type.

Open that folder in Obsidian, VS Code, or `grep`. Delete the app and your data is still
readable. There is no export feature because there is nothing to export from.

## Install it

**Not a terminal person?** Download the installer zip from the
[latest release](https://github.com/CharmFlex-Studio/Smart-Task-Planner/releases/latest),
unzip it, and double-click the one for your computer. It checks whether you have Node,
offers to install it if you do not, sets up watsmytask, and leaves you a launcher in your
Applications folder (macOS) or on your Desktop (Windows). No administrator password, and
nothing lands outside your own user folder. [Step-by-step, with the security prompts you
will see](setup/README.md).

**Already have [Node 20.11+](https://nodejs.org)?** Then it is one command:

```bash
npx watsmytask                  # try it, nothing installed permanently
```

```bash
npm install -g watsmytask
watsmytask                      # http://127.0.0.1:5123, opens your browser
```

```
-p, --port <number>   Port to listen on          (default 5123)
    --vault <path>    Folder to keep tasks in    (default ~/watsmytask-vault)
    --no-open         Do not open the browser
-h, --help            Show all options
```

## Work on it

```bash
npm install
npm run dev            # http://127.0.0.1:5173  (server on 5123)
```

```bash
npm run build && npm start    # one process, http://127.0.0.1:5123
```

`npm run build` does three things: typechecks, builds the web app into `dist/web` with
Vite, and compiles the server into `dist/server` with `tsc`. The published package is that
`dist/` plus `bin/` — no `tsx` at run time, and no React in the dependency tree, because
the frontend is already bundled.

| Variable | Default | What it does |
|---|---|---|
| `WATSMYTASK_VAULT` | `~/watsmytask-vault` | Where your markdown lives |
| `WATSMYTASK_HOME` | `~/.watsmytask` | Downloaded runtime, models, logs |
| `WATSMYTASK_PORT` | `5123` | Server port (always bound to `127.0.0.1`) |
| `WATSMYTASK_AI_BASE_URL` | — | Use an OpenAI-compatible server you already run, e.g. `http://127.0.0.1:11434/v1` for Ollama. **Loopback addresses only** — a remote URL is refused. |
| `WATSMYTASK_AI_MODEL` | `local` | Default model name for that server. A model picked in Settings overrides it. |

The `PLANNER_*` names this app used before it was called watsmytask are still read, so an
existing shell profile keeps working. A folder you already have — `~/planner-vault`, or a
`~/.planner` full of downloaded model — keeps being used exactly where it is; the new
names are only what a fresh machine gets.

## Three ideas the design rests on

**1. The vault is just a folder.** Everything derivable — momentum, staleness, what needs
attention — is computed at read time and never stored. There is no cached signal
that can disagree with the files, and no migration to run when the rules change.

Writes are *surgical*: setting a field rewrites only the lines holding that field, and
adding a log entry only appends. Bytes we did not mean to change are provably unchanged, so
your hand-written formatting, comments and unknown frontmatter keys all survive. A file
watcher picks up edits made outside the app and pushes them to the open tab.

**2. One write path.** Seven typed operations (`createTask`, `addLog`, `setField`, …) are
the only things that touch a task file, and they are always bound to one workspace. The UI calls them and the LLM calls the same ones,
so "the chatbot corrupted my vault" is not a failure mode that exists. Lane edits are a
separate, small set of operations the model is deliberately not given: it can move a task
between your columns, but it cannot restructure your board.

Every write operation doubles as a dry run, returning the unified diff it *would* apply.

**3. AI is a plugin.** The planner is complete without it. Install a model and you get a
chat panel; skip it and the only difference is that the panel offers to install one.

## The chat, and why it is safe

```
read tools   (list, get, search)          → execute immediately
write tools  (create, log, set, archive)  → return a DIFF, apply nothing
```

A write tool call arrives in the chat as a proposed change to a specific file, with
**Apply / Discard** beside it. Nothing has touched the disk when you see it.

This is what makes a small local model *useful* rather than *risky*. A 3B model will
sometimes pick the wrong task or the wrong lane; the cost of that is a diff you decline. Auto-apply exists as a setting and defaults to off, where it should stay.

Applying re-runs the tool rather than replaying the stored patch — if the file moved on in
the meantime, the server refuses and shows you the updated diff instead of overwriting work
it never saw.

**Model sizing, honestly:** summarizing is easy and tool calling is hard.

| Class | Summarize | Tool calling |
|---|---|---|
| under 3B | fine | unreliable |
| 3–7B | good | workable, with the confirm flow |
| 7B and up | very good | reliable; wants ~6 GB free |

Every model in the picker carries that label, worked out from the parameter count in its
name — including MoE models, judged by their *active* parameters, and Gemma's `E4B`
effective-parameter naming. It is a rule of thumb about a size class, not a measurement of
that particular model, and the UI says so on hover.

The command palette (`⌘K`) exists so the chatbot is never the fastest way to do a simple
thing. "Mark X done" should be two keystrokes, not a sentence and a model round-trip.

## Choosing a model

Two honest answers to "which model", so there are two panels in Settings.

**One you already have.** Point the planner at an OpenAI-compatible server you run and it
lists what that server is serving:

```bash
ollama pull qwen3.5:4b
WATSMYTASK_AI_BASE_URL=http://127.0.0.1:11434/v1 npm start
```

Pull anything and it shows up in the picker. Nothing to download twice, no process for the
planner to manage.

**One to download.** Search Hugging Face from inside the app. Repositories, quantizations
and byte sizes are read from the API as you browse, so the size shown before you commit to
a multi-gigabyte download is the real one, and the list can never go stale.

There is deliberately **no hardcoded model catalog**. An earlier version had one — two
models with filenames and sizes typed in by hand — and it was out of date within months,
listing families that had been superseded and sizes nobody had verified. `catalog.ts` now
holds only the pinned llama.cpp runtime (which genuinely must be pinned) and a handful of
repo *ids* as starting points. Everything else is looked up live.

## Git as undo

If the vault is a git repo, every applied change becomes a commit and the History tab lists
them with an Undo button. The tab offers a single button to turn the folder into a
repository if it is not one yet; we never run `git init` on your folder without being
asked. Optional — a plain folder works identically, minus the history.

## Layout

```
src/
├── shared/types.ts        the server ↔ UI contract
├── server/
│   ├── vault/             markdown parse/serialize, lanes, workspaces, atomic writes
│   ├── tools/             THE seven operations, plus lane edits. Every write goes here.
│   ├── ai/                catalog · download · runtime · chat loop   (all optional)
│   ├── routes/            thin HTTP wrappers over the tools
│   ├── cli.ts             the installed `watsmytask` command
│   ├── static.ts          serves dist/web, resolved from the module and never the cwd
│   └── today.ts           the deterministic home-screen grouping
└── web/                   React + Vite
```

The most safety-critical file is `src/server/vault/markdown.ts`. Read its header comment
before changing it, and keep `markdown.test.ts` green — the round-trip tests there are what
stand between a hand-edited file and silent data loss.

## Tests

```bash
npm test
```

238 tests. The ones that matter most: markdown round-trip fidelity, the threshold
boundaries on every derived signal, workspace isolation (what the model is shown and what
it can reach, from both sides of the boundary), lane deletion never stranding a task,
atomic-write conflict detection, proposal staleness, the loopback-only network guard, and
path-traversal rejection in the model resolver.

## Where things live

```
~/watsmytask-vault/          your tasks. the only thing that matters.
~/.planner/
├── models/               downloaded .gguf files
├── runtime/b10516/       llama-server + its shared libraries
└── logs/                 llama-server.log
```

Models and runtime live **outside** the vault on purpose, so multi-gigabyte binaries never
land in your notes folder or a git history. Everything under `~/.planner` is a cache: delete
it and the planner still works, minus the AI.

Using Ollama instead? Then the models are Ollama's, in `~/.ollama/models`, and the planner
downloads nothing at all.

## If llama.cpp is not downloaded

Nothing breaks. `state` is `not_installed`, the chat panel says so and links to Settings,
and the planner is entirely usable. Chat returns a `400 ai_unavailable` with a message
rather than a stack trace.

You never download llama.cpp separately: the first model install fetches the pinned runtime
first (11 MB), then the model. If the runtime step fails, it fails *before* the multi-
gigabyte download starts, so a bad pin costs you seconds rather than a wasted 3 GB.

## Known gaps

- **GGUF downloads are unverified.** Hugging Face publishes no checksum to compare against,
  so a model download completes but is reported as UNVERIFIED. The llama.cpp runtime *is*
  checksum-verified against digests recorded by downloading each asset once.
- **Only `darwin-arm64` has been run end to end.** The other three platform entries have
  correct URLs and real recorded digests, but the extract-and-launch path has only been
  executed on Apple Silicon.
- **Sub-3B models will claim to have done things they have not.** Observed with a 2B: it
  read a task, then said "I've drafted a progress note" without ever calling the write
  tool, so no diff card appeared. Nothing was written — but nothing was drafted either. The
  picker labels this tier `unreliable` for exactly this reason.
- No reminders, no weekly/monthly summaries, no desktop packaging. See `plan.md`.
