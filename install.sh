#!/usr/bin/env sh
# priors installer — one command, any harness.
# The enforcement core is a plain Node script; "installing" just means
# teaching your harness the ritual. This detects what you have and does the
# right thing for each; nothing here is destructive.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
KEEPER="$SRC/skills/priors/scripts/priors.mjs"
found=0

# Claude Code (and anything else reading ~/.claude/skills)
if [ -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude/skills" "$HOME/.claude/commands"
  cp -R "$SRC/skills/priors" "$HOME/.claude/skills/"
  cp "$SRC/commands/with-priors.md" "$HOME/.claude/commands/"
  echo "✓ Claude Code — skill 'priors' + /with-priors command installed"
  found=1
fi

# OpenClaw (Agent Skills native)
if [ -d "$HOME/.openclaw" ]; then
  mkdir -p "$HOME/.openclaw/skills"
  cp -R "$SRC/skills/priors" "$HOME/.openclaw/skills/"
  echo "✓ OpenClaw — skill 'priors' installed"
  found=1
fi

echo ""
echo "For harnesses without a skills directory (the protocol is identical everywhere):"
echo "  → Codex:      paste adapters/AGENTS-snippet.md into your repo's AGENTS.md"
echo "  → Kimi CLI &  other Agent-Skills harnesses: point them at $SRC/skills/priors"
echo "  → Anything    with a shell (Hermes, custom): use adapters/system-prompt.md"
echo ""
echo "Keeper path for adapters: $KEEPER"
if [ "$found" -eq 0 ]; then
  echo "No skills directory detected — that's fine: the adapters above are the install."
fi
echo "Only requirement anywhere: node >= 18."
