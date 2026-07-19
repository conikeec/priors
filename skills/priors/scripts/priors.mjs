#!/usr/bin/env node
// @ts-check
/* priors.mjs — reference keeper for the PRIORS standard (see PRIORS.md).
   Single file, zero dependencies, Node >= 18.
   The model proposes; this script disposes. All guarantees live in exit codes:
   0 = ok · 1 = refused (reason on stdout as JSON) · 2 = usage error.
   User-facing output is plain language (fixed / carried / your call / new);
   terms of art stay inside the data.
   v0.2 adds forgetting — always a status, never an absence:
   archive/resurrect (attention), review nudges, redact tombstones (record). */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = '.priors';
const LEDGER = () => join(DIR, 'ledger.jsonl');
const RUNS = () => join(DIR, 'runs');
const ARCHIVE_K = 5; // consecutive runs with the scope missing → archived (asleep, not gone)

/* ── registry: the grammar (facets) and the vocabulary (type presets) ── */
const FACETS = {
  scope: ['content-hash', 'tool-version', 'env-fingerprint', 'repo-wide'],
  activation: ['run-start', 'verify-phase', 'propose-gate'],
  obligation: ['disposition-required', 'inject-as-instruction', 'veto-only'],
  authority: ['advisory', 'binding'],
  lifecycle: ['stale-on-scope-change', 'challenged-on-failure', 'only-by-supersession'],
};
const TYPES = {
  conclusion:  { scope: 'content-hash', activation: 'verify-phase', obligation: 'disposition-required', authority: 'advisory', lifecycle: 'stale-on-scope-change' },
  behavioral:  { scope: 'tool-version', activation: 'run-start', obligation: 'inject-as-instruction', authority: 'advisory', lifecycle: 'challenged-on-failure' },
  coverage:    { scope: 'content-hash', activation: 'propose-gate', obligation: 'veto-only', authority: 'advisory', lifecycle: 'stale-on-scope-change' },
  calibration: { scope: 'repo-wide', activation: 'run-start', obligation: 'inject-as-instruction', authority: 'advisory', lifecycle: 'only-by-supersession' },
};
/* directions that reverse each other; candidates may extend via "opposes" */
const OPPOSES = {
  terser: 'expand', expand: 'terser',
  'proof-earlier': 'proof-later', 'proof-later': 'proof-earlier',
  'cta-singular': 'cta-multiple', 'cta-multiple': 'cta-singular',
  'hoist-resource': 'inline-resource', 'inline-resource': 'hoist-resource',
};
const SEV = ['minor', 'major', 'gate'];
const BINDING_SET = ['accepted', 'wontfix'];
const AGENT_VERDICTS = ['fixed', 'still-open', 'stale', 'challenged', 'obsolete-proposed'];
const HUMAN_VERDICTS = ['accepted', 'wontfix', 'obsolete', 'reopen', 'keep'];

/* ── determinism utilities ── */
const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const normText = (s) => s.replace(/\s+/g, ' ').trim();
const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/* ── ledger primitives ── */
function loadLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Fold the append-only ledger into state. Status is computed, never stored.
    Also tracks: consecutive missing-scope streaks (archive), the run index of
    the last human touch (review nudges), and the ordered run list. */
