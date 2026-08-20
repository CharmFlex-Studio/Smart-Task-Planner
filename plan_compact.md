# Local AI Task Planner — Product & Implementation Plan

## 1. Product Vision

Build a **fully local, self-hosted web task planner** that focuses on tracking the **evolution of work**, not just whether a task is `TODO` or `DONE`.

The planner should be simpler than Kanban tools such as Jira or Trello.

The central idea:

> **A task manager that remembers where you left off, what changed, what is blocking you, and what you should do next.**

Instead of moving cards across many columns, the user mainly:

1. Creates a task.
2. Adds short progress updates while working.
3. Marks blockers or decisions when useful.
4. Lets the local AI reconstruct context, summarize progress, and suggest reminders.
5. Returns later and immediately sees how to continue.

Everything runs locally:

- Local web frontend.
- Local backend.
- Local SQLite database.
- Local AI model.
- Local reminder scheduler.
- No cloud database.
- No external AI API.
- No account required.
- No internet required after dependencies/models are installed.

---

# 2. Core Product Principles

## 2.1 Progress First

The most important data is not the task's status.

It is the sequence of progress updates.

Example:

```text
Task: Improve Korean live translation

09:30  Started investigating translation delay
10:40  Found that sentence buffering adds ~600 ms
13:20  Reduced buffering window
15:10  Translation is faster but less stable
16:30  Decided to keep partial context for 2 previous segments
17:20  Need to benchmark on lower-end device
```

The timeline should explain the work naturally.

---

## 2.2 Very Few Task States

Avoid large Kanban workflows.

Initial states:

```text
ACTIVE
WAITING
DONE
```

Meaning:

- `ACTIVE` — work can continue.
- `WAITING` — blocked or waiting for someone/something.
- `DONE` — task completed.

The progress timeline explains everything else.

---

## 2.3 One Clear Next Step

Every active task should optionally have exactly one:

```text
Next step
```

Example:

```text
Next: Benchmark translation latency on Pixel 8.
```

This is more actionable than a large nested checklist.

The AI may suggest updating the next step after a progress update, but the user remains in control.

---

## 2.4 AI as an Assistant, Not the Source of Truth

AI should never own the underlying task state.

The database remains deterministic.

AI may:

- summarize,
- classify,
- extract,
- recommend,
- detect stale work,
- suggest reminders.

AI should not silently modify tasks.

For important changes, it should suggest:

```text
Suggested next step:
"Test refresh-token fix against staging"

[Accept] [Edit] [Ignore]
```

---

## 2.5 Low Maintenance

The planner should not become another thing the user needs to manage.

Ideal daily interaction:

```text
Create task
↓
Work
↓
Type one short progress sentence
↓
Continue work
```

Everything else should be derived where possible.

---

# 3. Main Product Concept

The planner revolves around five concepts:

```text
TASK
│
├── Current state
├── Next step
│
├── Progress timeline
│      ├── Progress
│      ├── Decision
│      ├── Blocker
│      ├── Discovery
│      └── Completion
│
├── Momentum / Attention
│
└── AI Memory
       ├── Where I left off
       ├── Daily summary
       ├── Task summary
       ├── Important decisions
       └── What needs attention
```

---

# 4. Core UX

## 4.1 Home / Today Screen

The home screen should answer:

1. What deserves attention?
2. What was I doing?
3. What should I continue?
4. What changed recently?

Example:

```text
Thursday, 20 August

┌──────────────────────────────────────┐
│ AI DAILY BRIEF                       │
│                                      │
│ You progressed 4 tasks yesterday.    │
│ Payment integration is still blocked.│
│ Translation latency improved.        │
│                                      │
│ Suggested focus:                     │
│ Finish translation benchmarking.     │
└──────────────────────────────────────┘


NEEDS ATTENTION

🔴 Payment integration
Blocked for 4 days
Waiting for merchant logs

Next:
Follow up with merchant


🟡 Korean translation latency
No progress for 3 days

Next:
Benchmark on lower-end device


CONTINUE

🟢 Local task planner
Last touched 11 hours ago

Last:
Finished SQLite persistence.

Next:
Implement progress timeline.

[Continue]


ACTIVE TASKS

...
```

The homepage should not primarily look like a board.

---

# 5. Task Detail Screen

The task detail page should be timeline-driven.

Example:

```text
← Improve Korean live translation

ACTIVE
Due: Aug 25

Next:
Benchmark latency on Pixel 8

──────────────────────────────────────

TODAY

09:30
Started investigating translation delay

10:40
💡 Discovery
Sentence buffering adds ~600 ms

13:20
✓ Progress
Reduced buffering window

15:10
⚠ Blocker
Low-end device performance unknown

16:30
◆ Decision
Keep two previous segments as context

──────────────────────────────────────

What changed?

[_________________________________]

Type:
Auto / Progress / Blocker / Decision / Discovery

[Add update]
```

---

# 6. Unique Features

## 6.1 Progress Timeline

Every task maintains a chronological story.

This replaces much of the value normally provided by:

