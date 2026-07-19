#!/usr/bin/env python3
"""priors.py — Python keeper for the PRIORS standard (see PRIORS.md).

Behavior-identical twin of priors.mjs, for environments where node is not
available or not permitted (e.g. rote workspace guards allow python and
block other interpreters). Same ledger format, same refusal codes, same
exit-code contract: 0 ok · 1 refused (JSON on stdout) · 2 usage error.
Zero dependencies; Python >= 3.9.
"""
import hashlib, json, os, re, sys

DIR = '.priors'
LEDGER = os.path.join(DIR, 'ledger.jsonl')
RUNS = os.path.join(DIR, 'runs')
ARCHIVE_K = 5  # consecutive runs with the scope missing -> archived (asleep, not gone)

FACETS = {
    'scope': ['content-hash', 'tool-version', 'env-fingerprint', 'repo-wide'],
    'activation': ['run-start', 'verify-phase', 'propose-gate'],
    'obligation': ['disposition-required', 'inject-as-instruction', 'veto-only'],
    'authority': ['advisory', 'binding'],
    'lifecycle': ['stale-on-scope-change', 'challenged-on-failure', 'only-by-supersession'],
}
TYPES = {
    'conclusion':  {'scope': 'content-hash', 'activation': 'verify-phase', 'obligation': 'disposition-required', 'authority': 'advisory', 'lifecycle': 'stale-on-scope-change'},
    'behavioral':  {'scope': 'tool-version', 'activation': 'run-start', 'obligation': 'inject-as-instruction', 'authority': 'advisory', 'lifecycle': 'challenged-on-failure'},
    'coverage':    {'scope': 'content-hash', 'activation': 'propose-gate', 'obligation': 'veto-only', 'authority': 'advisory', 'lifecycle': 'stale-on-scope-change'},
    'calibration': {'scope': 'repo-wide', 'activation': 'run-start', 'obligation': 'inject-as-instruction', 'authority': 'advisory', 'lifecycle': 'only-by-supersession'},
}
OPPOSES = {
    'terser': 'expand', 'expand': 'terser',
    'proof-earlier': 'proof-later', 'proof-later': 'proof-earlier',
    'cta-singular': 'cta-multiple', 'cta-multiple': 'cta-singular',
    'hoist-resource': 'inline-resource', 'inline-resource': 'hoist-resource',
}
SEV = ['minor', 'major', 'gate']
BINDING_SET = ['accepted', 'wontfix']
AGENT_VERDICTS = ['fixed', 'still-open', 'stale', 'challenged', 'obsolete-proposed']
HUMAN_VERDICTS = ['accepted', 'wontfix', 'obsolete', 'reopen', 'keep']


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def norm_text(s):
    return re.sub(r'\s+', ' ', s).strip()

def sha12(s):
    return hashlib.sha256(s.encode()).hexdigest()[:12]

def load_lines(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]

def append_line(path, obj):
    with open(path, 'a', encoding='utf-8') as f:
        f.write(canon(obj) + '\n')

def fold(lines):
    st, runs_order = {}, []
    def see(r):
        if r and r not in runs_order:
            runs_order.append(r)
    for l in lines:
        if l.get('t') == 'prior':
            see(l.get('born'))
            st[l['id']] = {'prior': l, 'status': 'redacted' if l.get('redacted') else 'open',
                           'lastRun': l.get('born'), 'miss': 0,
                           'humanIdx': -1 if l.get('redacted') else len(runs_order) - 1}
        elif l.get('t') == 'event' and l.get('id') in st:
            see(l.get('run'))
            e = st[l['id']]
            a = l.get('action')
            if a == 'scope-missing':
                e['miss'] += 1
            elif a == 'disposition':
                e['miss'] = 0; e['status'] = l['to']; e['lastRun'] = l.get('run', e['lastRun'])
            elif a == 'decide':
                e['miss'] = 0
                e['status'] = 'open' if l['to'] == 'reopen' else ('accepted' if l['to'] == 'keep' else l['to'])
                e['humanIdx'] = len(runs_order) - 1
            elif a == 'redact':
                e['status'] = 'redacted'
    return st, runs_order

