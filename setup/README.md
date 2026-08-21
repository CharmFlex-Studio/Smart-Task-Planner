# Installing watsmytask

Three ways in. Pick the one that matches how comfortable you are with a terminal.

## 1. Double-click an installer (no terminal needed)

Best if you do not have Node installed and would rather not think about it. The installer
checks for Node, offers to install it, downloads watsmytask, and puts a launcher where you
can find it again.

Neither installer needs an administrator password. Both install into a folder your own
account owns, and neither writes anything outside your home folder.

**Download `watsmytask-installer-v<version>.zip` from the
[latest release](https://github.com/CharmFlex-Studio/Smart-Task-Planner/releases/latest),
then unzip it.** Inside are both installers and a plain-text `READ ME FIRST.txt`.

Take the zip rather than the loose files. A browser downloading a `.command` on its own
strips the executable bit, and the file then opens in TextEdit instead of running. Zip
preserves it.

### macOS

1. Double-click **`macOS - Install watsmytask.command`**.

2. macOS will very likely block it the first time, saying it cannot be opened because it
   is from an unidentified developer. That happens to everything not distributed through
   the App Store or signed with a paid Apple certificate. To allow it:

   **macOS 15 Sequoia and newer** — open **System Settings → Privacy & Security**, scroll
   down to the Security section, find the line naming the installer, and click
   **Open Anyway**. Then double-click the file again.

   **macOS 14 and older** — right-click the file, choose **Open**, then click **Open** in
   the dialog. (This shortcut was removed in Sequoia, which is why the newer path above
   goes through System Settings instead.)

3. Answer the question or two it asks, pressing Return to accept each default.

If it opens in TextEdit rather than running, the executable bit was lost — that happens
when the `.command` is downloaded on its own instead of inside the zip. Either re-download
the zip, or run this once in Terminal and double-click again:

```bash
chmod +x ~/Downloads/watsmytask-installer/"macOS - Install watsmytask.command"
```

It installs to `~/Library/Application Support/watsmytask` and adds
**`~/Applications/watsmytask.command`** — double-click that to start it any time.

### Windows

1. Double-click **`Windows - Install watsmytask.bat`**.

2. SmartScreen will probably say "Windows protected your PC". Click **More info**, then
   **Run anyway**. That warning appears for any script without a paid code-signing
   certificate; the file is plain text, so read it first if you would rather check.

3. Answer the question or two it asks, pressing Enter to accept each default.

It installs to `%LOCALAPPDATA%\watsmytask` and puts a **watsmytask** shortcut on your
Desktop.

## 2. One command, nothing installed

If you already have [Node 20.11+](https://nodejs.org):

```bash
npx watsmytask
```

Downloads, runs, and opens your browser. Nothing is installed permanently.

## 3. Install the command

```bash
npm install -g watsmytask
watsmytask
```

## Options

```
-p, --port <number>   Port to listen on          (default 5123)
    --vault <path>    Folder to keep tasks in    (default ~/watsmytask-vault)
    --no-open         Do not open the browser
-h, --help            Show all options
```

## Uninstalling

Your tasks are **not** deleted by any of this — they are markdown files in
`~/watsmytask-vault`, and removing the app never touches them.

| Installed with | Remove it |
|---|---|
| macOS installer | Delete `~/Library/Application Support/watsmytask` and `~/Applications/watsmytask.command` |
| Windows installer | Delete `%LOCALAPPDATA%\watsmytask` and the Desktop shortcut |
| `npm install -g` | `npm uninstall -g watsmytask` |
| `npx` | Nothing to remove |

If you downloaded a local AI model, it is in `~/.watsmytask/models` — that folder is a
cache and is safe to delete.

## If something goes wrong

**"Port 5123 is being used by something else."**
Something else has the port. Start on another one: `watsmytask --port 5124`.

**The installer says the download failed.**
Usually no internet, or a corporate proxy npm does not know about:

```bash
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
```

**Windows: "Node was installed, but this window still cannot see it."**
Windows only adds Node to the PATH of *new* windows. Close the installer and
double-click it again.

**Nothing opens in the browser.**
The server still started — look for the `http://127.0.0.1:5123` line in the window and
open it yourself.