function fold(lines) {
  /** @type {Record<string, any>} */
  const st = {};
  const runsOrder = [];
  const seeRun = (r) => { if (r && !runsOrder.includes(r)) runsOrder.push(r); };
  for (const l of lines) {
    if (l.t === 'prior') {
      seeRun(l.born);
      st[l.id] = { prior: l, status: l.redacted ? 'redacted' : 'open', lastRun: l.born, miss: 0, humanIdx: l.redacted ? -1 : runsOrder.length - 1 };
    } else if (l.t === 'event' && st[l.id]) {
      seeRun(l.run);
      const e = st[l.id];
      if (l.action === 'scope-missing') e.miss++;
      else if (l.action === 'disposition') { e.miss = 0; e.lastRun = l.run || e.lastRun;
        // 'still-open' means exactly that — the prior stays open and MUST be
        // carried into the next run's verify list, not filed away as seen
        e.status = l.to === 'still-open' ? 'open' : l.to; }
      else if (l.action === 'decide') { e.miss = 0; e.status = l.to === 'reopen' ? 'open' : l.to === 'keep' ? 'accepted' : l.to; e.humanIdx = runsOrder.length - 1; }
      else if (l.action === 'redact') e.status = 'redacted';
    }
  }
  return { st, runsOrder };
}
const state = () => fold(loadLines(LEDGER()));
/** Asleep, not gone: advisory verify-phase prior whose scope vanished for K runs. */
const isArchived = (e) => e.miss >= ARCHIVE_K && !BINDING_SET.includes(e.status) && e.status !== 'redacted';
function nextId(st, staged) {
  return 'P-' + String(Object.keys(st).length + staged + 1).padStart(4, '0');
}
function refuse(code, detail) {
  process.stdout.write(canon({ refused: code, ...detail }) + '\n');
  process.exit(1);
}
function usage(msg) { process.stderr.write(msg + '\n'); process.exit(2); }
function arg(flag) { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; }

/* ── facet validation ── */
function expandType(c) {
  const facets = c.type ? { ...TYPES[c.type], ...(c.facets || {}) } : c.facets;
  if (!facets) usage('candidate needs "type" (one of ' + Object.keys(TYPES).join('/') + ') or explicit "facets"');
  for (const [k, vals] of Object.entries(FACETS))
    if (!vals.includes(facets[k])) usage(`facet ${k}=${facets[k]} invalid; allowed: ${vals.join(', ')}`);
  if (facets.obligation === 'inject-as-instruction' && facets.activation !== 'run-start') usage('inject requires activation run-start');
  if (facets.obligation === 'disposition-required' && facets.activation !== 'verify-phase') usage('disposition-required requires verify-phase');
  if (facets.obligation === 'veto-only' && facets.activation !== 'propose-gate') usage('veto-only requires propose-gate');
  if (facets.scope === 'repo-wide' && facets.lifecycle === 'stale-on-scope-change') usage('repo-wide scope cannot be stale-on-scope-change');
  if (facets.authority === 'binding') usage('authority is never self-assigned: priors are born advisory; use `decide` to promote');
  return facets;
}

/* ── verbs ── */
function init() {
  mkdirSync(RUNS(), { recursive: true });
  if (!existsSync(LEDGER())) writeFileSync(LEDGER(), '');
  render(true);
  console.log('priors: ready (.priors/ created — commit it with your repo)');
}

function hashCmd() {
  const text = arg('--text');
  const file = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  if (text !== undefined) return console.log(sha12(normText(text)));
  if (file) return console.log(sha12(normText(readFileSync(file, 'utf8'))));
  usage('priors hash <file> | priors hash --text "..."');
}

/** Deterministic exposure: the keeper selects; the model never "fails to find". */
function relevant() {
  const ns = arg('--ns') || usage('relevant needs --ns');
  let run = arg('--run');
  const scopesFile = arg('--scopes');
  const scopes = scopesFile ? JSON.parse(readFileSync(scopesFile, 'utf8')) : {};
  mkdirSync(RUNS(), { recursive: true });
  if (!run) {
    const n = readdirSync(RUNS()).filter((d) => d.startsWith('run-')).length + 1;
    run = 'run-' + String(n).padStart(3, '0');
  }
  mkdirSync(join(RUNS(), run), { recursive: true });
  const { st, runsOrder } = state();
  const inject = [], verify = [], nudges = [], floors = [];
  let settled = 0, archived = 0;
  for (const e of Object.values(st)) {
    const { prior, status } = e;
    if (prior.ns !== ns || status === 'obsolete' || status === 'redacted') continue;
    const f = prior.facets;
    if (f.activation === 'run-start' && ['open', ...BINDING_SET].includes(status)) {
      inject.push({ id: prior.id, claim: prior.claim, status });
      if (prior.review_every && (runsOrder.length - 1 - e.humanIdx) >= prior.review_every)
        nudges.push({ id: prior.id, claim: prior.claim, ask: 'still true? reply: decide ' + prior.id + ' keep — or retire it' });
    } else if (f.activation === 'verify-phase' && ['open', 'stale', 'challenged'].includes(status)) {
      const cur = scopes[prior.scope_ref];
      if (isArchived(e)) {
        if (cur === undefined) { archived++; continue; } // asleep — its code is still gone
        verify.push({ id: prior.id, claim: prior.claim, scope_ref: prior.scope_ref, severity: prior.severity,
          scopeState: cur === prior.scope_hash ? 'unchanged' : 'changed', resurrected: true }); // the code came back — so does its memory
      } else {
        const scopeState = cur === undefined ? 'missing' : cur === prior.scope_hash ? 'unchanged' : 'changed';
        verify.push({ id: prior.id, claim: prior.claim, scope_ref: prior.scope_ref, severity: prior.severity, scopeState });
      }
    } else if (BINDING_SET.includes(status)) settled++;
    if (f.activation === 'propose-gate' && status === 'open')
      floors.push({ id: prior.id, scope_ref: prior.scope_ref, depth: prior.depth || 'major' });
  }
  const out = { run, ns, inject, verify, nudges, settled, archived, floors };
  writeFileSync(join(RUNS(), run, 'relevant.json'), canon({ ...out, scopes }) + '\n');
  process.stdout.write(canon(out) + '\n');
}

