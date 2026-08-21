#!/bin/bash
#
# Double-click this file to install watsmytask on macOS.
#
# It installs into a folder you own (~/Library/Application Support/watsmytask) rather
# than running `npm install -g`. That is deliberate: a Node installed from the nodejs.org
# installer puts global packages under /usr/local, which needs an administrator password,
# and a script that pops a password prompt on a double-click is a script people quit.
# Nothing here needs sudo, and nothing here touches a file outside your home folder.

set -u

APP_NAME="watsmytask"
PACKAGE="watsmytask"
# Kept relative to $HOME so the launcher can resolve it at run time rather than baking
# in whatever the path happened to be on the day of the install.
APP_SUBPATH="Library/Application Support/watsmytask"
APP_DIR="$HOME/$APP_SUBPATH"
LAUNCHER_DIR="$HOME/Applications"
LAUNCHER="$LAUNCHER_DIR/$APP_NAME.command"
MIN_NODE_MAJOR=20
MIN_NODE_MINOR=11

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }

# Keep the window open on the way out so a failure is readable, not a flash of black.
finish() {
  printf '\n'
  read -r -p "Press Return to close this window. " _ || true
  exit "${1:-0}"
}

printf '\n'
bold "  Installing $APP_NAME"
printf '\n'

# ---------------------------------------------------------------- find Node
# A double-clicked .command does not always inherit the PATH from a login shell, so look
# in the places Node actually installs to before giving up on it.
for candidate in /opt/homebrew/bin /usr/local/bin /usr/bin; do
  case ":$PATH:" in *":$candidate:"*) ;; *) PATH="$PATH:$candidate" ;; esac
done
# Node installed through nvm lives in the user's home and is not on any system path.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi
export PATH

node_is_new_enough() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "
    const [maj, min] = process.versions.node.split('.').map(Number);
    process.exit(maj > $MIN_NODE_MAJOR || (maj === $MIN_NODE_MAJOR && min >= $MIN_NODE_MINOR) ? 0 : 1);
  " >/dev/null 2>&1
}

if node_is_new_enough; then
  ok "Node $(node -v) is installed."
else
  if command -v node >/dev/null 2>&1; then
    warn "Node $(node -v) is too old — watsmytask needs $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer."
  else
    warn "Node is not installed. watsmytask needs it to run."
  fi

  if command -v brew >/dev/null 2>&1; then
    printf '\n'
    read -r -p "  Install Node with Homebrew now? [Y/n] " reply
    case "${reply:-Y}" in
      [Nn]*) ;;
      *)
        echo "  Installing Node — this takes a few minutes..."
        brew install node || true
        hash -r 2>/dev/null || true
        ;;
    esac
  fi

  if ! node_is_new_enough; then
    printf '\n'
    err "Node $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer is required, and could not be installed automatically."
    echo
    echo "  Install it one of these ways, then run this installer again:"
    echo
    echo "    • Download the LTS installer:  https://nodejs.org"
    echo "    • Or, with Homebrew:           brew install node"
    echo
    read -r -p "  Open nodejs.org now? [Y/n] " reply
    case "${reply:-Y}" in [Nn]*) ;; *) open "https://nodejs.org/en/download" ;; esac
    finish 1
  fi
  ok "Node $(node -v) is installed."
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm was not found next to Node. Reinstall Node from https://nodejs.org and try again."
  finish 1
fi

# ------------------------------------------------------------------ install
echo
echo "  Downloading $APP_NAME..."
mkdir -p "$APP_DIR" || { err "Could not create $APP_DIR"; finish 1; }

# A private package.json keeps npm from walking up and adopting some parent folder.
if [ ! -f "$APP_DIR/package.json" ]; then
  cat > "$APP_DIR/package.json" <<'JSON'
{ "name": "watsmytask-install", "private": true, "description": "Holds the installed watsmytask." }
JSON
fi

if ! npm install --prefix "$APP_DIR" --no-audit --no-fund "$PACKAGE@latest"; then
  echo
  err "The download failed."
  echo "  Check that you are online, then run this installer again."
  echo "  If you are behind a proxy, npm needs to know about it:"
  echo "    npm config set proxy http://your-proxy:port"
  finish 1
fi

ENTRY_SUBPATH="$APP_SUBPATH/node_modules/$PACKAGE/bin/$PACKAGE.mjs"
ENTRY="$HOME/$ENTRY_SUBPATH"
if [ ! -f "$ENTRY" ]; then
  err "The install finished but $ENTRY is missing."
  finish 1
fi
ok "$APP_NAME installed."

# ----------------------------------------------------------------- launcher
mkdir -p "$LAUNCHER_DIR"
cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/bin/bash
# Starts watsmytask and opens it in your browser. Made by the installer; safe to delete.
for candidate in /opt/homebrew/bin /usr/local/bin /usr/bin; do
  case ":\$PATH:" in *":\$candidate:"*) ;; *) PATH="\$PATH:\$candidate" ;; esac
done
[ -s "\$HOME/.nvm/nvm.sh" ] && . "\$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH
exec node "\$HOME/$ENTRY_SUBPATH" "\$@"
LAUNCHER_EOF
chmod +x "$LAUNCHER"
ok "Added \"$APP_NAME\" to your Applications folder."

# ---------------------------------------------------------------------- run
echo
bold "  Done."
echo
echo "  To start it again later, double-click:"
echo "    $LAUNCHER"
echo
echo "  Your tasks are plain markdown files in:  ~/watsmytask-vault"
echo "  Back that folder up and you have backed up everything."
echo
read -r -p "  Start $APP_NAME now? [Y/n] " reply
case "${reply:-Y}" in
  [Nn]*) finish 0 ;;
  *)
    echo
    exec node "$ENTRY"
    ;;
esac