- Kanban movements,
- comments,
- status history,
- activity logs.

Progress updates should be extremely easy to add.

---

## 6.2 "Where I Left Off"

When reopening a task after some time, show a generated resume card.

Example:

```text
WHERE YOU LEFT OFF

Last progress:
Refresh-token race condition was fixed.

Current blocker:
Staging environment is unavailable.

Next:
Verify the fix once staging is deployed.
```

This should be one of the product's key differentiators.

---

## 6.3 One Next Action

Each task may have one current next action.

Examples:

```text
Reproduce the crash on Pixel 8.

Ask backend team for staging credentials.

Benchmark the new model.

Review PR #184.
```

After every meaningful update, local AI can optionally suggest a new next action.

---

## 6.4 Blocker Clock

If a task becomes blocked:

```text
WAITING
Waiting for merchant logs
```

start measuring blocker age:

```text
Blocked for 3d 7h
```

This makes waiting visible without requiring a separate board column.

Potential escalation:

```text
< 1 day     normal
1–3 days    yellow
> 3 days    needs attention
```

These thresholds should eventually be configurable.

---

## 6.5 Momentum

Avoid fake completion percentages like:

```text
73% done
```

Instead derive task momentum.

Possible values:

```text
MOVING
SLOWING
STALLED
BLOCKED
NEW
```

Example heuristic:

```text
MOVING
Updated within 24h

SLOWING
No meaningful update for 2–3 days

STALLED
No meaningful update for >3 days

BLOCKED
Task status = WAITING

NEW
No progress update yet
```

This is deterministic and does not require AI.

---

## 6.6 Progress Update Types

Each update can have a type:

```text
PROGRESS
DECISION
BLOCKER
DISCOVERY
DONE
NOTE
```

The user can choose manually, but `AUTO` should be the default.

AI may classify:

```text
"Waiting for backend to deploy staging"
→ BLOCKER

"Use SQLite because the app is local-only"
→ DECISION

"Refresh API is called twice"
→ DISCOVERY
```

---

## 6.7 Decision Memory

Tasks often contain technical or product decisions that become forgotten.

Example:

```text
Decision:
Use SQLite instead of PostgreSQL because the planner is local-only.
```

The planner should maintain a task-level decision list.

Later:

```text
Why did I choose SQLite?
```

Local AI can answer based only on stored task history.

This turns the planner into lightweight project memory.

---

## 6.8 "What Changed?" View

Instead of only showing the complete task list, show recent changes.

Example:

```text
SINCE YESTERDAY

3 tasks progressed
1 task became blocked
2 tasks have not moved for 5+ days
1 task completed
```

This helps the user understand movement instead of inventory.

---

## 6.9 AI End-of-Day Reconstruction

At the end of a day, local AI summarizes all relevant updates.

Example:

```text
TODAY

Most of your work was focused on the translation pipeline.

You reduced buffering latency and decided to keep two previous
segments as translation context.

The task is now waiting for performance benchmarking on a
lower-end device.

Payment integration remains blocked by merchant logs.

Suggested tomorrow:
1. Benchmark translation.
2. Follow up on merchant logs.
```

Store this summary in the database.

Do not regenerate it every time the page loads.

---

## 6.10 Morning "Resume Work"

The planner can generate a morning briefing:

```text
RESUME WORK

Recommended:
Improve Korean live translation

Last:
Buffer latency was reduced.

Next:
Benchmark on Pixel 8.

Reason:
This was your main active task yesterday and is not blocked.

[Continue]
```

Selection should initially use deterministic scoring.

AI can provide the explanation.

---

## 6.11 Attention Score

Do not rely only on manual priority.

Calculate an attention score from objective signals.

Possible factors:

```text
Manual priority
Due date proximity
Days since last update
Blocker duration
Task age
Recently active task
Task overdue
```

Example concept:

```text
attentionScore =
    dueDateWeight
  + staleWeight
  + blockerWeight
  + priorityWeight
```

Use the score to create:

```text
Needs Attention
```

Do not expose a meaningless numerical score to the user initially.

Show the reason instead:

```text
Needs attention because:
Due tomorrow and no progress for 3 days.
```

---

## 6.12 Progress Heatmap

Add a GitHub-style activity heatmap later.

Each day represents meaningful task activity.

Clicking a day shows:

```text
Aug 20

8 progress updates
3 tasks changed
1 task completed

Main focus:
Local Task Planner
```

This becomes a long-term personal work history.

---

## 6.13 Task Journey Compression

Long-running tasks may accumulate dozens of updates.

Keep recent updates detailed.

Compress older history into AI-generated chapters.

Example:

```text
Week 1
Evaluated multiple ASR architectures and selected Zipformer.

Week 2
Implemented streaming recognition and segment stability logic.

Week 3
Integrated translation and focused on latency reduction.
```

Never delete the raw updates.

Compression is a derived summary only.

---

## 6.14 Outcome Tracking

When completing a task, optionally ask:

```text
What was the result?
```

Example:

```text
Task:
Improve translation latency

Outcome:
Reduced average latency from 1.8 s to ~700 ms.
```

