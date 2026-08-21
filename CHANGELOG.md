# Changelog

What changed for someone using watsmytask. The release workflow reads the section matching
the version being released and puts it in the release notes, so a version with no section
here ships without a "what's new" — keep it up to date as part of the version bump.

## 0.5.1

**The assistant reaches for its tools far more readily.** It used to answer from the
summary it was given and never open a task, because the prompt told it the list it had
"was all of it" — which was not true. The list holds titles, columns and dates; the
descriptions and comments live in the files and need a tool call to read.

The prompt now says that plainly, first, with the tool to call for each kind of question
and two worked examples. On a 4B model the difference is the whole feature: "why did the
billing migration slip?" now opens the task and answers from its comments instead of
guessing.

The index also carries the reasons already worked out — "Overdue by 2 days", "No update
for 9 days" — rather than raw dates, so the model is not doing arithmetic across forty
rows to answer "what is overdue". And when it is showing only part of the board, it says
so, instead of implying the rest does not exist.


**The model picker now tells you whether a model can use tools at all**, read from the
model's own chat template rather than guessed from the number in its name. Some families —
Gemma among them — cannot drive tools at any size: they will summarise happily and cannot
look anything up or draft a change. The picker used to call a 4B Gemma "workable" for tool
calling, the same as a 4B Qwen, which is how you end up downloading three gigabytes of
something that will not do the job.

A model whose template has no tools now says **cannot use tools**, with a line explaining
what that means. One that does says **supports tools**. The size guess is only shown when
there is no template to read, and is labelled as the guess it is.

## 0.5.0

**The assistant can read what you attach.** Ask it about a log file or a screenshot and
it opens the file itself. Text files it reads directly. Images it can only see if the
model you are running can see — most small local models cannot, and one that cannot is
told the picture could not be shown rather than being left to describe something it never
received. Anything it cannot read at all, it says so instead of guessing.

It is still bounded by the same workspace as everything else, and reading is all it can
do: attaching, editing and deleting files remain yours.

## 0.4.2

**Attach files and images** to a description or a comment. Paste one, drop one in, or use
the paperclip. Images appear in place; anything else becomes a link you can click.

They are ordinary files in the workspace's own `attachments/` folder, referenced by
ordinary markdown — `![shot.png](attachments/shot.png)`. Open the vault in Obsidian and
the images are simply there, next to the notes that mention them. Nothing is stored
anywhere the folder cannot reconstruct.

Only ordinary image types are ever shown in place. Everything else — including `.html` and
`.svg` — is handed over as a download rather than rendered here, because a file served
inline from this origin runs where the app runs, and a vault can be shared or synced by
someone who is not you.

**Checkboxes in a comment tick too**, the same as ones in a description. They were
read-only because there was no write path for a log entry; adding one is what made
comments editable, and leaving them read-only after that was a difference nobody could
have explained.

## 0.4.1


**A due date can carry a time.** Leave it off and nothing changes — a task due *on* a day
is not late until the day is over. Set one and it is late a minute after: something due at
14:00 shows "Overdue by 1 hour" rather than waiting for midnight to notice. The time is
optional everywhere and never defaulted, because defaulting it to midnight would turn
every date into a deadline that expires the moment the day starts.

**Comments can be edited and deleted.** Hover a comment for the controls; deleting asks
first. An edit changes the wording and keeps the comment's own timestamp, because the
entry records when the thing happened, not when the typo was fixed.

The assistant is deliberately not given either. It can add a comment and has no way to go
back and rewrite or remove one — a log is a record, and a model quietly editing history is
not a feature anyone asked for.

## 0.3.0

**Checkboxes tick with a click, in the editor as well as the reading view.** Clicking one
rewrites the three characters of the marker, so it goes through undo and lands on disk as
those three bytes.

**Enter carries a list on.** A new bullet, the next number, or a fresh unticked box,
keeping the indentation. A second Enter on an empty item ends the list. Tab and Shift-Tab
indent and outdent an item.

**⌘-click a link to open it**, in the editor as well as the reading view. A plain click
still puts the caret where you clicked, so the text under a link stays reachable. Links
that are not `http`, `https`, `mailto` or a path inside the vault are refused rather than
followed.

**The toolbar is icons rather than characters** — `❝` and `🔗` were landing as a different
typeface and a colour emoji next to everything else.

**Wrapped list items hang under their text** instead of falling back to the margin, quotes
carry a bar down every line they wrap onto, and fenced code reads as a block.

**The editor shows formatted text as you type.** Descriptions and comments no longer show
raw markdown while you are editing them: bold looks bold, headings look like headings,
bullets are bullets and checkboxes are boxes, in the same box you are typing in. The
markers reappear on the line the cursor is on, so a stray asterisk is still something you
can see and fix rather than guess at.

The document is still exactly the markdown text — everything on screen is drawn over it,
nothing rewrites it. Saving changes only the characters you changed, as before.

**The running version is shown** at the bottom of the sidebar, under the vault path. An
installer pins the version it shipped with, so running an older copy is a normal thing to
be doing, and until now there was no way to tell that from a feature being broken.

## 0.2.0

**Descriptions and comments are rich text now.** They render markdown: bold and italic,
inline code, links, nested lists, checklists, fenced code blocks with their language,
quotes, headings and tables. Previously the markdown was stored but shown literally, so
anything you formatted read back as asterisks and hyphens.

**A formatting toolbar**, with shortcuts — ⌘B, ⌘I, ⌘E for code, ⌘K for a link, ⌘⇧8 and
⌘⇧7 for lists, ⌘⇧L for a checklist, ⌘⇧. for a quote. They insert the same characters you
would type, so what is saved is still plain markdown you can read in any editor, and your
own formatting is never rewritten.

**Checkboxes in a description are clickable.** Ticking one changes those three characters
in the file and nothing else. Checkboxes in comments render but do not toggle.

**Fixed: markdown in a comment was being mangled on read.** A nested list came back flat
and a fenced code block came back outside the list item it belonged to, because
continuation lines were having their indentation stripped. Existing comments are read
correctly now; nothing on disk needed changing.

**Fixed: the installer now installs the version it says it does.** It asked npm for the
latest version rather than the one the download was labelled with, which meant a release
whose publish had not happened would quietly install the previous version and look like it
had worked.

**Board cards show prose.** They were displaying the raw `**markdown**` from the start of
a description.

## 0.1.0

First release. A task planner whose database is a folder of markdown files: boards with
lanes you name, workspaces that are just folders, an optional local-AI chat that proposes
changes for you to approve, and double-click installers for macOS and Windows.
