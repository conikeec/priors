# priors

**Your AI agent forgets everything it settled. This makes it remember.**

## The problem you already have

Ask your agent to review your code. It finds 35 issues. You fix 22 of them,
skip a few on purpose, and run the review again.

It reports 25 "new" issues.

Some are the ones you *chose* to skip, re-argued as if you'd never decided.
Some are old findings in new words. Some were always there, just below
yesterday's bar. You can't tell which are which — and nothing you fixed gets
acknowledged. Every run starts from zero. The goalposts move forever.

The same thing happens everywhere an agent makes judgments or learns by
doing: design reviews re-open settled taste calls, contract reviews re-flag
clauses your counsel already accepted, and every session re-discovers that
this repo's tests run with `just test`, the hard way.

## What this does

`priors` gives your agent a small ledger of everything already settled —
findings it reported, decisions you made, lessons it learned — and **makes
the next run honor it before saying anything new**:

- **Fixed things get acknowledged.** "22 of 35 fixed ✓" — with the same IDs
  as last time, so you can see your progress instead of a fresh invoice.
- **Decisions stay decided.** Skip a finding once and mark it — it is never
  argued again unless the code it points at actually changes.
- **The bar doesn't creep.** A run may not dredge up minor nitpicks in
  unchanged code and present them as news. Deeper only happens when you ask.
- **Lessons stay learned.** "Use `--json` with that CLI", "this vendor's
  PDFs need decrypting first" — paid for once, remembered after.

And this isn't a polite suggestion to the model. A small script checks the
agent's output and **refuses to record a run** that ignores what was
settled. The model proposes; the ledger disposes.

The result over time: re-runs get *shorter*, not longer. Eventually a run
comes back with "everything settled still holds — nothing new," which is a
sentence a memoryless agent cannot say.

## Quickstart — any harness

The core is a plain script; "installing" just means teaching your harness
the ritual. One clone, one installer, everywhere:

```bash
git clone https://github.com/conikeec/priors
cd priors && ./install.sh
```

The installer detects what you have and does the right thing:

| Harness | What install means |
|---|---|
| **Claude Code** | skill `priors` + `/with-priors` command (auto-installed) |
| **OpenClaw** | same skill, its native format (auto-installed) |
| **Kimi CLI** / other Agent-Skills harnesses | point them at `skills/priors/` |
| **Codex** | paste `adapters/AGENTS-snippet.md` into your repo's `AGENTS.md` |
| **Hermes / anything with a shell** | `adapters/system-prompt.md` into the system prompt |

The protocol and the ledger are identical everywhere — a team running
Codex and Claude Code side by side converges against the same `.priors/`
in the same repo. Only requirement: `node >= 18`.

Then wrap any skill you already use — no changes to that skill required:

```
/with-priors code-review src/
/with-priors clarity-fold https://your-site.com
```

First run: works exactly like today, and quietly writes what it found to
`.priors/` in your repo (plain text files — read them, commit them, diff
them in PRs).

Second run: opens by checking everything from last time, then tells you the
honest delta:

```
Checked against 35 priors:
  ✓ 22 fixed — nice work
  → 9 carried (same items as last run, unchanged code)
  ? 4 need your call — reply: keep / dismiss each
New this run: 3 (all in code your fixes touched)
```

That `? need your call` moment is the whole trick: answer once, and the
answer sticks forever — or until the code it's about changes.

**Prefer pictures?** The whole system in six visuals:
**[the visual tutorial →](docs/tutorial/)**

## The three words worth knowing

- **A prior** — anything already settled: a finding, a decision, a lesson.
- **Carried** — a prior that still applies; shown, never re-argued as new.
- **Your call** — the only thing that can make a prior permanent. The agent
  can *suggest* a finding is obsolete; only you can dismiss it for good.

(And one for later: **resting** — a prior whose code was deleted goes
quiet after a few runs, and wakes with its memory if the code ever comes
back. Nothing is ever silently forgotten.)

Everything else — dispositions, facets, scope hashes, activation phases —
lives in [PRIORS.md](PRIORS.md), the technical spec, for skill authors and
implementers. You never need it to use this.

## Works with

Claude Code (plugin/skill), OpenClaw and other Agent-Skills-compatible
harnesses (same SKILL.md), Codex (`adapters/AGENTS-snippet.md`), or any
agent with a shell (`adapters/system-prompt.md`). One repo, one ledger —
different harnesses converge against the same settled state, because the
enforcement is a script with exit codes, not a feature of any harness.

## Status

v0.1 — spec + reference keeper + wrapper. Reference adopters:
[clarity-journey](https://github.com/modiqo/clarity-journey) (site audits)
and code review. Iterating in the open; the spec is the product.

MIT
