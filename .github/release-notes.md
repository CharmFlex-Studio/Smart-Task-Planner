## watsmytask __VERSION__

Your tasks, kept as plain markdown files in a folder you own. No database, no account,
nothing leaves your computer.

__WHATS_NEW__
### Install without a terminal

Download **`watsmytask-installer.zip`** below, unzip it, and open
**`READ ME FIRST.txt`**. It walks through both platforms in three steps.

In short: double-click the installer for your computer, allow it past the one security
prompt you will see, and answer the couple of questions it asks. It checks whether you
have Node, offers to install it if you do not, and leaves you a launcher — in your
Applications folder on a Mac, on your Desktop on Windows.

You will never be asked for an administrator password, and nothing is written outside
your own user folder.

**The security prompt is expected.** Neither installer carries a paid code-signing
certificate, so:

- **macOS 15 and newer** — System Settings → Privacy & Security → scroll down → **Open Anyway**
- **macOS 14 and older** — right-click the file → **Open** → **Open**
- **Windows** — SmartScreen → **More info** → **Run anyway**

Both installers are plain text. Read them first if you would rather check what they do.

### Install with a terminal

With [Node 20.11+](https://nodejs.org):

```bash
npx watsmytask
```

or `npm install -g watsmytask` and then `watsmytask`.

### What it does

- **Your tasks are files.** Markdown with a small YAML header, in `~/watsmytask-vault`.
  Open them in any editor. Copy the folder and you have a backup.
- **Boards with lanes you name.** No fixed To-Do/Doing/Done — the lanes are yours, and
  they live in the board file as text.
- **Workspaces.** Separate folders for separate parts of your life, each isolated.
- **Optional local AI.** A chat that can read and propose changes to the workspace you
  have open, running a model on your own machine. It proposes; you approve every write.
  Nothing is installed unless you ask for it, and the planner is fully usable without it.
- **Git as undo**, when the vault is a git repo.

### Requirements

Node 20.11 or newer — the installers will fetch it for you. macOS, Windows, or Linux.

### Notes

The server binds to `127.0.0.1`. The only outbound request the app ever makes is a model
download you clicked. Your task data is never sent anywhere.