function disposition() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  const run = arg('--run') || usage('disposition needs --run');
  if (!AGENT_VERDICTS.includes(verdict)) usage('agent verdicts: ' + AGENT_VERDICTS.join(' | ') + ' — accepted/wontfix/keep are human words: use `decide`');
  const { st } = state();
  if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
  if (BINDING_SET.includes(st[id].status)) refuse('BINDING_IMMUTABLE', { id, status: st[id].status, hint: 'only a human `decide reopen` can touch this' });
  if (st[id].status === 'redacted') refuse('REDACTED', { id });
  appendFileSync(join(RUNS(), run, 'dispositions.jsonl'), canon({ t: 'event', id, action: 'disposition', to: verdict, run, by: 'agent' }) + '\n');
  console.log(`${id} → ${verdict}`);
}

/** The human door — the only source of binding status, and of reopening. */
function decide() {
  const [id, verdict] = [process.argv[3], process.argv[4]];
  if (!HUMAN_VERDICTS.includes(verdict)) usage('decide verdicts: ' + HUMAN_VERDICTS.join(' | '));
  const { st } = state();
  if (!st[id]) refuse('UNKNOWN_PRIOR', { id });
  if (st[id].status === 'redacted') refuse('REDACTED', { id });
  const reason = arg('--because');
  if (verdict === 'reopen' && !reason) usage('reopen requires --because "reason" (the ratchet unlocks loudly, never silently)');
  appendFileSync(LEDGER(), canon({ t: 'event', id, action: 'decide', to: verdict, by: 'human', ...(reason ? { reason } : {}) }) + '\n');
  render(true);
  console.log(`${id} → ${verdict} (your call — this sticks)`);
}

/** Record forgetting — the one sanctioned in-place rewrite. Content goes;
    the fact of removal is itself remembered (tombstone keeps id + hash). */
function redact() {
  const id = process.argv[3];
  const reason = arg('--because') || usage('redact requires --because "reason"');
  const lines = loadLines(LEDGER());
  let found = false;
  const out = lines.map((l) => {
    if (l.t === 'prior' && l.id === id) {
      found = true;
      return sortKeys({ t: 'prior', id: l.id, ns: l.ns, redacted: true, content_hash: sha12(canon(l)), born: l.born });
    }
    return l;
  });
  if (!found) refuse('UNKNOWN_PRIOR', { id });
  writeFileSync(LEDGER(), out.map((l) => canon(l)).join('\n') + '\n');
  appendFileSync(LEDGER(), canon({ t: 'event', id, action: 'redact', by: 'human', reason }) + '\n');
  render(true);
  console.log(`${id} redacted — content removed, removal remembered. Note: git history still holds the old line; scrub history separately if this was a secret.`);
}