def state():
    return fold(load_lines(LEDGER))

def is_archived(e):
    return e['miss'] >= ARCHIVE_K and e['status'] not in BINDING_SET and e['status'] != 'redacted'

def next_id(st, staged):
    return 'P-%04d' % (len(st) + staged + 1)

def refuse(code, **detail):
    print(canon({'refused': code, **detail}))
    sys.exit(1)

def usage(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)

def arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None

def expand_type(c):
    facets = {**TYPES.get(c.get('type'), {}), **c.get('facets', {})} if c.get('type') else c.get('facets')
    if not facets:
        usage('candidate needs "type" (one of %s) or explicit "facets"' % '/'.join(TYPES))
    for k, vals in FACETS.items():
        if facets.get(k) not in vals:
            usage('facet %s=%s invalid; allowed: %s' % (k, facets.get(k), ', '.join(vals)))
    if facets['obligation'] == 'inject-as-instruction' and facets['activation'] != 'run-start':
        usage('inject requires activation run-start')
    if facets['obligation'] == 'disposition-required' and facets['activation'] != 'verify-phase':
        usage('disposition-required requires verify-phase')
    if facets['obligation'] == 'veto-only' and facets['activation'] != 'propose-gate':
        usage('veto-only requires propose-gate')
    if facets['scope'] == 'repo-wide' and facets['lifecycle'] == 'stale-on-scope-change':
        usage('repo-wide scope cannot be stale-on-scope-change')
    if facets['authority'] == 'binding':
        usage('authority is never self-assigned: priors are born advisory; use `decide` to promote')
    return facets

def render(quiet=True):
    st, _ = state()
    rows = []
    for e in st.values():
        p, s = e['prior'], ('redacted' if e['status'] == 'redacted' else 'resting' if is_archived(e) else e['status'])
        what = '▇▇▇ [redacted]' if p.get('redacted') else (p.get('claim') or '')[:72]
        rows.append('| %s | %s | %s | %s | %s | %s |' % (p['id'], p.get('ns', '—'), p.get('type', '—'), s, p.get('scope_ref', '—'), what))
    with open(os.path.join(DIR, 'PRIORS.md'), 'w', encoding='utf-8') as f:
        f.write('# Priors — what is already settled here\n\n*Rendered by the keeper; do not edit — the truth is `ledger.jsonl`.*\n\n'
                '| id | area | type | status | where | what |\n|---|---|---|---|---|---|\n' + '\n'.join(rows) + '\n')
    if not quiet:
        print('rendered .priors/PRIORS.md')

def cmd_init():
    os.makedirs(RUNS, exist_ok=True)
    if not os.path.exists(LEDGER):
        open(LEDGER, 'w').close()
    render()
    print('priors: ready (.priors/ created — commit it with your repo)')

def cmd_hash():
    text = arg('--text')
    file = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else None
    if text is not None:
        print(sha12(norm_text(text)))
    elif file:
        print(sha12(norm_text(open(file, encoding='utf-8').read())))
    else:
        usage('priors hash <file> | priors hash --text "..."')