This creates a useful history of accomplishments.

Later the planner can show:

```text
THIS MONTH

Completed 18 tasks

Key outcomes:
• Reduced translation latency by ~61%.
• Shipped offline AI summary.
• Fixed refresh-token race condition.
```

---

## 6.15 AI-Suggested Reminders

AI can detect situations such as:

```text
"Waiting for John to review."
"Check this next week."
"Need to follow up after deployment."
```

It can suggest:

```text
You have been waiting for John for 4 days.

Create reminder for tomorrow morning?

[Create] [Choose time] [Ignore]
```

The actual reminder is created and executed by deterministic local code.

AI does not directly schedule silently.

---

# 7. Search and AI Memory

Eventually add a local query box:

```text
Ask your planner...
```

Example queries:

```text
What am I currently blocked by?

What did I work on last Tuesday?

Why did I choose SQLite?

Which tasks have been inactive this week?

What did I accomplish this month?

Where did I leave off on the translation task?
```

The AI should receive only relevant local data.

Potential later approach:

```text
User question
    ↓
Local search
    ↓
Relevant tasks / progress updates / decisions
    ↓
Local LLM
    ↓
Answer with references to tasks
```

Full vector search is not necessary for MVP.

Start with:

- SQLite FTS,
- task filtering,
- date filtering,
- keyword search.

Add local embeddings only if useful later.

---

# 8. Data Model

## 8.1 Task

```text
Task
──────────────────────────
id
title
description?
status
priority?
nextAction?
createdAt
updatedAt
dueAt?
completedAt?
outcome?
```

Initial status:

```text
ACTIVE
WAITING
DONE
```

---

## 8.2 ProgressUpdate

```text
ProgressUpdate
──────────────────────────
id
taskId
content
type
createdAt
```

Types:

```text
PROGRESS
DECISION
BLOCKER
DISCOVERY
DONE
NOTE
```

Possible later fields:

```text
source
aiClassification
editedAt
```

---

## 8.3 Blocker

For MVP, a blocker may simply be represented by:

```text
Task.status = WAITING
+
latest BLOCKER update
```

Later, if richer blocker history is needed:

```text
Blocker
──────────────────────────
id
taskId
description
startedAt
resolvedAt?
```

Do not create this table until necessary.

---

## 8.4 DailySummary

```text
DailySummary
──────────────────────────
id
date
summary
completedJson
blockedJson
nextActionsJson
generatedAt
modelVersion?
```

---

## 8.5 Reminder

```text
Reminder
──────────────────────────
id
taskId?
message
remindAt
status
createdAt
completedAt?
```

Possible status:

```text
PENDING
TRIGGERED
DISMISSED
DONE
```

---

## 8.6 Decision

Do not create a separate decision table in MVP.

A decision is initially:

```text
ProgressUpdate.type = DECISION
```

If decision querying becomes important, create a derived index later.

---

# 9. Local Architecture

Everything runs on the user's machine.

```text
┌───────────────────────────────────────────────┐
│                    PC                         │
│                                               │
│  Browser                                      │
│  http://localhost:8080                        │
│          │                                    │
│          ▼                                    │
│  React + TypeScript                           │
│          │                                    │
│          │ HTTP / WebSocket                   │
│          ▼                                    │
│  Kotlin / Ktor Backend                        │
│      │          │           │                 │
│      │          │           │                 │
│      ▼          ▼           ▼                 │
│   SQLite    Scheduler    Local AI Engine      │
│                              │                │
│                              ▼                │
│                       llama.cpp / Ollama      │
│                              │                │
│                              ▼                │
│                         Local model           │
│                                               │
└───────────────────────────────────────────────┘

No cloud required.
```

---

# 10. Proposed Technology Stack

## Frontend

```text
React
TypeScript
Vite
Tailwind CSS
shadcn/ui
```

Possible additions:

```text
TanStack Query
React Router
Zustand (only if global state becomes necessary)
```

Avoid over-engineering state management initially.

---

## Backend

```text
Kotlin
Ktor
kotlinx.serialization
```

Database layer options:

```text
Exposed
or
lightweight direct SQLite access
```

Prefer whichever keeps the schema and migrations simple.

---

## Database

```text
SQLite
```

Benefits:

- single local file,
- easy backup,
- no DB service,
- good enough for this workload,
- supports FTS for later search.

---

## Local AI

Initial development:

```text
Ollama
```

Longer-term tighter distribution:

```text
llama.cpp
```

Use an abstraction:

```kotlin
interface LocalAiEngine {
    suspend fun summarizeDay(input: DailySummaryInput): DailySummaryResult

    suspend fun summarizeTask(input: TaskSummaryInput): TaskSummaryResult

    suspend fun classifyProgress(
        content: String
    ): ProgressClassification

    suspend fun suggestNextAction(
        task: TaskContext
    ): NextActionSuggestion

    suspend fun answerPlannerQuestion(
        context: PlannerContext,
        question: String
    ): PlannerAnswer
}
```

Implementations:

```text
OllamaAiEngine
LlamaCppAiEngine
```