/** propose: dedup, re-raise veto, reversal escalation, coverage floor. */
function propose() {
  const run = arg('--run') || usage('propose needs --run');
  const ns = arg('--ns') || usage('propose needs --ns');
  const file = process.argv[3];
  if (!file || file.startsWith('--')) usage('propose <candidate.json> --run R --ns N');
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const facets = expandType(c);
  if (facets.scope !== 'repo-wide' && (!c.scope_ref || !c.scope_hash)) usage('non-repo-wide candidates need scope_ref and scope_hash');
  if (!c.claim) usage('candidate needs a claim');
  const { st } = state();
  // overlay this run's staged dispositions — a same-run "fixed" must already
  // count for the reversal/re-raise checks, or the veto has a blind spot
  const dispFile = join(RUNS(), run, 'dispositions.jsonl');
  if (existsSync(dispFile)) for (const d of loadLines(dispFile)) if (st[d.id]) st[d.id].status = d.to;
  const stagedFile = join(RUNS(), run, 'staged.jsonl');
  const staged = loadLines(stagedFile);
  for (const { prior, status } of Object.values(st)) {
    if (prior.ns !== ns || prior.redacted) continue;
    const sameRef = prior.scope_ref && prior.scope_ref === c.scope_ref;
    const sameHash = sameRef && prior.scope_hash === c.scope_hash;
    const sameDir = c.direction && prior.direction === c.direction;
    const reverses = c.direction && prior.direction &&
      (OPPOSES[c.direction] === prior.direction || (c.opposes || []).includes(prior.direction));
    if (sameHash && sameDir) refuse('DUPLICATE', { of: prior.id, status, hint: 'already known — disposition it instead of re-proposing' });
    if (sameHash && BINDING_SET.includes(status)) refuse('RERAISE', { of: prior.id, status, hint: 'decided by a human; unchanged code — not re-arguable' });
    if (sameRef && reverses && ['fixed', ...BINDING_SET].includes(status)) {
      appendFileSync(join(RUNS(), run, 'escalations.jsonl'), canon({ candidate: c, conflicts_with: prior.id, run }) + '\n');
      refuse('REVERSAL', { of: prior.id, hint: 'this would reverse settled direction "' + prior.direction + '" — recorded as a tradeoff for the human; decide once' });
    }
    if (prior.facets.activation === 'propose-gate' && status === 'open' && c.severity &&
        !c.scope_changed && c.scope_ref && c.scope_ref.startsWith(prior.scope_ref === '*' ? '' : prior.scope_ref) &&
        SEV.indexOf(c.severity) < SEV.indexOf(prior.depth || 'major'))
      refuse('BELOW_FLOOR', { of: prior.id, depth: prior.depth || 'major', hint: 'below the contracted review depth on unchanged code — request a deeper pass explicitly' });
  }
  const id = nextId(st, staged.length);
  const rec = sortKeys({ t: 'prior', id, ns, type: c.type || 'custom', facets, scope_ref: c.scope_ref, scope_hash: c.scope_hash,
    claim: normText(c.claim), direction: c.direction, severity: c.severity, depth: c.depth, evidence: c.evidence,
    review_every: c.review_every, born: run });
  appendFileSync(stagedFile, JSON.stringify(rec) + '\n');
  console.log(`${id} staged (new)`);
}

/** commit: fail-closed — full disposition coverage or nothing ledgers.
    Missing-scope items need no disposition (nothing to verify against);
    instead they accrue a missing-streak that archives them at K. */