def cmd_relevant():
    ns = arg('--ns') or usage('relevant needs --ns')
    run = arg('--run')
    scopes_file = arg('--scopes')
    scopes = json.load(open(scopes_file)) if scopes_file else {}
    os.makedirs(RUNS, exist_ok=True)
    if not run:
        n = len([d for d in os.listdir(RUNS) if d.startswith('run-')]) + 1
        run = 'run-%03d' % n
    os.makedirs(os.path.join(RUNS, run), exist_ok=True)
    st, runs_order = state()
    inject, verify, nudges, floors = [], [], [], []
    settled = archived = 0
    for e in st.values():
        prior, status = e['prior'], e['status']
        if prior.get('ns') != ns or status in ('obsolete', 'redacted'):
            continue
        f = prior['facets']
        if f['activation'] == 'run-start' and status in ['open'] + BINDING_SET:
            inject.append({'id': prior['id'], 'claim': prior.get('claim'), 'status': status})
            if prior.get('review_every') and (len(runs_order) - 1 - e['humanIdx']) >= prior['review_every']:
                nudges.append({'id': prior['id'], 'claim': prior.get('claim'),
                               'ask': 'still true? reply: decide %s keep — or retire it' % prior['id']})
        elif f['activation'] == 'verify-phase' and status in ('open', 'stale', 'challenged'):
            cur = scopes.get(prior.get('scope_ref'))
            if is_archived(e):
                if cur is None:
                    archived += 1
                    continue
                verify.append({'id': prior['id'], 'claim': prior.get('claim'), 'scope_ref': prior.get('scope_ref'),
                               'severity': prior.get('severity'),
                               'scopeState': 'unchanged' if cur == prior.get('scope_hash') else 'changed',
                               'resurrected': True})
            else:
                ss = 'missing' if cur is None else ('unchanged' if cur == prior.get('scope_hash') else 'changed')
                verify.append({'id': prior['id'], 'claim': prior.get('claim'), 'scope_ref': prior.get('scope_ref'),
                               'severity': prior.get('severity'), 'scopeState': ss})
        elif status in BINDING_SET:
            settled += 1
        if f['activation'] == 'propose-gate' and status == 'open':
            floors.append({'id': prior['id'], 'scope_ref': prior.get('scope_ref'), 'depth': prior.get('depth', 'major')})
    out = {'run': run, 'ns': ns, 'inject': inject, 'verify': verify, 'nudges': nudges,
           'settled': settled, 'archived': archived, 'floors': floors}
    with open(os.path.join(RUNS, run, 'relevant.json'), 'w', encoding='utf-8') as f:
        f.write(canon({**out, 'scopes': scopes}) + '\n')
    print(canon(out))

def cmd_disposition():
    pid, verdict = sys.argv[2], sys.argv[3]
    run = arg('--run') or usage('disposition needs --run')
    if verdict not in AGENT_VERDICTS:
        usage('agent verdicts: %s — accepted/wontfix/keep are human words: use `decide`' % ' | '.join(AGENT_VERDICTS))
    st, _ = state()
    if pid not in st:
        refuse('UNKNOWN_PRIOR', id=pid)
    if st[pid]['status'] in BINDING_SET:
        refuse('BINDING_IMMUTABLE', id=pid, status=st[pid]['status'], hint='only a human `decide reopen` can touch this')
    if st[pid]['status'] == 'redacted':
        refuse('REDACTED', id=pid)
    append_line(os.path.join(RUNS, run, 'dispositions.jsonl'),
                {'t': 'event', 'id': pid, 'action': 'disposition', 'to': verdict, 'run': run, 'by': 'agent'})
    print('%s → %s' % (pid, verdict))

def cmd_decide():
    pid, verdict = sys.argv[2], sys.argv[3]
    if verdict not in HUMAN_VERDICTS:
        usage('decide verdicts: ' + ' | '.join(HUMAN_VERDICTS))
    st, _ = state()
    if pid not in st:
        refuse('UNKNOWN_PRIOR', id=pid)
    if st[pid]['status'] == 'redacted':
        refuse('REDACTED', id=pid)
    reason = arg('--because')
    if verdict == 'reopen' and not reason:
        usage('reopen requires --because "reason" (the ratchet unlocks loudly, never silently)')
    ev = {'t': 'event', 'id': pid, 'action': 'decide', 'to': verdict, 'by': 'human'}
    if reason:
        ev['reason'] = reason
    append_line(LEDGER, ev)
    render()
    print('%s → %s (your call — this sticks)' % (pid, verdict))

