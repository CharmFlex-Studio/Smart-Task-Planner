# watsmytask — house rules

A local task planner whose database is a folder of markdown files, plus an optional
local-AI chat plugin. TypeScript everywhere: Node + Hono server, React + Vite web.

- **`plan.md` is the spec.** Read the slice you need.
- **`plan_compact.md` is superseded.** It is kept as an idea bank only. Do not implement
  from it — its architecture (SQLite, Kotlin/Ktor, desktop packaging) is not what we build.
- `README.md` explains the design to a newcomer.

## The rules that are not negotiable

1. **The vault stays plain, readable markdown.** No sidecar database. If a feature cannot
   be expressed as files a human can read, or derived at runtime and never stored, it is
   the wrong feature. The moment there is state the `.md` files cannot reconstruct, the
   main advantage of this design is gone. Lanes obey this too: they live in the workspace's
   `board.md`, and a lane a task refers to but the file forgot is merged back in at read
   time so no task can ever become invisible.

2. **Writes are surgical.** Never re-serialize a whole task file. Setting a field rewrites
   only the lines holding that field; setting the description rewrites only the prose
   between the frontmatter and `## Log`; adding a log entry only appends. Unknown frontmatter
   keys, comments and someone's own formatting must survive a round trip. `markdown.ts`
   carries this; keep its round-trip tests green.

3. **Everything derivable is derived at read time.** Momentum, staleness and attention are
   pure functions of the fields, the log, and which lane the board marks as done. Never
   persist them.

4. **One write path.** Every task mutation goes through the seven operations in
   `src/server/tools/index.ts`. The model's schema also carries one read tool that is not
   one of them — `read_attachment`, the only way it can see a file someone attached. It
   reads and never writes, and it was added knowing the cost the rest of this rule
   describes; do not treat it as a precedent for the next one. Routes are thin wrappers; the model calls the same ones.
   Do not add an eighth tool without a strong reason — small models degrade as the tool
   count grows. Lane edits live in `src/server/tools/lanes.ts`, deliberately outside that
   set and deliberately absent from the model's schema: the assistant moves a task between
   the user's columns, it does not restructure the board. Deleting a lane relocates its
   tasks through the task write path first.

5. **Write tools propose, they do not apply.** The model's write calls become diffs the
   user approves. `autoApplyWrites` defaults to off and stays off.

6. **AI is optional.** Nothing in `vault/`, `tools/` or `routes/tasks.ts` may import from
   `ai/`. The planner must be fully usable with no model installed.

7. **Never hardcode a model catalog.** Model families, quant filenames and file sizes come
   from the Hugging Face API at browse time, or from what is on disk. A list of model names
   and sizes written into this repository is stale within months and its numbers are
   guesses. `catalog.ts` may hold the pinned llama.cpp runtime and bare repo *ids* only.

8. **Lanes are free-form, statuses are not a fixed enum.** A task's `status:` is a lane id
   the user chose. Nothing in the codebase may hard-code `active`/`waiting`/`done` or
   branch on a lane's name — ask the board whether a lane is the done lane instead.

9. **A workspace is a folder, all of them alike, and its isolation is structural.** One
   `VaultStore` per workspace, holding only that folder's paths. No workspace is special:
   the id is always a real folder name, never the empty string — that mistake made the
   first workspace unrenamable, because `PATCH /workspaces/` matches no route. Everything downstream — `PlannerTools`,
   `LaneTools`, the chat — is handed one store and therefore *cannot* reach another
   workspace, which is the guarantee the AI scope rests on. Do not add a cross-workspace
   read, a "search everywhere", or a filter-by-workspace parameter on a shared index: the
   moment isolation becomes a check rather than a structure, it is one forgotten `if` away
   from leaking someone's private notes into a chat about work. `Vault` is the only class
   allowed to see more than one, and nothing but the routes and the switcher may hold it.

10. **Loopback only.** The server binds `127.0.0.1`. The only outbound request in the whole
   app is a user-initiated model download. `externalAiBaseUrl()` refuses non-loopback URLs
   — do not relax that. The one exception is `huggingface.ts`, reached only from an
   explicit click in the model picker, and it never sends task data.

11. **The published package is `dist/` and `bin/`, and it runs on plain Node.** `npm run
   build` typechecks, bundles the web app to `dist/web`, then compiles the server to
   `dist/server` with `tsc` + `tsc-alias` (which is what rewrites `@shared/*` into real
   relative paths — an emit without it produces JS that cannot resolve its own imports).
   `tsx` is a dev tool and must never be needed to run the installed command; React is a
   devDependency because Vite has already bundled it, and moving it back to `dependencies`
   quietly triples what a user downloads. Nothing in `dist/` may resolve a path against
   `process.cwd()`: an installed planner is launched from whatever folder the user happens
   to be standing in, so package files are found from `import.meta.url` — that is what
   `static.ts` is for. Keep `files` in package.json in step with anything new that has to
   ship, and check with `npm pack --dry-run` rather than assuming.

## Working style

- Tests beside the code, `*.test.ts`, run by `npm test`. New behaviour gets a test.
- A comment is a comment. The UI writes plain `note` entries; the older log types are still
  parsed so existing vaults round-trip, but do not reintroduce a type picker.
- Every task/board route takes `?ws=`. Omitting it means the *default* workspace, never
  "all of them" — there is no route in this app that reads across workspaces.
- Test threshold boundaries on both sides, and inject `now` rather than reading the clock.
- Immutable updates: return new objects, never mutate in place.
- Small focused files. Comment *why*, not *what*.