---

# 11. AI Output Rules

Always prefer structured JSON from the local model.

Example daily summary response:

```json
{
  "summary": "Most work focused on translation latency.",
  "completed": [
    "Reduced buffering delay"
  ],
  "blockers": [
    "Need low-end device benchmark"
  ],
  "suggestedNextActions": [
    "Benchmark on Pixel 8"
  ]
}
```

Validate every response.

If parsing fails:

1. retry once with stricter instruction,
2. otherwise discard,
3. never corrupt task data.

AI failure should not break the planner.

---

# 12. AI Context Strategy

Do not send the entire database to the model.

For a daily summary:

```text
Today's changed tasks
+
Today's progress updates
+
Current next actions
+
Active blockers
```

For a task resume:

```text
Task title
Description
Last 5–15 updates
Current next action
Status
Relevant older summary
```

For a monthly summary:

```text
Daily summaries
+
Completed task outcomes
```

This keeps inference fast even with years of history.

---

# 13. Reminder System

Reminder scheduling is local and deterministic.

```text
Reminder row
    ↓
Local scheduler
    ↓
Due time reached
    ↓
Notify user
```

Possible notification channels:

1. Browser notification.
2. In-app notification.
3. Native OS notification later.

The Ktor process should own reminder scheduling.

AI only suggests potential reminders.

---

# 14. Daily Workflow

## Morning

Planner opens:

```text
Morning Brief

2 tasks need attention.

Recommended continuation:
Local planner timeline

Next:
Implement progress update API.
```

---

## During Work

User works normally.

Occasionally enters:

```text
Finished progress update API.
```

AI may classify it:

```text
PROGRESS
```

and suggest:

```text
Suggested next:
Connect timeline UI to API.
```

---

## When Blocked

User enters:

```text
Waiting for API credentials from backend team.
```

AI detects:

```text
BLOCKER
```

Planner offers:

```text
Mark task as WAITING?

[Yes] [No]
```

If accepted:

```text
status = WAITING
blocker timer starts
```

---

## Evening

Planner summarizes:

```text
Today

You progressed 5 tasks and completed 1.

Main progress:
Finished the progress API and connected SQLite persistence.

Blocked:
Authentication testing is waiting for credentials.

Tomorrow:
Connect timeline UI.
```

---

# 15. MVP Scope

The MVP should prove the core idea before adding sophisticated AI.

## MVP 1 — Planner Core

Build:

- Create task.
- Edit task.
- Delete/archive task.
- ACTIVE / WAITING / DONE.
- One next action.
- Progress updates.
- Progress timeline.
- Task detail.
- Today/home view.
- SQLite persistence.
- Basic task filtering.
- Basic deterministic stale detection.

Do not add AI yet if it slows down validating the UX.

---

## MVP 2 — Local AI

Add:

- Local model connection.
- Progress type auto-classification.
- Task "Where I Left Off" summary.
- End-of-day summary.
- Suggested next action.
- Extract blockers.
- AI failure handling.
- Store generated summaries.

---

## MVP 3 — Attention & Resume

Add:

- Blocker clock.
- Momentum.
- Attention scoring.
- Needs Attention section.
- Morning Resume Work.
- "What changed?" dashboard.

---

## MVP 4 — Local Reminders

Add:

- Manual reminder.
- Reminder scheduler.
- Browser/in-app notification.
- AI reminder suggestions.
- Follow-up reminders for long blockers.

---

# 16. Later Features

Only add after the main workflow feels good.

Potential later features:

- Projects.
- Tags.
- Attachments.
- Subtasks.
- Recurring tasks.
- Calendar view.
- Keyboard command palette.
- Full-text search.
- AI planner Q&A.
- Progress heatmap.
- Weekly summary.
- Monthly accomplishment summary.
- Journey compression.
- Local embeddings.
- Task relationships.
- Import/export.
- Markdown export.
- Database backup.
- Multiple workspaces.
- PWA support.
- Native tray app/launcher.

---

# 17. Features to Avoid Initially

Do not build:

- Complex Kanban drag-and-drop.
- Custom workflow editor.
- Multiple status columns.
- Sprint planning.
- Story points.
- Team permissions.
- Accounts.
- Cloud sync.
- Comments/mentions.
- Jira-style issue hierarchy.
- Complex subtasks.
- Gantt charts.
- Time tracking.
- Large plugin system.

These features would make the product less distinctive.

---

# 18. Suggested API Design

Initial endpoints:

```text
GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/{id}
PATCH  /api/tasks/{id}
DELETE /api/tasks/{id}

GET    /api/tasks/{id}/updates
POST   /api/tasks/{id}/updates
PATCH  /api/updates/{id}
DELETE /api/updates/{id}

GET    /api/today
GET    /api/attention

POST   /api/ai/tasks/{id}/resume
POST   /api/ai/tasks/{id}/suggest-next
POST   /api/ai/daily-summary

GET    /api/reminders
POST   /api/reminders
PATCH  /api/reminders/{id}
DELETE /api/reminders/{id}
```