def cmd_redact():
    pid = sys.argv[2]
    reason = arg('--because') or usage('redact requires --because "reason"')
    lines = load_lines(LEDGER)
    found = False
    out = []
    for l in lines:
        if l.get('t') == 'prior' and l.get('id') == pid:
            found = True
            out.append({'t': 'prior', 'id': l['id'], 'ns': l.get('ns'), 'redacted': True,
                        'content_hash': sha12(canon(l)), 'born': l.get('born')})
        else:
            out.append(l)
    if not found:
        refuse('UNKNOWN_PRIOR', id=pid)
    with open(LEDGER, 'w', encoding='utf-8') as f:
        f.write('\n'.join(canon(l) for l in out) + '\n')
    append_line(LEDGER, {'t': 'event', 'id': pid, 'action': 'redact', 'by': 'human', 'reason': reason})
    render()
    print('%s redacted — content removed, removal remembered. Note: git history still holds the old line; scrub history separately if this was a secret.' % pid)

def cmd_propose():
    run = arg('--run') or usage('propose needs --run')
    ns = arg('--ns') or usage('propose needs --ns')
    file = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else usage('propose <candidate.json> --run R --ns N')
    c = json.load(open(file, encoding='utf-8'))
    facets = expand_type(c)
    if facets['scope'] != 'repo-wide' and (not c.get('scope_ref') or not c.get('scope_hash')):
        usage('non-repo-wide candidates need scope_ref and scope_hash')
    if not c.get('claim'):
        usage('candidate needs a claim')
    st, _ = state()
    disp_file = os.path.join(RUNS, run, 'dispositions.jsonl')
    for d in load_lines(disp_file):
        if d['id'] in st:
            st[d['id']]['status'] = d['to']
    staged_file = os.path.join(RUNS, run, 'staged.jsonl')
    staged = load_lines(staged_file)
    for e in st.values():
        prior, status = e['prior'], e['status']
        if prior.get('ns') != ns or prior.get('redacted'):
            continue
        same_ref = prior.get('scope_ref') and prior.get('scope_ref') == c.get('scope_ref')
        same_hash = same_ref and prior.get('scope_hash') == c.get('scope_hash')
        same_dir = c.get('direction') and prior.get('direction') == c.get('direction')
        reverses = c.get('direction') and prior.get('direction') and (
            OPPOSES.get(c['direction']) == prior['direction'] or prior['direction'] in c.get('opposes', []))
        if same_hash and same_dir:
            refuse('DUPLICATE', of=prior['id'], status=status, hint='already known — disposition it instead of re-proposing')
        if same_hash and status in BINDING_SET:
            refuse('RERAISE', of=prior['id'], status=status, hint='decided by a human; unchanged code — not re-arguable')
        if same_ref and reverses and status in ['fixed'] + BINDING_SET:
            append_line(os.path.join(RUNS, run, 'escalations.jsonl'), {'candidate': c, 'conflicts_with': prior['id'], 'run': run})
            refuse('REVERSAL', of=prior['id'], hint='this would reverse settled direction "%s" — recorded as a tradeoff for the human; decide once' % prior['direction'])
        if (prior['facets']['activation'] == 'propose-gate' and status == 'open' and c.get('severity')
                and not c.get('scope_changed') and c.get('scope_ref')
                and c['scope_ref'].startswith('' if prior.get('scope_ref') == '*' else prior.get('scope_ref', ''))
                and SEV.index(c['severity']) < SEV.index(prior.get('depth', 'major'))):
            refuse('BELOW_FLOOR', of=prior['id'], depth=prior.get('depth', 'major'), hint='below the contracted review depth on unchanged code — request a deeper pass explicitly')
    pid = next_id(st, len(staged))
    rec = {'t': 'prior', 'id': pid, 'ns': ns, 'type': c.get('type', 'custom'), 'facets': facets,
           'scope_ref': c.get('scope_ref'), 'scope_hash': c.get('scope_hash'), 'claim': norm_text(c['claim']),
           'direction': c.get('direction'), 'severity': c.get('severity'), 'depth': c.get('depth'),
           'evidence': c.get('evidence'), 'review_every': c.get('review_every'), 'born': run}
    rec = {k: v for k, v in rec.items() if v is not None}
    append_line(staged_file, rec)
    print('%s staged (new)' % pid)

