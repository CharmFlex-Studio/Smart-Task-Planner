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

## Attachments are files in the folder

Paste an image, drop a file in, or use the paperclip in the editor. It lands in the
workspace's own `attachments/` folder and the markdown gets an ordinary link to it:

```markdown
![screenshot.png](attachments/screenshot.png)
[report.pdf](attachments/report.pdf)
```

Open the vault in Obsidian and the images are where the notes say they are. There is no
attachment database, and nothing to export.

Only ordinary image types are shown in place. Everything else is served as a download —
including `.html` and `.svg`, which are documents that can carry script, and an attachment
served inline from this origin would run where the app runs. Uploads are capped at 25 MB,
and a name that already exists is never overwritten.

The assistant **can read** an attachment when the answer depends on it — a log file as
text, a screenshot as a picture — through one extra read tool, `read_attachment`. It is
bounded by the same workspace as everything else and cannot climb out of the folder.

Whether it can see an *image* depends on the model you run: most small local models cannot,
and one that cannot is told the picture could not be shown rather than left to invent what
was in it. Text files work with any model.

Attaching, editing and deleting files stay UI-only, like lane and comment edits.

## Due dates, with or without a time

`due: 2026-08-25` and `due: 2026-08-25T14:30` are both fine. The difference is real: due
*on* a day is not late until the day is over, while due *at* 14:00 is late at 14:01, and
the attention line says so — "Overdue by 1 hour" rather than nothing until midnight. The
time is never defaulted; a date stays a date.

## Comments are yours to fix

Hover a comment to edit or delete it. An edit keeps the entry's own timestamp — it records
when the thing happened, not when the wording was corrected — and rewrites only that
entry's lines.

These live in `src/server/tools/comments.ts`, outside the seven task tools and absent from
the model's schema, for the same reason lane edits are: the assistant can add a comment,
and has no way to go back and rewrite or delete one.

## Rich text, without leaving markdown

Descriptions and comments render markdown: emphasis, inline code, links, nested lists,
checklists, fenced code with its language, quotes, headings and tables.

**The editor renders as you type.** Bold looks bold and headings look like headings in the
box you are typing in, with the markers hidden — except on the line the cursor is on,
where they come back so a stray asterisk is something you can see and fix. Checkboxes tick
with a click, ⌘-click opens a link, Enter carries a list on and a second Enter ends it,
Tab and Shift-Tab change an item's level, and there is a toolbar with shortcuts (⌘B, ⌘I,
⌘E, ⌘K, ⌘⇧8, ⌘⇧7, ⌘⇧L, ⌘⇧.).

Every URL out of a task file — followed from the reading view or ⌘-clicked in the editor —
goes through one validator in `src/web/safe-url.ts`. One, because two that drift apart is
how a `javascript:` link ends up clickable in one of them.

The document the editor holds is the markdown text and nothing else: every effect is drawn
over it and nothing rewrites the buffer, which is what keeps a save surgical. A rich-text
editor that serialised back to markdown would normalise the whole block and quietly
rewrite spacing and formatting you chose.

Ticking a checkbox writes three characters and nothing else, in a description or in a
comment, and lands as an undoable commit like any other edit.

The renderer builds React elements and never HTML, so nothing in a task file can inject
markup into the page — which matters because task files arrive from shared folders, synced
drives and models, none of which are the person reading the screen.

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

**Not a terminal person?** [Download the installer](https://github.com/CharmFlex-Studio/Smart-Task-Planner/releases/latest/download/watsmytask-installer.zip),
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

## Releasing

Bump `version` in `package.json` and merge to `main`. That is the whole procedure.

`.github/workflows/release.yml` runs the tests, builds, publishes to npm, then creates a
GitHub Release with `watsmytask-installer.zip` attached. Merges that do not change the
version do nothing: it checks whether a release already exists for the version in
`package.json`, so it is idempotent and safe to re-run. Pushing a `v*` tag does the same
for an exact commit.

Running it by hand from the Actions tab is a **dry run** unless you tick the **release**
box: it builds everything and attaches the zip to the run, publishing nothing. Tick the
box to publish — useful for retrying a release that failed for a reason outside this
repository. Every run writes a summary saying which of those happened, because a skipped
release and a successful one otherwise look identical from the outside: a green tick and
an artifact.

Publishing to npm uses **trusted publishing** — no token and no secret in this
repository. The job mints a short-lived OIDC token, npm verifies it against a publisher
configured on the package, and every release carries a provenance attestation naming the
workflow and commit that built it.

Configured once, on npmjs.com → the package → **Settings → Trusted Publisher → GitHub
Actions**:

| Field | Value |
|---|---|
| Organization or user | `CharmFlex-Studio` |
| Repository | `Smart-Task-Planner` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |

Also on that page, **Settings → Publishing access** must not be set to *Require
two-factor authentication* — that blocks every automated publish, trusted publishing
included.

That configuration names the workflow **file**, so renaming `release.yml` breaks
publishing until the setting is renamed to match. The job needs `id-token: write`, which
it has, and an npm newer than the one Node 22 ships — the workflow installs `npm@^11.5.1`
before publishing.

If a publish fails with `ENEEDAUTH` or a 404 on `PUT`, both mean the same thing: the
registry did not accept the job's identity. Neither means the package is missing. The
workflow's preflight has already checked everything this repository controls, so the
answer is on npmjs.com.

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

**Whether a model can use tools at all is not a size question.** It is decided by the chat
template the model was packaged with — llama-server runs that template, and one with
nowhere to put a tool call cannot produce one however large the model is. Older Gemma
releases were the common example of that; Gemma 4 has tools in its template and llama.cpp
can parse its format, so this is a question to ask of a specific file rather than a family.

So the picker reads the template out of the `.gguf` itself and says **supports tools** or
**cannot use tools** as a fact about that file. It costs a few milliseconds of header and
no memory, and it is the difference between finding out now and finding out after a 3 GB
download.

**Size still decides how *well* a model uses tools it can use:**

| Class | Summarize | Tool calling, if the template supports it |
|---|---|---|
| under 3B | fine | unreliable |
| 3–7B | good | workable, with the confirm flow |
| 7B and up | very good | reliable; wants ~6 GB free |

That column is a rule of thumb from the parameter count in the name — including MoE
models, judged by their *active* parameters, and Gemma's `E4B` effective-parameter naming.
It is a guess about a size class, and it is shown as **maybe** for models whose template
cannot be read: an external server does not expose one.

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
