# priors

**A private filing cabinet for your AI agent — so it remembers what you two
already settled.**

It lives on your machine, inside your repo, as plain text. Nobody else
installs anything, sees it, or needs to know it exists. It changes one
thing only: **your agent reads it before it speaks, and files what it
learns after.**

## The mental model (30 seconds)

It's a diary where lines are only ever added at the bottom — never edited,
never erased:

```
run-1 | agent found:    "pricing button collects no emails"
run-1 | agent found:    "the $100k figure shows no math"
run-2 | chetan decided: "skip the $100k one — it's fine"
run-3 | from jono:      "lead with the problem story"
```

Later lines answer earlier ones (that's how it knows what's current — and
what came after what: lower = later). Before every run, the agent must
read it. After every run, a small script checks the agent actually
honored it — a run that ignores the diary doesn't count.

That's the entire system. Now the weeks it changes:

---

## Week 1 — the code review that stops moving the goalposts

You ask your agent to review your code. **35 findings.** You fix 22, skip
a few on purpose. You run it again — and today, without priors, you get
**25 "new" findings**: some are the ones you chose to skip, re-argued;
some are old ones reworded; nothing you fixed is acknowledged.

With the filing cabinet, run 2 opens like this instead:

```
Checked against 35 priors:
  ✓ 22 fixed — nice work
  → 9 carried (same items as last run, unchanged code)
  ? 4 need your call — keep / dismiss each
New this run: 3 (all in code your fixes touched)
```

Answer the 4 questions once and they're answered forever — a dismissed
finding can only come back if the code it points at actually changes.
Re-runs get *shorter*. Eventually you get the sentence a memoryless
agent can never say: **"everything settled still holds — nothing new."**

## Week 2 — your design decisions stop being re-litigated

You're iterating on your landing page. You decided the headline stays
terse — that was a real decision, made after real debate. A memoryless
agent will suggest expanding it again next Tuesday, and the Tuesday
after. With the diary, that suggestion is blocked at the source: if the
agent ever believes the decision deserves revisiting, it arrives as **one
question to you** — never as fresh advice you have to bat away again.

## Week 3 — lessons get paid for once

Your agent spends ten minutes discovering that this CLI needs `--json`,
that this vendor's PDFs need decrypting first, that your tests run with
`just test`. Today it rediscovers all of that every session. With the
diary, each lesson is written down once and read back at the start of
every future run. If a lesson ever stops working (the tool changed), it's
re-learned — once.

## Week 4 — a collaborator reviews your work. They install nothing.

This is the part people expect to be complicated. It isn't:

**Their computer:** your reviewer — say Jono — looks at your live site and
gives feedback however he naturally does: a Loom, an email, bullets in
Slack. That's his whole involvement. *No tool, no repo access, no priors.*

**Your computer:** you tell your agent — *"here's Jono's feedback, file
it."* The agent reads it against your diary and sorts it into three piles:

```
Jono's review (12 notes):
  ✓ 4 agree with what you already settled — his name added next to them
  ＋ 5 new — added to your list
  ? 3 clash with decisions you made — one question each, your call
```

You answer the three questions, apply what you accepted, and reply to
Jono in plain English: *"took these five, already had these four, and
here's my thinking on the three where we differ."* He experiences a
normal conversation — where nothing he said fell on the floor, and his
feedback still shapes your runs three months later. His name stays on
his lines in your diary forever.

**The rule that makes sharing simple:** feedback travels between people
as ordinary messages; each person files what they receive into their own
diary. Nobody ever loads anyone else's.

## Also works on things you don't own

Auditing a client's site, or a competitor's? You have no repo access —
but the diary was never theirs to hold; it records *your observations*.
Keep a folder per target (`audits/acme.com/`), run from there, and
re-runs report drift: *"3 things changed since last month; 9 carried."*
One folder per client; client A never sees client B.

---

## Install — any harness, one command

```bash
git clone https://github.com/conikeec/priors
cd priors && ./install.sh
```

| Harness | What install means |
|---|---|
| **Claude Code** | skill `priors` + `/with-priors` command (auto-installed) |
| **OpenClaw** | same skill, its native format (auto-installed) |
| **Kimi CLI** / other Agent-Skills harnesses | point them at `skills/priors/` |
| **Codex** | paste `adapters/AGENTS-snippet.md` into your repo's `AGENTS.md` |
| **Hermes / anything with a shell** | `adapters/system-prompt.md` into the system prompt |

The diary format is identical everywhere, so a team running Codex and
Claude Code side by side converges on the same `.priors/` in the same
repo. Only requirement: `node >= 18`.

Then wrap any skill you already use — no changes to that skill required:

```
/with-priors code-review src/
/with-priors clarity-fold https://your-site.com
```

First run works exactly like today, and quietly starts the diary.

## Three words worth knowing

- **A prior** — anything already settled: a finding, a decision, a lesson.
- **Carried** — still applies; shown, never re-argued as new.
- **Your call** — the only thing that makes a prior permanent. The agent
  suggests; only you decide. (And nothing is ever silently forgotten — a
  prior whose code was deleted goes to rest, and wakes with its memory if
  the code comes back.)

**Prefer pictures?** The whole system in six visuals:
**[the visual tutorial →](docs/tutorial/)**

## Under the hood

The enforcement is a single dependency-free script
(`skills/priors/scripts/priors.mjs`): the agent *proposes*, the script
*disposes* — it refuses to record any run that ignored the diary, with
exit codes, not good intentions. The full technical standard (record
format, lifecycle, guarantees, conformance) is in [PRIORS.md](PRIORS.md)
— for skill authors and implementers; you never need it to use this.

## Status

v0.2 — spec + reference keeper + wrapper + visual tutorial. Reference
adopters: code review and
[clarity-journey](https://github.com/modiqo/clarity-journey) (site
audits). Iterating in the open; the spec is the product.

MIT