Prefer REST initially.

No need for GraphQL.

---

# 19. Suggested Backend Modules

```text
backend/
├── task/
│   ├── Task.kt
│   ├── TaskRepository.kt
│   ├── TaskService.kt
│   └── TaskRoutes.kt
│
├── progress/
│   ├── ProgressUpdate.kt
│   ├── ProgressRepository.kt
│   ├── ProgressService.kt
│   └── ProgressRoutes.kt
│
├── ai/
│   ├── LocalAiEngine.kt
│   ├── OllamaAiEngine.kt
│   ├── LlamaCppAiEngine.kt
│   ├── PromptTemplates.kt
│   └── AiService.kt
│
├── summary/
│   ├── DailySummary.kt
│   ├── SummaryRepository.kt
│   └── SummaryService.kt
│
├── reminder/
│   ├── Reminder.kt
│   ├── ReminderRepository.kt
│   ├── ReminderScheduler.kt
│   └── ReminderRoutes.kt
│
├── attention/
│   ├── AttentionCalculator.kt
│   └── MomentumCalculator.kt
│
└── database/
    ├── Database.kt
    └── migrations/
```

---

# 20. Suggested Frontend Structure

```text
frontend/src/
├── pages/
│   ├── TodayPage.tsx
│   ├── TaskPage.tsx
│   ├── TasksPage.tsx
│   └── HistoryPage.tsx
│
├── components/
│   ├── TaskCard.tsx
│   ├── ProgressTimeline.tsx
│   ├── ProgressComposer.tsx
│   ├── DailyBrief.tsx
│   ├── AttentionCard.tsx
│   ├── ResumeCard.tsx
│   └── ReminderDialog.tsx
│
├── api/
│   ├── taskApi.ts
│   ├── progressApi.ts
│   └── aiApi.ts
│
├── models/
└── hooks/
```

---

# 21. Attention Scoring — Initial Version

Keep it deterministic.

Example:

```text
if overdue:
    +100

if due within 24h:
    +50

if blocked > 3 days:
    +40

if blocked > 1 day:
    +20

if no update > 7 days:
    +30

if no update > 3 days:
    +15

if manually high priority:
    +20
```

Then sort descending.

Do not display:

```text
Attention score = 92
```

Display:

```text
Needs attention

• Due tomorrow
• No update for 4 days
```

---

# 22. Momentum — Initial Version

Example:

```text
if status == WAITING:
    BLOCKED

else if no progress:
    NEW

else if updated < 24h:
    MOVING

else if updated < 72h:
    SLOWING

else:
    STALLED
```

Later, the thresholds can adapt to task type.

---

# 23. Privacy

The planner should be local-first by design.

Rules:

- Never send task data to external APIs.
- No telemetry by default.
- No external AI calls.
- AI runs only on localhost.
- Database stays on local disk.
- Export is user-initiated.
- Model prompts and responses may optionally be inspectable for debugging.
- Network binding should default to `127.0.0.1`, not `0.0.0.0`.

If LAN access is later added, make it explicit.

---

# 24. Backup Strategy

Since all important data lives in SQLite:

```text
planner.db
```

make backup easy.

Initial options:

```text
Export database
Export JSON
Export Markdown
```

Later:

```text
Automatic local backup
```

Example:

```text
backups/
├── planner-2026-08-20.db
├── planner-2026-08-19.db
└── ...
```

---

# 25. Distribution Goal

Eventually the ideal UX is:

```bash
./task-planner
```

Then:

```text
Task Planner running at:
http://localhost:8080
```

The process starts:

- backend,
- SQLite access,
- reminder scheduler,
- AI connection.

Frontend assets are served by the same local server.

Long-term, the local model/runtime may also be bundled or managed by the application.

---

# 26. MVP Success Criteria

The MVP is successful if the following workflow feels better than a basic Kanban tool:

1. Create a task in under 10 seconds.
2. Add a progress update in one interaction.
3. Reopen a task several days later.
4. Understand immediately:
   - what happened,
   - where work stopped,
   - what is blocking it,
   - what to do next.
5. See which tasks deserve attention without manually reorganizing them.
6. Receive an accurate local daily summary.
7. Use the application without internet access.

---

# 27. Main Differentiator

The planner should not compete on:

```text
"Better Kanban"
```

It should compete on:

```text
"Better task memory"
```

Most planners remember:

> You have a task called "Improve translation".

This planner remembers:

> You reduced buffering latency, discovered instability on partial
> sentences, decided to retain two previous segments for context,
> and stopped because you still need a low-end-device benchmark.

That is the core value.

---

# 28. Product Statement

A concise product description:

> **A fully local task planner that remembers the story behind your work.**
>
> Track lightweight progress updates instead of managing complex boards.
> The planner reconstructs where you left off, detects blockers and stale
> work, suggests what deserves attention, and creates private AI summaries
> using a model running entirely on your own machine.

---

# 29. Recommended Build Order

