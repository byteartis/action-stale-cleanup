const NOW = Date.parse('2026-06-20T00:00:00Z')
const DAY = 86_400_000
const ago = (days) => new Date(NOW - days * DAY).toISOString()
const marker = '<!-- repository-cleanup:stale-warning -->'
const humanComment = {
  id: 200,
  body: 'Please keep discussing this PR',
  created_at: ago(1),
  user: { login: 'contributor', type: 'User' },
  author_association: 'NONE',
}

// Expected actions are recorded separately; equality is never assumed.
const cases = [
  {
    name: 'warn by creation age despite recent activity',
    stale: false,
    updated: 1,
    expected: ['warn', 'warn'],
  },
  {
    name: 'strict creation-age boundary',
    stale: false,
    age: 7,
    expected: ['none', 'none'],
  },
  {
    name: 'creation-age boundary plus one millisecond',
    stale: false,
    age: 7 + 1 / DAY,
    expected: ['warn', 'warn'],
  },
  { name: 'draft exemption', draft: true, expected: ['none', 'none'] },
  { name: 'keep-open exemption', exempt: true, expected: ['none', 'none'] },
  {
    name: 'case-insensitive exemption',
    exempt: true,
    upper: true,
    expected: ['none', 'none'],
  },
  {
    name: 'draft exemption can be disabled',
    draft: true,
    options: { exemptDrafts: false },
    expected: ['close', 'close'],
  },
  {
    name: 'waiting within the warning window',
    flagged: 6,
    warned: 6,
    updated: 6,
    expected: ['none', 'none'],
  },
  { name: 'close an undisturbed warned PR', expected: ['close', 'close'] },
  {
    name: 'exact closure boundary is inclusive locally',
    flagged: 7,
    warned: 7,
    updated: 7,
    expected: ['close', 'none'],
  },
  {
    name: 'recent human comment does not postpone local closure',
    updated: 1,
    comments: [humanComment],
    expected: ['close', 'none'],
  },
  {
    name: 'human comment after labeling still blocks upstream after inactivity window',
    flagged: 10,
    warned: 10,
    comments: [{ ...humanComment, created_at: ago(9) }],
    expected: ['close', 'none'],
  },
  {
    name: 'recent push does not postpone local closure',
    updated: 1,
    expected: ['close', 'none'],
  },
  {
    name: 'unrelated label update does not postpone local closure',
    updated: 1,
    events: [{ event: 'labeled', label: { name: 'bug' }, created_at: ago(1) }],
    expected: ['close', 'none'],
  },
  {
    name: 'manually applied stale label is not delivered-warning evidence',
    warned: null,
    expected: ['warn', 'close'],
  },
  {
    name: 'missing stale-label event requires fresh warning',
    flagged: null,
    expected: ['warn', 'close'],
  },
  {
    name: 'upstream warning text requires a fresh local migration warning',
    upstreamWarning: true,
    expected: ['warn', 'close'],
  },
  {
    name: 'reopening requires a fresh local warning',
    flagged: 10,
    warned: 10,
    events: [{ event: 'reopened', created_at: ago(9) }],
    expected: ['warn', 'close'],
  },
  {
    name: 'ready-for-review requires a fresh local warning',
    flagged: 10,
    warned: 10,
    events: [{ event: 'ready_for_review', created_at: ago(9) }],
    expected: ['warn', 'close'],
  },
  {
    name: 'removing exemption requires a fresh local warning',
    flagged: 10,
    warned: 10,
    events: [
      { event: 'unlabeled', label: { name: 'keep-open' }, created_at: ago(9) },
    ],
    expected: ['warn', 'close'],
  },
  {
    name: 'local branch exclusion exempts the entire PR',
    local: true,
    branch: 'release/1',
    stale: false,
    expected: ['none', 'warn'],
  },
  {
    name: 'fork branch name does not inherit local branch exclusion',
    branch: 'release/1',
    stale: false,
    expected: ['warn', 'warn'],
  },
  {
    name: 'failed warning prevents local label attempt',
    stale: false,
    fail: 'comment',
    expected: ['none', 'label-only'],
  },
  {
    name: 'label failure never closes on the warning run',
    stale: false,
    fail: 'flag',
    expected: ['none', 'none'],
  },
  {
    name: 'comment-read failure fails safely locally',
    fail: 'comments',
    expected: ['none', 'close'],
  },
  {
    name: 'final PR read catches a newly added exemption',
    finalExempt: true,
    expected: ['none', 'close'],
  },
  {
    name: 'warning and label evidence on second pages',
    evidencePage: 2,
    expected: ['close', 'close'],
  },
  {
    name: 'upstream comment check only reads its first page',
    flagged: 10,
    warned: 10,
    comments: Array.from({ length: 30 }, (_, id) => ({
      ...humanComment,
      created_at: ago(9),
      id: 300 + id,
      user: { login: 'helper[bot]', type: 'Bot' },
    })).concat({ ...humanComment, created_at: ago(9) }),
    expected: ['close', 'close'],
    humanSecondPage: true,
  },
  {
    name: 'preview warning is mutation-free',
    stale: false,
    preview: true,
    intent: 'warn',
    expected: ['none', 'none'],
  },
  {
    name: 'preview closure is mutation-free',
    preview: true,
    intent: 'close',
    expected: ['none', 'none'],
  },
  {
    name: 'preview evidence failure is mutation-free',
    preview: true,
    fail: 'comments',
    expected: ['none', 'none'],
  },
]