def cmd_commit():
    run = arg('--run') or usage('commit needs --run')
    rel = json.load(open(os.path.join(RUNS, run, 'relevant.json'), encoding='utf-8'))
    disp = load_lines(os.path.join(RUNS, run, 'dispositions.jsonl'))
    done = {d['id'] for d in disp}
    required = [v for v in rel['verify'] if v.get('scopeState') != 'missing']
    missing = [v['id'] for v in required if v['id'] not in done]
    if missing:
        refuse('INCOMPLETE_DISPOSITIONS', missing=missing, hint='every carried prior must be dispositioned before this run can be recorded')
    staged = load_lines(os.path.join(RUNS, run, 'staged.jsonl'))
    esc = load_lines(os.path.join(RUNS, run, 'escalations.jsonl'))
    for d in disp:
        append_line(LEDGER, d)
    for v in rel['verify']:
        if v.get('scopeState') == 'missing' and v['id'] not in done:
            append_line(LEDGER, {'t': 'event', 'id': v['id'], 'action': 'scope-missing', 'run': run})
    for s in staged:
        append_line(LEDGER, s)
    render()
    st, _ = state()
    now_archived = sum(1 for e in st.values() if e['prior'].get('ns') == rel['ns'] and is_archived(e))
    def n(v):
        return sum(1 for d in disp if d['to'] == v)
    calls = n('challenged') + n('obsolete-proposed') + len(esc) + len(rel.get('nudges', []))
    print('Checked against %d priors:' % len(rel['verify']))
    if n('fixed'):
        print('  ✓ %d fixed — nice work' % n('fixed'))
    if n('still-open'):
        print('  → %d carried (same items as last run, unchanged)' % n('still-open'))
    if n('stale'):
        print('  ~ %d touched by changes — re-judged this run' % n('stale'))
    if calls:
        print('  ? %d need your call — `priors status --calls` to review' % calls)
    if now_archived:
        print('  … %d resting — the code they point at is gone; they wake if it returns' % now_archived)
    print('New this run: %d' % len(staged))

def cmd_status():
    st, _ = state()
    calls = '--calls' in sys.argv
    by_ns = {}
    for e in st.values():
        prior, s = e['prior'], e['status']
        c = by_ns.setdefault(prior.get('ns', '—'), {'open': 0, 'settled': 0, 'learned': 0, 'resting': 0, 'calls': []})
        if s == 'redacted':
            continue
        if is_archived(e):
            c['resting'] += 1
        elif s in BINDING_SET:
            c['settled'] += 1
        elif prior.get('facets', {}).get('obligation') == 'inject-as-instruction' and s == 'open':
            c['learned'] += 1
        elif s in ('open', 'stale'):
            c['open'] += 1
        if s in ('challenged', 'obsolete-proposed'):
            c['calls'].append('%s — %s' % (prior['id'], prior.get('claim')))
    for ns, c in by_ns.items():
        line = '%s: %d open · %d decided by you · %d lessons locked' % (ns, c['open'], c['settled'], c['learned'])
        if c['resting']:
            line += ' · %d resting' % c['resting']
        print(line)
        if calls:
            for q in c['calls']:
                print('  ? ' + q)
    if not by_ns:
        print('no priors yet — first run writes them')

VERBS = {'init': cmd_init, 'hash': cmd_hash, 'relevant': cmd_relevant, 'disposition': cmd_disposition,
         'decide': cmd_decide, 'redact': cmd_redact, 'propose': cmd_propose, 'commit': cmd_commit,
         'status': cmd_status, 'render': lambda: render(False)}

if __name__ == '__main__':
    verb = sys.argv[1] if len(sys.argv) > 1 else None
    if not verb or verb not in VERBS:
        usage('priors <init|hash|relevant|disposition|decide|redact|propose|commit|status|render>')
    VERBS[verb]()