```text
1. Task CRUD
2. Progress updates
3. Timeline UI
4. Next action
5. ACTIVE / WAITING / DONE
6. Today page
7. SQLite persistence
8. Momentum + stale detection
9. Local AI abstraction
10. Where-I-left-off summary
11. Daily summary
12. AI classification
13. Suggested next action
14. Blocker clock
15. Attention view
16. Reminder engine
17. AI reminder suggestions
18. Search/history
19. Weekly/monthly summaries
20. Advanced AI memory
```

Do not start with AI.

The first milestone should prove that the **progress-first interaction model** is useful by itself.

AI should then amplify that workflow rather than define it.

---

# 30. Local AI Model Footprint Strategy

The planner should be designed around a **small local model**, because its AI work is constrained:

- summarize recent task updates,
- classify progress updates,
- identify blockers,
- suggest one next action,
- reconstruct "where I left off",
- produce daily/weekly summaries.

These tasks do not require a large coding/reasoning model.

## 30.1 Initial Model Tiers

Offer three optional local AI tiers.

```text
LIGHTWEIGHT
~0.8B-class Q4 model
Approx. model download: ~0.5–0.8 GB
Approx. active memory: ~1–1.5+ GB
Purpose:
- classification
- simple extraction
- basic short summaries


RECOMMENDED
~2B-class Q4 model
Approx. model download: ~1–1.5 GB
Approx. active memory: ~2–3+ GB
Purpose:
- good task summaries
- blocker extraction
- next-action suggestions
- "where I left off"
- daily summaries


ENHANCED
~4B-class Q4 model
Approx. model download: ~2–3 GB
Approx. active memory: ~3.5–5+ GB
Purpose:
- better instruction following
- more nuanced summaries
- more reliable reasoning across longer task history
- richer planner Q&A
```

These are planning estimates, not hard guarantees.

Actual memory depends on:

- exact model architecture,
- quantization,
- context length,
- KV cache,
- backend,
- batching,
- CPU/GPU offload.

The application must show the actual model download size before installation.

---

## 30.2 Recommended Default

Design and benchmark the product around a:

```text
~2B parameter
4-bit quantized
GGUF model
```

This should be the default tier unless testing shows summary quality is insufficient.

Do not default to 7B/8B-class models.

A larger model should only become necessary if the product expands toward:

- complex cross-project reasoning,
- long conversational planning,
- agentic task decomposition,
- technical reasoning across large histories.

---

# 31. AI Quality Strategy

Model size is only one factor affecting quality.

The planner should make AI tasks easy through **strong context preparation**.

Avoid:

```text
Here are six months of raw updates.
Tell me what happened.
```

Prefer:

```text
TASK
Improve translation latency

STATE
ACTIVE

NEXT ACTION
Benchmark on lower-end hardware.

TODAY'S UPDATES
09:22 Reduced buffering threshold.
11:34 Partial translations became unstable.
13:02 Added two previous segments as context.
15:10 Stability improved.
16:42 Need lower-end-device benchmark.

PREVIOUS SUMMARY
Translation works. Main remaining issue is latency.

RETURN
{
  "summary": "...",
  "accomplishments": [],
  "blockers": [],
  "nextAction": "..."
}
```

## 31.1 Deterministic vs AI Responsibilities

Keep objective signals outside the model.

```text
DETERMINISTIC

Task age
Due date
Overdue state
Days since update
Blocker duration
Task status
Attention scoring
Reminder firing
Task sorting


LOCAL AI

Progress classification
Task summary
Where-I-left-off reconstruction
Next-action suggestion
Daily summary
Decision extraction
Reminder suggestion
Natural-language planner Q&A
```

This improves:

- reliability,
- speed,
- explainability,
- memory usage,
- offline behavior.

---

## 31.2 Context Limits

Do not allocate huge model context windows by default.

Initial target:

```text
4K–8K tokens
```

For task summaries, feed:

```text
Task metadata
Current state
Current next action
Latest relevant updates
Latest task summary
Relevant decisions/blockers
```

For daily summaries, feed:

```text
Tasks changed today
Today's progress updates
Completed tasks
Current blockers
Current next actions
```

For old task histories, use previously stored summaries rather than all raw updates.

Raw progress updates remain stored permanently in SQLite.

---

# 32. AI Runtime Lifecycle and Memory Control

The planner should **not keep the model loaded all day by default**.

Normal state:

```text
Ktor backend     running
SQLite           available
React UI         browser
llama.cpp        stopped
AI model RAM     ~0
```

When AI is needed:

```text
AI request
   ↓
LocalAiRuntimeManager
   ↓
Start llama-server if not running
   ↓
Load model
   ↓
Execute request
   ↓
Store derived result in SQLite
   ↓
Start/reset idle timer
```

After an idle period:

```text
No AI request for configured period
   ↓
Stop llama-server
   ↓
Release model memory
```

Initial default idle timeout:

```text
5 minutes
```

Make it configurable later.

---

## 32.1 Keep-Loaded Setting

For users with sufficient memory:

```text
[ ] Keep Local AI loaded for faster responses
```

Default:

```text
OFF
```

When enabled, the planner keeps the local inference server/model alive while the planner process is running.

