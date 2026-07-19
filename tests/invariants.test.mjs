// @ts-check
/* Invariant tests for the reference keeper — the four ratchet rules as
   executable law, driven end-to-end through the CLI (exit codes are the
   contract). Run: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEPER = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/priors/scripts/priors.mjs');
function keeper(cwd, args, expectFail = false) {
  try {
    return { out: execFileSync('node', [KEEPER, ...args], { cwd, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    if (!expectFail) throw e;
    return { out: e.stdout?.toString() || '', code: e.status };
  }
}
const cand = (cwd, name, obj) => { const p = join(cwd, name); writeFileSync(p, JSON.stringify(obj)); return p; };

/** Seed a repo with 5 findings in run-001 and commit them. */
function seed(cwd) {
  keeper(cwd, ['init']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({}));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  for (let i = 1; i <= 5; i++)
    keeper(cwd, ['propose', cand(cwd, `c${i}.json`, {
      type: 'conclusion', scope_ref: `src/f${i}.ts#fn`, scope_hash: `hash-v1-${i}`,
      claim: `finding number ${i}`, direction: 'hoist-resource', severity: 'major',
    }), '--ns', 'review', '--run', rel.run]);
  keeper(cwd, ['commit', '--run', rel.run]);
  return rel.run;
}

test('replay: fixed acknowledged, carried keep identity, no re-discovery', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  seed(cwd);
  // run-002: findings 1-3 fixed (hash moved), 4-5 unchanged
  const scopes = { 'src/f1.ts#fn': 'hash-v2-1', 'src/f2.ts#fn': 'hash-v2-2', 'src/f3.ts#fn': 'hash-v2-3', 'src/f4.ts#fn': 'hash-v1-4', 'src/f5.ts#fn': 'hash-v1-5' };
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify(scopes));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  assert.equal(rel.verify.length, 5, 'all five priors exposed for verification');
  assert.equal(rel.verify.filter((v) => v.scopeState === 'changed').length, 3);
  for (const v of rel.verify)
    keeper(cwd, ['disposition', v.id, v.scopeState === 'changed' ? 'fixed' : 'still-open', '--run', rel.run]);
  // duplicate of a carried finding on unchanged code must bounce
  const dup = keeper(cwd, ['propose', cand(cwd, 'dup.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'hash-v1-4',
    claim: 'finding number 4 reworded', direction: 'hoist-resource', severity: 'major',
  }), '--ns', 'review', '--run', rel.run], true);
  assert.equal(dup.code, 1);
  assert.match(dup.out, /DUPLICATE/);
  const summary = keeper(cwd, ['commit', '--run', rel.run]).out;
  assert.match(summary, /3 fixed/);
  assert.match(summary, /2 carried/);
  assert.match(summary, /New this run: 0/);
});

test('carried means carried: a still-open prior reappears in the NEXT run too', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  seed(cwd);
  const scopes = { 'src/f1.ts#fn': 'hash-v1-1', 'src/f2.ts#fn': 'hash-v1-2', 'src/f3.ts#fn': 'hash-v1-3', 'src/f4.ts#fn': 'hash-v1-4', 'src/f5.ts#fn': 'hash-v1-5' };
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify(scopes));
  const r2 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  for (const v of r2.verify) keeper(cwd, ['disposition', v.id, 'still-open', '--run', r2.run]);
  keeper(cwd, ['commit', '--run', r2.run]);
  const r3 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  assert.equal(r3.verify.length, 5, 'all five carried priors are exposed again on run 3');
});

test('ratchet: human wontfix is never re-arguable on unchanged code', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  seed(cwd);
  keeper(cwd, ['decide', 'P-0004', 'wontfix']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({ 'src/f4.ts#fn': 'hash-v1-4' }));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  assert.ok(!rel.verify.find((v) => v.id === 'P-0004'), 'wontfix is settled — not re-verified');
  const r = keeper(cwd, ['propose', cand(cwd, 'r.json', {
    type: 'conclusion', scope_ref: 'src/f4.ts#fn', scope_hash: 'hash-v1-4',
    claim: 'raising it again', direction: 'other-direction', severity: 'major',
  }), '--ns', 'review', '--run', rel.run], true);
  assert.equal(r.code, 1);
  assert.match(r.out, /RERAISE/);
});

test('reversal of applied advice escalates to the human, never emits', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  seed(cwd);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({ 'src/f1.ts#fn': 'hash-v2-1' }));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  keeper(cwd, ['disposition', 'P-0001', 'fixed', '--run', rel.run]);
  const r = keeper(cwd, ['propose', cand(cwd, 'rev.json', {
    type: 'conclusion', scope_ref: 'src/f1.ts#fn', scope_hash: 'hash-v2-1',
    claim: 'actually inline it again', direction: 'inline-resource', severity: 'major',
  }), '--ns', 'review', '--run', rel.run], true);
  assert.equal(r.code, 1);
  assert.match(r.out, /REVERSAL/);
  assert.match(readFileSync(join(cwd, '.priors/runs', rel.run, 'escalations.jsonl'), 'utf8'), /inline-resource/);
});