function materialize(input) {
  const scenario = {
    age: 30,
    updated: 8,
    flagged: 8,
    warned: 8,
    stale: true,
    ...input,
  }
  const label = (name) => ({ name: scenario.upper ? name.toUpperCase() : name })
  const repository = { full_name: 'owner/repo', default_branch: 'main' }
  const pr = {
    number: 1,
    title: 'Fixture PR',
    state: 'open',
    merged: false,
    locked: false,
    draft: Boolean(scenario.draft),
    assignees: [],
    created_at: ago(scenario.age),
    updated_at: ago(scenario.updated),
    labels: [
      ...(scenario.stale ? [label('stale')] : []),
      ...(scenario.exempt ? [label('keep-open')] : []),
    ],
    pull_request: { url: 'https://api.github.test/repos/owner/repo/pulls/1' },
    head: {
      ref: scenario.branch || 'feature',
      sha: 'original-sha',
      repo: {
        full_name: scenario.local ? repository.full_name : 'contributor/repo',
      },
    },
    base: { ref: 'main', repo: { full_name: repository.full_name } },
  }
  const events = [
    ...(scenario.evidencePage === 2
      ? Array.from({ length: 100 }, (_, id) => ({
          id,
          event: 'assigned',
          created_at: ago(20),
        }))
      : []),
    ...(scenario.stale && scenario.flagged !== null
      ? [
          {
            id: 101,
            event: 'labeled',
            label: label('stale'),
            created_at: ago(scenario.flagged),
          },
        ]
      : []),
    ...(scenario.events || []),
  ]
  const comments = [
    ...(scenario.evidencePage === 2
      ? Array.from({ length: 100 }, (_, id) => ({
          id,
          body: 'Old comment',
          created_at: ago(20),
          user: { type: 'Bot', login: 'helper[bot]' },
        }))
      : []),
    ...(scenario.stale && scenario.warned !== null
      ? [
          {
            id: 101,
            body: scenario.upstreamWarning ? 'This PR is stale' : marker,
            created_at: ago(scenario.warned),
            user: { login: 'github-actions[bot]', type: 'Bot' },
            author_association: 'COLLABORATOR',
          },
        ]
      : []),
    ...(scenario.comments || []),
  ]
  return { scenario, repository, pr, events, comments }
}

module.exports = { NOW, DAY, ago, marker, cases, materialize }