This trades:

```text
More RAM
for
Lower AI response startup latency
```

---

## 32.2 Runtime Manager Responsibilities

Implement:

```text
LocalAiRuntimeManager
```

Responsibilities:

- detect OS/CPU architecture,
- locate correct llama.cpp binary,
- detect whether runtime is already running,
- choose an available localhost port,
- start llama-server,
- wait for readiness/health check,
- terminate gracefully,
- force terminate if necessary,
- capture logs,
- detect crashes,
- restart on the next request,
- enforce idle shutdown,
- expose AI status to frontend.

Example statuses:

```text
NOT_INSTALLED
MODEL_NOT_INSTALLED
STOPPED
STARTING
READY
BUSY
STOPPING
ERROR
```

---

# 33. AI Model Installation

Do not bundle multi-GB model files into every application installer.

Bundle or distribute separately:

```text
Task Planner application
+
llama.cpp runtime
```

Then offer model installation from the local web UI.

First-run example:

```text
LOCAL AI

AI processing stays on this computer.

● Recommended
  Good summaries and task understanding
  ~2B-class model
  Download size shown here

○ Lightweight
  Lowest memory use

○ Enhanced
  Better reasoning, higher memory use

[Download & Enable]

[Continue without AI]
```

---

## 33.1 Model Catalog

Store model metadata in a small application-controlled catalog.

Example:

```json
{
  "id": "recommended-v1",
  "tier": "recommended",
  "displayName": "Recommended Local AI",
  "parameterClass": "2B",
  "quantization": "Q4",
  "downloadUrl": "...",
  "sha256": "...",
  "fileName": "planner-model.gguf",
  "minimumContext": 4096,
  "recommendedContext": 8192
}
```

The catalog can initially be bundled with application releases.

Do not require a remote model-registry service.

---

## 33.2 Download Flow

```text
User clicks Download
   ↓
Backend downloads model
   ↓
Stream progress to frontend
   ↓
Save to temporary file
   ↓
Verify checksum
   ↓
Move atomically to models directory
   ↓
Run model smoke test
   ↓
Mark installed
```

Required UI states:

```text
Not installed
Downloading
Verifying
Installing
Ready
Failed
```

Support:

- cancellation,
- retry,
- safe partial-download cleanup,
- enough-disk-space validation.

Resume support is desirable but not required for the first implementation.

---

## 33.3 Model Switching

Settings:

```text
Local AI Model

● Recommended
○ Lightweight
○ Enhanced
```

Switching should:

1. stop current runtime,
2. select installed model,
3. update configuration,
4. start lazily on next AI request.

Do not delete the previous model automatically.

Provide explicit:

```text
Remove model
```

and show reclaimed disk space.

---

# 34. Local Web App Distribution Model

The product is a **native local application whose interface is a web app**.

The user should not need to manually install:

- Java,
- Node.js,
- SQLite,
- Ollama,
- llama.cpp.

Target experience:

```text
Install Task Planner
   ↓
Launch Task Planner
   ↓
Local backend starts
   ↓
Browser opens
   ↓
http://127.0.0.1:<port>
```

The native package contains:

```text
Task Planner launcher/application
Ktor/JVM runtime
Compiled React assets
SQLite support
Platform-specific llama.cpp executable/libraries
```

The AI model is downloaded separately from within the planner.

---

# 35. macOS and Windows Strategy

Use one shared application codebase.

Expected shared areas:

```text
React frontend
Ktor backend
SQLite schema
Task/progress logic
Attention logic
AI prompts
AI API integration
Reminder domain logic
Model catalog
```

Platform-specific code should be isolated behind interfaces.

Example:

```kotlin
interface PlatformService {
    fun appDataDirectory(): Path
    fun runtimeDirectory(): Path
    fun openBrowser(url: String)
    fun platformId(): String
}
```

Possible implementations:

```text
MacPlatformService
WindowsPlatformService
```

---

## 35.1 Initial Supported Platforms

Start with:

```text
macOS Apple Silicon (arm64)
Windows x86-64
```

Later consider:

```text
macOS Intel
Windows ARM64
```

Avoid expanding the platform matrix until the core application is stable.

---

## 35.2 Runtime Bundles

Keep platform-specific llama.cpp runtime packages separate:

```text
runtime/
├── macos-arm64/
│   └── llama-server
│
└── windows-x64/
    └── llama-server.exe
```

The GGUF model should remain platform-independent.

The backend always communicates through a local HTTP interface:

```text
Ktor
  ↓
127.0.0.1:<private-ai-port>
  ↓
llama-server
```

The React frontend should never call llama-server directly.

---

## 35.3 Application Data Directories

Do not store writable application data beside the executable.

Use platform-appropriate user application-data directories.

Conceptually:

```text
TaskPlannerData/
├── planner.db
├── models/
├── backups/
├── logs/
└── config/
```

Resolve the actual platform path through `PlatformService`.

---

## 35.4 Packaging

Build platform packages separately in CI.

Conceptual release pipeline:

```text
Shared source
   │
   ├── macOS CI runner
   │      ├── build frontend
   │      ├── build backend
   │      ├── add macOS llama runtime
   │      ├── package
   │      └── sign/notarize for public release
   │
   └── Windows CI runner
          ├── build frontend
          ├── build backend
          ├── add Windows llama runtime
          ├── package
          └── sign for public release
```

Initial internal/development builds do not need to solve every public-distribution concern immediately.

Public release should eventually include:

```text
macOS
- application signing
- notarization

Windows
- installer/application signing
```

---

# 36. First-Run Experience

First launch:

```text
1. Start local backend.
2. Initialize SQLite database.
3. Open browser.
4. Show onboarding.
5. Let user start immediately without AI.
6. Offer optional local AI installation.
```

Example:

```text
Welcome

Task Planner keeps your task data on this computer.

Local AI is optional.

[Start Planner]

Enable private local AI?
[Install Recommended Model]
[Not Now]
```

AI installation must never block access to basic task-planning functionality.

---

# 37. AI Performance Acceptance Targets

These are product goals rather than hard model guarantees.

The default/recommended model should be considered acceptable when it can reliably:

```text
1. Classify obvious blocker/progress/decision updates.
2. Summarize 5–20 recent task updates without inventing material facts.
3. Identify the current blocker when explicitly present.
4. Produce one sensible next-action suggestion.
5. Reconstruct where work stopped after several days away.
6. Produce a useful daily summary from changed tasks.
7. Return valid structured output consistently.
```

Model selection should be based on an internal planner-specific evaluation set rather than generic benchmark scores alone.

Create a small regression dataset containing realistic task histories and expected outputs.

Test all candidate models against the same dataset before changing the recommended model.

---

# 38. Revised Build Order

```text
CORE PLANNER
1. Project/repository foundation
2. Local Ktor + React application shell
3. SQLite + migrations
4. Task CRUD
5. Task status + next action
6. Progress updates
7. Timeline UI
8. Today/recent-change view
9. Deterministic momentum/stale detection
10. Blocker duration
11. Attention scoring

LOCAL AI FOUNDATION
12. Local AI abstraction
13. Platform/runtime abstraction
14. llama.cpp runtime manager
15. Model catalog
16. Model download/install UI
17. Model verification/smoke test
18. Lazy model startup
19. Idle model unloading
20. Structured AI response validation

AI FEATURES
21. Progress classification
22. Where-I-left-off
23. Suggested next action
24. Daily summary
25. Morning resume
26. Decision memory
27. AI reminder suggestions

REMINDERS
28. Reminder persistence
29. Local reminder scheduler
30. Browser/in-app notifications

HISTORY & QUALITY
31. Search/history
32. Weekly/monthly summaries
33. Journey compression
34. AI regression evaluation

DISTRIBUTION
35. macOS Apple Silicon package
36. Windows x86-64 package
37. First-run onboarding
38. Backup/export
39. Offline/privacy integration testing
40. Public release signing/notarization
```

The implementation should continue to follow one principle:

> **Prove the progress-first planner is useful before relying on AI.**

# 38. Revised Build Order

Use **large vertical slices** rather than many small tickets.

```text
1. Local application foundation
   - React + Ktor shell
   - localhost serving
   - cross-platform app-data paths
   - SQLite + migrations

2. Core progress-first task workflow
   - task CRUD
   - ACTIVE / WAITING / DONE
   - one next action
   - progress updates
   - timeline UI
   - completion outcome

3. Today dashboard and deterministic task intelligence
   - recent changes
   - momentum
   - blocker clock
   - stale detection
   - attention scoring
   - continue / needs-attention sections

4. Local AI runtime and model installation
   - LocalAiEngine abstraction
   - llama.cpp runtime manager
   - macOS/Windows runtime selection
   - model tiers
   - download + checksum verification
   - lazy startup
   - idle unload
   - keep-loaded setting
   - planner-specific model evaluation

5. AI task intelligence
   - progress classification
   - where-I-left-off summary
   - suggested next action
   - decision-aware context

6. Daily guidance and reminders
   - daily summary
   - morning resume
   - reminder persistence
   - local scheduler
   - browser/in-app notification
   - AI reminder suggestions

7. Long-term task memory
   - decision memory
   - full-text search
   - weekly/monthly summaries
   - journey compression
   - history view

8. macOS + Windows desktop distribution
   - macOS Apple Silicon package
   - Windows x86-64 package
   - launcher
   - first-run onboarding
   - optional AI setup

9. Backup, offline/privacy and failure hardening
   - local backup/export/restore
   - offline tests
   - loopback-only validation
   - model/runtime failure handling
   - resource lifecycle testing

10. Production release pipeline
    - macOS signing/notarization
    - Windows signing
    - target-platform CI builds
    - smoke tests
    - release checksums
```

Product checkpoints:

```text
MVP
Steps 1–3

AI Beta
Steps 1–6

Desktop Beta
Steps 1–8

V1
Steps 1–10
```

The implementation should continue to follow one principle:

> **Prove the progress-first planner is useful before relying on AI.**