test('fail-closed: commit refuses until every prior is dispositioned', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  seed(cwd);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({ 'src/f1.ts#fn': 'hash-v1-1' }));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  const r = keeper(cwd, ['commit', '--run', rel.run], true);
  assert.equal(r.code, 1);
  assert.match(r.out, /INCOMPLETE_DISPOSITIONS/);
});

test('depth gate: below-floor dredging on unchanged code is refused', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  keeper(cwd, ['init']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({}));
  const r1 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  keeper(cwd, ['propose', cand(cwd, 'cov.json', {
    type: 'coverage', scope_ref: 'src/', scope_hash: 'tree-v1',
    claim: 'reviewed src/ at depth major', depth: 'major',
  }), '--ns', 'review', '--run', r1.run]);
  keeper(cwd, ['commit', '--run', r1.run]);
  const r2 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  const low = keeper(cwd, ['propose', cand(cwd, 'low.json', {
    type: 'conclusion', scope_ref: 'src/util.ts#fmt', scope_hash: 'zzz',
    claim: 'nit: rename variable', direction: 'rename', severity: 'minor', scope_changed: false,
  }), '--ns', 'review', '--run', r2.run], true);
  assert.equal(low.code, 1);
  assert.match(low.out, /BELOW_FLOOR/);
  // but changed code IS reviewable at any depth
  const ok = keeper(cwd, ['propose', cand(cwd, 'ok.json', {
    type: 'conclusion', scope_ref: 'src/util.ts#fmt', scope_hash: 'zzz2',
    claim: 'nit in new code', direction: 'rename', severity: 'minor', scope_changed: true,
  }), '--ns', 'review', '--run', r2.run]);
  assert.match(ok.out, /staged/);
});

test('attention forgetting: archive after K missing runs, resurrect with history', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  keeper(cwd, ['init']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({}));
  const r1 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  keeper(cwd, ['propose', cand(cwd, 'c.json', {
    type: 'conclusion', scope_ref: 'src/gone.ts#fn', scope_hash: 'hash-v1',
    claim: 'finding in code that will vanish', direction: 'hoist-resource', severity: 'major',
  }), '--ns', 'review', '--run', r1.run]);
  keeper(cwd, ['commit', '--run', r1.run]);
  // five runs with the file gone — no disposition needed for missing scopes
  for (let i = 0; i < 5; i++) {
    const r = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
    keeper(cwd, ['commit', '--run', r.run]);
  }
  const asleep = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  assert.equal(asleep.verify.length, 0, 'archived prior no longer exposed');
  assert.equal(asleep.archived, 1, 'reported as resting, not vanished');
  // the file returns (same content) — the prior wakes with its identity intact
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({ 'src/gone.ts#fn': 'hash-v1' }));
  const awake = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  assert.equal(awake.verify.length, 1);
  assert.equal(awake.verify[0].id, 'P-0001', 'same id — memory, not a fresh review');
  assert.equal(awake.verify[0].resurrected, true);
});

test('record forgetting: redact tombstones content, preserves sequence', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  keeper(cwd, ['init']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({}));
  const r1 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  keeper(cwd, ['propose', cand(cwd, 'c.json', {
    type: 'behavioral', scope_ref: 'some-cli', scope_hash: 'v1',
    claim: 'secret token abc123 works for auth', direction: 'use-token',
  }), '--ns', 'review', '--run', r1.run]);
  keeper(cwd, ['commit', '--run', r1.run]);
  keeper(cwd, ['redact', 'P-0001', '--because', 'captured a credential']);
  const ledger = readFileSync(join(cwd, '.priors/ledger.jsonl'), 'utf8');
  assert.ok(!ledger.includes('abc123'), 'content gone from working truth');
  assert.match(ledger, /"redacted":true/);
  assert.match(ledger, /"action":"redact"/, 'the removal is itself remembered');
  // sequence intact: the next proposal is P-0002, not a reused id
  const r2 = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  const next = keeper(cwd, ['propose', cand(cwd, 'c2.json', {
    type: 'conclusion', scope_ref: 'src/a.ts#f', scope_hash: 'h1',
    claim: 'a new finding', direction: 'rename', severity: 'major',
  }), '--ns', 'review', '--run', r2.run]);
  assert.match(next.out, /P-0002 staged/);
});

test('authority is never self-assigned', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'priors-'));
  keeper(cwd, ['init']);
  writeFileSync(join(cwd, 'scopes.json'), JSON.stringify({}));
  const rel = JSON.parse(keeper(cwd, ['relevant', '--ns', 'review', '--scopes', 'scopes.json']).out);
  const r = keeper(cwd, ['propose', cand(cwd, 'b.json', {
    type: 'calibration', facets: { authority: 'binding' },
    claim: 'I declare myself law', direction: 'x',
  }), '--ns', 'review', '--run', rel.run], true);
  assert.equal(r.code, 2, 'self-assigned binding is a usage error');
});
