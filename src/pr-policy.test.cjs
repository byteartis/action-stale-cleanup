const assert = require('node:assert/strict')
const { test } = require('node:test')
const { decidePullRequest, WARNING_MARKER } = require('./pr-policy.cjs')
const { resolveOptions, DAY_MS } = require('./config.cjs')
const now = Date.parse('2026-06-20T00:00:00Z')
const ago = (days) => new Date(now - days * DAY_MS).toISOString()
function scenario(overrides = {}) {
  return {
    now,
    options: resolveOptions(),
    repository: { full_name: 'owner/repo', default_branch: 'main' },
    pr: {
      state: 'open',
      merged: false,
      draft: false,
      created_at: ago(15),
      updated_at: ago(0),
      labels: [{ name: 'stale' }],
      head: { ref: 'feature', repo: { full_name: 'owner/repo' } },
    },
    events: [
      { event: 'labeled', label: { name: 'stale' }, created_at: ago(7) },
    ],
    comments: [
      {
        body: WARNING_MARKER,
        user: { login: 'github-actions[bot]' },
        created_at: ago(7),
      },
    ],
    ...overrides,
  }
}

for (const [age, expected] of [
  [1, 'skip'],
  [7, 'skip'],
  [7.00001, 'warn'],
]) {
  test(`warning creation-age boundary ${age}`, () => {
    const s = scenario({ events: [], comments: [] })
    s.pr.created_at = ago(age)
    s.pr.labels = []
    assert.equal(decidePullRequest(s).action, expected)
  })
}
for (const [age, expected] of [
  [6.99999, 'wait'],
  [7, 'close'],
  [7.00001, 'close'],
]) {
  test(`fixed deadline boundary ${age}`, () => {
    const s = scenario()
    s.events[0].created_at = s.comments[0].created_at = ago(age)
    const d = decidePullRequest(s)
    assert.equal(d.action, expected)
    assert.equal(d.deadline, Date.parse(ago(age)) + 7 * DAY_MS)
  })
}
test('later of warning and label gets a full period', () => {
  for (const later of ['warning', 'label']) {
    const s = scenario()
    if (later === 'warning') s.comments[0].created_at = ago(2)
    else s.events[0].created_at = ago(2)
    assert.equal(decidePullRequest(s).action, 'wait')
    assert.equal(decidePullRequest(s).deadline, now + 5 * DAY_MS)
  }
})
test('human comments, pushes/updated_at and unrelated labels do not postpone closure', () => {
  const s = scenario()
  s.comments.push({
    body: 'Still working',
    user: { login: 'human', type: 'User' },
    created_at: ago(0),
  })
  s.events.push({
    event: 'unlabeled',
    label: { name: 'bug' },
    created_at: ago(0),
  })
  assert.equal(decidePullRequest(s).action, 'close')
})
for (const event of [
  'reopened',
  'ready_for_review',
  'exemption-removed',
  'stale-removed',
]) {
  test(`${event} resets, including same-second ambiguity`, () => {
    for (const age of [0, 7]) {
      const s = scenario()
      s.events.push({
        event: event.endsWith('removed') ? 'unlabeled' : event,
        label: { name: event === 'exemption-removed' ? 'KEEP-OPEN' : 'STALE' },
        created_at: ago(age),
      })
      const d = decidePullRequest(s)
      assert.equal(d.action, 'warn')
      assert.equal(d.resetLabel, false)
      assert.equal(d.reuseWarning, false)
      assert.ok(d.resetReason)
    }
  })
}
test('event array order cannot bypass a newer reset', () => {
  const s = scenario()
  s.events.unshift({ event: 'reopened', created_at: ago(0) })
  assert.equal(decidePullRequest(s).action, 'warn')
})
test('a strictly newer warning survives an older reset', () => {
  const s = scenario()
  s.events.push({ event: 'reopened', created_at: ago(8) })
  assert.equal(decidePullRequest(s).action, 'close')
})
for (const missing of ['warning', 'label-event']) {
  test(`missing ${missing} cannot authorize closure`, () => {
    const s = scenario()
    if (missing === 'warning') s.comments = []
    else s.events = []
    assert.equal(decidePullRequest(s).action, 'warn')
    assert.equal(decidePullRequest(s).reuseWarning, false)
    assert.equal(decidePullRequest(s).resetLabel, missing === 'label-event')
  })
}
for (const [labelAge, reuseWarning] of [
  [2, true],
  [1, false],
  [0, false],
]) {
  test(`missing label with recorded application ${labelAge} days ago narrows warning reuse`, () => {
    const s = scenario()
    s.pr.labels = []
    s.events[0].created_at = ago(labelAge)
    s.comments[0].created_at = ago(1)
    const decision = decidePullRequest(s)
    assert.equal(decision.action, 'warn')
    assert.equal(decision.reuseWarning, reuseWarning)
  })
}
test('a delivered warning can be reused only to retry a missing label', () => {
  const s = scenario({ events: [] })
  s.comments[0].created_at = ago(1)
  s.pr.labels = []
  const d = decidePullRequest(s)
  assert.equal(d.action, 'warn')
  assert.equal(d.reuseWarning, true)
  assert.equal(d.resetLabel, false)
})
for (const [warningAge, reuseWarning] of [
  [6.99999, true],
  [7, false],
  [7.00001, false],
  [200, false],
]) {
  test(`renamed stale label and warning age ${warningAge} bounds quiet retry`, () => {
    const s = scenario({ options: resolveOptions({ staleLabel: 'inactive' }) })
    s.pr.created_at = ago(250)
    s.comments[0].created_at = ago(warningAge)
    s.comments[0].body += '\nRemove `stale` to restart the warning.'
    const d = decidePullRequest(s)
    assert.equal(d.action, 'warn')
    assert.equal(d.reuseWarning, reuseWarning)
    assert.equal(d.resetLabel, false)
  })
}
for (const [prStaleDays, prWarningDays, reuseWarning] of [
  [2, 10, true],
  [20, 3, false],
]) {
  test(`rename retry uses warning period ${prWarningDays}, not creation threshold ${prStaleDays}`, () => {
    const s = scenario({
      options: resolveOptions({
        staleLabel: 'inactive',
        prStaleDays,
        prWarningDays,
      }),
    })
    s.pr.created_at = ago(50)
    const decision = decidePullRequest(s)
    assert.equal(decision.action, 'warn')
    assert.equal(decision.reuseWarning, reuseWarning)
  })
}
test('expired warning without label history requires a fresh comment', () => {
  const s = scenario({ events: [] })
  s.pr.created_at = ago(250)
  s.pr.labels = []
  s.comments[0].created_at = ago(200)
  assert.equal(decidePullRequest(s).reuseWarning, false)
})
test('stale-label removal makes a prior warning ineligible for retry', () => {
  const s = scenario({
    events: [
      { event: 'unlabeled', label: { name: 'stale' }, created_at: ago(1) },
    ],
  })
  s.pr.labels = []
  s.comments[0].created_at = ago(2)
  assert.equal(decidePullRequest(s).reuseWarning, false)
})
for (const kind of ['creation', 'warning', 'label', 'reset', 'foreign']) {
  test(`invalid ${kind} timestamp fails closed without mutations`, () => {
    const s = scenario()
    if (kind === 'creation') s.pr.created_at = 'invalid'
    if (kind === 'warning') s.comments[0].created_at = 'invalid'
    if (kind === 'label') s.events[0].created_at = 'invalid'
    if (kind === 'reset')
      s.events.push({ event: 'reopened', created_at: 'invalid' })
    if (kind === 'foreign')
      s.comments.push({
        body: WARNING_MARKER,
        user: { login: 'other[bot]', type: 'Bot' },
        created_at: 'invalid',
      })
    const d = decidePullRequest(s)
    assert.equal(d.action, 'skip')
    assert.match(d.reason, /invalid/)
  })
}
test('irrelevant malformed timestamps and outsider markers do not control policy', () => {
  const s = scenario()
  s.events.push({
    event: 'unlabeled',
    label: { name: 'bug' },
    created_at: 'invalid',
  })
  s.comments.push({
    body: WARNING_MARKER,
    user: { login: 'outsider', type: 'User' },
    author_association: 'NONE',
    created_at: 'invalid',
  })
  assert.equal(decidePullRequest(s).action, 'close')
})
test('future warning/label evidence cannot authorize closure', () => {
  const s = scenario()
  s.comments[0].created_at = ago(-1)
  assert.equal(decidePullRequest(s).action, 'skip')
  assert.equal(decidePullRequest(s).reason, 'evidence-after-run-start')
})
test('a PR created after the run began is deferred rather than marked invalid', () => {
  const s = scenario()
  s.pr.created_at = new Date(now + 1000).toISOString()
  assert.deepEqual(decidePullRequest(s), {
    action: 'skip',
    reason: 'creation-after-run-start',
  })
})
test('edited marker remains anchored to creation; deleted/removed marker requires warning', () => {
  const s = scenario()
  s.comments[0].updated_at = ago(0)
  assert.equal(decidePullRequest(s).action, 'close')
  s.comments[0].body = 'marker removed'
  assert.equal(decidePullRequest(s).action, 'warn')
})
test('unsupported privileged markers block without becoming closure evidence', () => {
  const s = scenario()
  s.comments[0].user = { login: 'other[bot]', type: 'Bot' }
  assert.equal(decidePullRequest(s).action, 'skip')
  assert.equal(decidePullRequest(s).reason, 'unsupported-warning-author')
})
test('current thresholds govern pending warnings', () => {
  const s = scenario({ options: resolveOptions({ prWarningDays: 10 }) })
  assert.equal(decidePullRequest(s).action, 'wait')
  s.options = resolveOptions({ prWarningDays: 5 })
  assert.equal(decidePullRequest(s).action, 'close')
})
for (const exemption of [
  'closed',
  'merged',
  'draft',
  'label',
  'default',
  'excluded',
]) {
  test(`current ${exemption} overrides deadline`, () => {
    const s = scenario()
    if (exemption === 'closed') s.pr.state = 'closed'
    if (exemption === 'merged') s.pr.merged = true
    if (exemption === 'draft') s.pr.draft = true
    if (exemption === 'label') s.pr.labels.push({ name: 'KEEP-OPEN' })
    if (exemption === 'default') s.pr.head.ref = 'main'
    if (exemption === 'excluded')
      s.options = resolveOptions({ excludedBranches: ['feature'] })
    assert.equal(decidePullRequest(s).action, 'skip')
  })
}
test('fork branch name does not inherit local exclusions', () => {
  const s = scenario()
  s.pr.head.ref = 'main'
  s.pr.head.repo.full_name = 'fork/repo'
  assert.equal(decidePullRequest(s).action, 'close')
})
