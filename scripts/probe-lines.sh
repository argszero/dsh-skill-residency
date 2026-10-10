#!/usr/bin/env bash
#
# Cross-line probe: pin every harness package to ONE released line, reinstall,
# rebuild, and run the whole suite.
#
# The manifest's peer ranges claim three lines. A claim like that is worth exactly
# as much as the run behind it, and a suite that only ever ran on whatever `latest`
# resolved to proves nothing about the others — the two most likely failures are
# an API that moved between lines (the suite would fail to build or to import) and
# a range that does not actually admit the line it names (this script would fail
# to install it, which is itself the finding).
#
# Nothing is left behind: `package.json` and `package-lock.json` are restored from
# a backup, and `node_modules` is reinstalled from the restored lock, whatever
# happened.
#
# Usage:
#   bash scripts/probe-lines.sh              # every line the README claims
#   bash scripts/probe-lines.sh 0.1.7-rc.2   # one line, by name
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The lines this plugin claims to work on. Keep in step with `README.md` and with
# the peer ranges in `package.json` — `test/packaging.spec.mjs` asserts the three
# agree.
DEFAULT_LINES=(0.1.7-rc.2 0.2.0-rc.2 0.2.1-alpha.2)
LINES=("$@")
if [ "${#LINES[@]}" -eq 0 ]; then LINES=("${DEFAULT_LINES[@]}"); fi

# Every harness package the suite drives. Pinned together: a mixed tree measures
# an install no consumer can produce.
# The Cordis version each line's harness packages are built against.
cordis_for_line() {
  case "$1" in
    0.2.1-alpha.2) echo '4.0.5-alpha.1' ;;
    *) echo '4.0.4' ;;
  esac
}

PACKAGES=(
  @deepseek-ai/cordis
  @deepseek-ai/dsh-agent
  @deepseek-ai/dsh-llm
  @deepseek-ai/dsh-session
  @deepseek-ai/dsh-skill
  @deepseek-ai/dsh-skill-filesystem
  @deepseek-ai/dsh-system-prompt
  @deepseek-ai/dsh-tools
  @deepseek-ai/dsh-agent-loop-testkit
)

BACKUP="$(mktemp -d)"
cleanup() {
  cp "$BACKUP/package.json" "$ROOT/package.json"
  cp "$BACKUP/package-lock.json" "$ROOT/package-lock.json"
  npm install --no-audit --no-fund --silent >/dev/null 2>&1 || true
  ./node_modules/.bin/tsc >/dev/null 2>&1 || true
  rm -rf "$BACKUP"
}
trap cleanup EXIT
cp package.json "$BACKUP/package.json"
cp package-lock.json "$BACKUP/package-lock.json"

fails=0
for line in "${LINES[@]}"; do
  echo "=================== ${line} ==================="
  cp "$BACKUP/package.json" package.json
  for package in "${PACKAGES[@]}"; do
    node -e '
      const fs = require("node:fs")
      const [file, name, version] = process.argv.slice(1)
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
      manifest.devDependencies[name] = version
      fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
    ' package.json "$package" "$line"
  done
  node -e '
    const fs = require("node:fs")
    const [file, version] = process.argv.slice(1)
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
    manifest.devDependencies["@deepseek-ai/cordis"] = version
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
  ' package.json "$(cordis_for_line "$line")"
  # A clean tree: npm reconciles a pinned set against whatever is already on disk,
  # and an old `node_modules` makes it report a conflict no consumer would hit.
  rm -rf node_modules package-lock.json
  INSTALL_LOG="$(mktemp)"
  if ! npm install --no-audit --no-fund > "$INSTALL_LOG" 2>&1; then
    echo "INSTALL FAILED on ${line} — the peer ranges do not admit it:"
    tail -25 "$INSTALL_LOG"
    rm -f "$INSTALL_LOG"
    fails=$((fails + 1))
    continue
  fi
  rm -f "$INSTALL_LOG"
  if ! ./node_modules/.bin/tsc; then
    echo "BUILD FAILED on ${line}"
    fails=$((fails + 1))
    continue
  fi
  LOG="$(mktemp)"
  if node --test "test/*.spec.mjs" > "$LOG" 2>&1; then
    grep -E '^ℹ (pass|fail)' "$LOG" | tr '\n' ' '
    echo " PASS"
  else
    echo "SUITE RED on ${line}:"
    grep -E '^ℹ (pass|fail)' "$LOG" || true
    grep -E 'not ok' "$LOG" | head -20
    fails=$((fails + 1))
  fi
  rm -f "$LOG"
done

echo "=================== summary ==================="
echo "lines probed: ${#LINES[@]}; lines failing: ${fails}"
exit "$fails"
