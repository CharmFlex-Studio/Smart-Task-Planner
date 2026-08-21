# Changelog

What changed for someone using watsmytask. The release workflow reads the section matching
the version being released and puts it in the release notes, so a version with no section
here ships without a "what's new" — keep it up to date as part of the version bump.

## 0.3.0

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
