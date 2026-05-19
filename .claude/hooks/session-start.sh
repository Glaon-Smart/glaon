#!/usr/bin/env bash
# Claude Code on the web bootstrap. Runs at SessionStart; idempotent.
# Skipped on local sessions ($CLAUDE_CODE_REMOTE unset) so it never touches
# a developer's machine.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

log() { printf '[session-start] %s\n' "$*" >&2; }

log "node $(node -v), corepack $(corepack --version 2>/dev/null || echo 'missing')"

# Pin pnpm to packageManager from package.json (9.15.9 at time of writing).
corepack enable >/dev/null
corepack prepare pnpm@9.15.9 --activate >/dev/null
log "pnpm $(pnpm -v)"

log "installing workspace dependencies"
pnpm install --prefer-frozen-lockfile

log "pre-building @glaon/core + @glaon/ui (warms lint/type-check)"
pnpm --filter @glaon/core --filter @glaon/ui build

# gitleaks is required by .husky/pre-commit (see docs/SECURITY.md). Without it,
# every `git commit` in the session fails. Install the v8 binary if absent.
if ! command -v gitleaks >/dev/null 2>&1; then
  log "installing gitleaks (pre-commit dependency)"
  gitleaks_version="8.21.2"
  case "$(uname -m)" in
    x86_64) gitleaks_arch="linux_x64" ;;
    aarch64|arm64) gitleaks_arch="linux_arm64" ;;
    *) gitleaks_arch="linux_$(uname -m)" ;;
  esac
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/gitleaks.tgz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/gitleaks_${gitleaks_version}_${gitleaks_arch}.tar.gz"
  tar -xzf "$tmp/gitleaks.tgz" -C "$tmp" gitleaks
  install_dir="/usr/local/bin"
  if [ ! -w "$install_dir" ]; then
    install_dir="$HOME/.local/bin"
    mkdir -p "$install_dir"
    case ":$PATH:" in
      *":$install_dir:"*) ;;
      *) echo "export PATH=\"$install_dir:\$PATH\"" >> "${CLAUDE_ENV_FILE:-/dev/null}" ;;
    esac
  fi
  mv "$tmp/gitleaks" "$install_dir/gitleaks"
  rm -rf "$tmp"
fi
log "gitleaks $(gitleaks version)"

# MCP servers (Untitled UI, Chromatic, Storybook, Figma) read tokens from the
# session environment. Hook does not fail when they are missing — secrets are
# managed via the Claude Code on the web Environment configuration UI.
missing_env=()
for var in UNTITLED_TOKEN CHROMATIC_PROJECT_TOKEN; do
  if [ -z "${!var:-}" ]; then
    missing_env+=("$var")
  fi
done

if [ ${#missing_env[@]} -gt 0 ]; then
  log "WARN: MCP secrets not set in environment: ${missing_env[*]}"
  log "      Set them via Claude Code on the web → Environment configuration."
fi

log "ready"
