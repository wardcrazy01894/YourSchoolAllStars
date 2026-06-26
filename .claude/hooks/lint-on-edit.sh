#!/usr/bin/env bash
# PostToolUse hook: auto-format + lint TS/TSX files right after Claude edits them.
#
# Wired in .claude/settings.json on Edit|Write. Reads the tool-call JSON from
# stdin, pulls out the edited file path, and — for .ts/.tsx files under the repo
# — runs `prettier --write` then `eslint --fix`. If lint errors remain after the
# autofix, it exits 2 so the agent sees them and self-corrects in the same loop,
# keeping CI's required `build / typecheck / lint` check green.
#
# Fail-open: anything unexpected (no node_modules, non-TS file, parse error)
# exits 0 so the hook never blocks normal editing.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
input="$(cat)"

file="$(printf '%s' "$input" | python3 -c \
  'import json,sys
try:
    print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))
except Exception:
    print("")' 2>/dev/null)"

case "$file" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

cd "$root" || exit 0
[ -d node_modules ] || exit 0

npx --no-install prettier --write "$file" >/dev/null 2>&1 || true

if ! out="$(npx --no-install eslint --fix "$file" 2>&1)"; then
  {
    echo "eslint still reports issues in $file after autofix:"
    echo "$out"
    echo "Fix these before continuing (do not commit lint failures)."
  } >&2
  exit 2
fi
exit 0