function commit() {
  const run = arg('--run') || usage('commit needs --run');
  const rel = JSON.parse(readFileSync(join(RUNS(), run, 'relevant.json'), 'utf8'));
  const disp = loadLines(join(RUNS(), run, 'dispositions.jsonl'));
  const done = new Set(disp.map((d) => d.id));
  const required = rel.verify.filter((v) => v.scopeState !== 'missing');
  const missing = required.filter((v) => !done.has(v.id)).map((v) => v.id);
  if (missing.length) refuse('INCOMPLETE_DISPOSITIONS', { missing, hint: 'every carried prior must be dispositioned before this run can be recorded' });
  const staged = loadLines(join(RUNS(), run, 'staged.jsonl'));
  const esc = loadLines(join(RUNS(), run, 'escalations.jsonl'));
  for (const d of disp) appendFileSync(LEDGER(), canon(d) + '\n');
  for (const v of rel.verify) if (v.scopeState === 'missing' && !done.has(v.id))
    appendFileSync(LEDGER(), canon({ t: 'event', id: v.id, action: 'scope-missing', run }) + '\n');
  for (const s of staged) appendFileSync(LEDGER(), canon(s) + '\n');
  render(true);
  const { st } = state();
  const nowArchived = Object.values(st).filter((e) => e.prior.ns === rel.ns && isArchived(e)).length;
  const n = (v) => disp.filter((d) => d.to === v).length;
  const calls = n('challenged') + n('obsolete-proposed') + esc.length + (rel.nudges || []).length;
  console.log(`Checked against ${rel.verify.length} priors:`);
  if (n('fixed')) console.log(`  ✓ ${n('fixed')} fixed — nice work`);
  if (n('still-open')) console.log(`  → ${n('still-open')} carried (same items as last run, unchanged)`);
  if (n('stale')) console.log(`  ~ ${n('stale')} touched by changes — re-judged this run`);
  if (calls) console.log(`  ? ${calls} need your call — \`priors status --calls\` to review`);
  if (nowArchived) console.log(`  … ${nowArchived} resting — the code they point at is gone; they wake if it returns`);
  console.log(`New this run: ${staged.length}`);
}

function status() {
  const { st } = state();
  const calls = process.argv.includes('--calls');
  const byNs = {};
  for (const e of Object.values(st)) {
    const { prior, status: s } = e;
    byNs[prior.ns] ||= { open: 0, settled: 0, learned: 0, resting: 0, calls: [] };
    if (s === 'redacted') continue;
    if (isArchived(e)) byNs[prior.ns].resting++;
    else if (BINDING_SET.includes(s)) byNs[prior.ns].settled++;
    else if (prior.facets?.obligation === 'inject-as-instruction' && s === 'open') byNs[prior.ns].learned++;
    else if (s === 'open' || s === 'stale') byNs[prior.ns].open++;
    if (['challenged', 'obsolete-proposed'].includes(s)) byNs[prior.ns].calls.push(prior.id + ' — ' + prior.claim);
  }
  for (const [ns, c] of Object.entries(byNs)) {
    console.log(`${ns}: ${c.open} open · ${c.settled} decided by you · ${c.learned} lessons locked` + (c.resting ? ` · ${c.resting} resting` : ''));
    if (calls) for (const q of c.calls) console.log('  ? ' + q);
  }
  if (!Object.keys(byNs).length) console.log('no priors yet — first run writes them');
}

function render(quiet) {
  const { st } = state();
  const rows = Object.values(st).map((e) => {
    const p = e.prior, s = e.status === 'redacted' ? 'redacted' : isArchived(e) ? 'resting' : e.status;
    return `| ${p.id} | ${p.ns || '—'} | ${p.type || '—'} | ${s} | ${p.scope_ref || '—'} | ${p.redacted ? '▇▇▇ [redacted]' : (p.claim || '').slice(0, 72)} |`;
  });
  writeFileSync(join(DIR, 'PRIORS.md'),
    '# Priors — what is already settled here\n\n*Rendered by the keeper; do not edit — the truth is `ledger.jsonl`.*\n\n' +
    '| id | area | type | status | where | what |\n|---|---|---|---|---|---|\n' + rows.join('\n') + '\n');
  if (!quiet) console.log('rendered .priors/PRIORS.md');
}

/* ── entry ── */
const VERBS = { init, hash: hashCmd, relevant, disposition, decide, redact, propose, commit, status, render: () => render(false) };
export const __test = { canon, sha12, normText, fold, expandType, TYPES, FACETS, OPPOSES, ARCHIVE_K };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const verb = process.argv[2];
  if (!verb || !VERBS[verb]) usage('priors <init|hash|relevant|disposition|decide|redact|propose|commit|status|render>');
  VERBS[verb]();
}
