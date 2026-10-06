const assert = require('node:assert/strict')
const { test } = require('node:test')
const cleanupOrphanBranches = require('./cleanup-orphan-branches.cjs')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-06-20T00:00:00Z')

function pull(state, overrides = {}) {
  return {
    state,
    closed_at: new Date(NOW - 8 * DAY).toISOString(),
    labels: [],
    head: {
      ref: 'feature',
      sha: 'original-sha',
      repo: { full_name: 'sword/chat' },
    },
    ...overrides,
  }
}

function fixture({
  age = 31,
  name = 'feature',
  protectedBranch = false,
  history = [],
  openPulls = [],
  basePulls = [],
  activity = [],
  dryRun = false,
  options = {},
} = {}) {
  const calls = []
  const record =
    (method, data = {}) =>
    async (args) => {
      calls.push({ method, args })
      return { data }
    }
  const branch = {
    name,
    protected: protectedBranch,
    commit: {
      sha: 'original-sha',
      commit: { committer: { date: new Date(NOW - age * DAY).toISOString() } },
    },
  }
  const rest = {
    repos: {
      get: record('repository', {
        full_name: 'sword/chat',
        default_branch: 'master',
      }),
      listBranches: () => {},
      getBranch: record('branch', branch),
      listActivities: record('activity', activity),
    },
    pulls: { list: () => {} },
    git: { deleteRef: record('delete') },
  }
  const github = {
    rest,
    paginate: async (method, args) => {
      assert.equal(args.per_page, 100)
      if (method === rest.repos.listBranches) return [branch]
      assert.equal(method, rest.pulls.list)
      if (args.base) {
        assert.equal(args.base, name)
        return basePulls
      }
      assert.equal(args.head, `sword:${name}`)
      return args.state === 'all' ? history : openPulls
    },
  }
  return {
    branch,
    calls,
    github,
    run: () =>
      cleanupOrphanBranches({
        github,
        context: { repo: { owner: 'sword', repo: 'chat' } },
        core: {
          info: record('info'),
          warning: record('warning'),
          setFailed: record('failed'),
        },
        now: NOW,
        dryRun,
        options: {
          excludedBranches: [
            'team/*',
            'gov-dev',
            'staging',
            'staging-*',
            'staging/*',
            'release/*',
          ],
          ...options,
        },
      }),
  }
}

test('custom branch inactivity threshold is used', async () => {
  const { run, calls } = fixture({
    age: 31,
    options: { branchInactiveDays: 60 },
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('custom closure grace period is used', async () => {
  const { run, calls } = fixture({
    history: [pull('closed')],
    options: { branchGraceDays: 14 },
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('custom recent-activity grace is used even for unchanged closed heads', async () => {
  const { run, calls } = fixture({
    history: [
      pull('closed', { closed_at: new Date(NOW - 30 * DAY).toISOString() }),
    ],
    activity: [{ timestamp: new Date(NOW - 10 * DAY).toISOString() }],
    options: { branchGraceDays: 14 },
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

for (const merged of [false, true]) {
  test(`deletes a branch with a closed PR (merged=${merged}), regardless of age`, async () => {
    const { run, calls } = fixture({
      age: 1,
      history: [pull('closed', { merged_at: merged ? '2026-06-19' : null })],
    })
    await run()
    assert.equal(
      calls.find((call) => call.method === 'delete').args.ref,
      'heads/feature',
    )
  })
}

test('keeps a branch with an open PR even if it also has closed PRs', async () => {
  const { run, calls } = fixture({ history: [pull('closed'), pull('open')] })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

for (const age of [1, 30, 30.01, 100]) {
  test(`applies the strict 30-day cutoff to a branch aged ${age} days with no PR history`, async () => {
    const { run, calls } = fixture({ age })
    await run()
    assert.equal(
      calls.some((call) => call.method === 'delete'),
      age > 30,
    )
  })
}

for (const options of [
  { name: 'master' },
  { protectedBranch: true },
  ...[
    'team/mobile',
    'team/engagement',
    'gov-dev',
    'staging',
    'staging-d2c',
    'release/1',
  ].map((name) => ({ name })),
]) {
  test(`preserves special branches: ${JSON.stringify(options)}`, async () => {
    const { run, calls } = fixture(options)
    await run()
    assert.deepEqual(
      calls.map((call) => call.method),
      ['repository'],
    )
  })
}

test('ignores closed PRs from a same-named fork branch', async () => {
  const { run, calls } = fixture({
    age: 1,
    history: [
      pull('closed', {
        head: { ref: 'feature', repo: { full_name: 'contributor/chat' } },
      }),
    ],
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('skips branches with missing commit dates when no PR ever existed', async () => {
  const { run, calls, branch } = fixture()
  branch.commit.commit.committer = null
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
  assert.ok(calls.some((call) => call.method === 'warning'))
})

test('preserves a branch if a PR opens during cleanup', async () => {
  const { run, calls } = fixture({ openPulls: [pull('open')] })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

for (const change of ['commit', 'protection']) {
  test(`preserves a branch whose ${change} changes before deletion`, async () => {
    const { run, calls, github, branch } = fixture()
    let reads = 0
    github.rest.repos.getBranch = async () => {
      reads += 1
      return {
        data:
          reads === 1
            ? branch
            : {
                ...branch,
                protected: change === 'protection',
                commit: {
                  ...branch.commit,
                  sha: change === 'commit' ? 'new-sha' : branch.commit.sha,
                },
              },
      }
    }
    await run()
    assert.equal(reads, 2)
    assert.ok(!calls.some((call) => call.method === 'delete'))
  })
}

test('handles a branch disappearing during cleanup', async () => {
  const { run, calls, github } = fixture()
  github.rest.repos.getBranch = async () => {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  await run()
  assert.ok(!calls.some((call) => ['delete', 'failed'].includes(call.method)))
  assert.ok(calls.some((call) => call.method === 'warning'))
})

test('keeps a branch used as an open PR base', async () => {
  const { run, calls } = fixture({ basePulls: [pull('open')] })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

for (const age of [1, 31]) {
  test(`new work after a closed PR uses the 30-day cutoff (age=${age})`, async () => {
    const { run, calls } = fixture({
      age,
      history: [
        pull('closed', {
          head: {
            ref: 'feature',
            sha: 'old-sha',
            repo: { full_name: 'sword/chat' },
          },
        }),
      ],
    })
    await run()
    assert.equal(
      calls.some((call) => call.method === 'delete'),
      age > 30,
    )
  })
}

for (const closedDays of [1, 6, 7]) {
  test(`closed PR grace period: ${closedDays} days`, async () => {
    const { run, calls } = fixture({
      history: [
        pull('closed', {
          closed_at: new Date(NOW - closedDays * DAY).toISOString(),
        }),
      ],
    })
    await run()
    assert.equal(
      calls.some((call) => call.method === 'delete'),
      closedDays >= 7,
    )
  })
}

test('uses the most recent closure across all PRs', async () => {
  const { run, calls } = fixture({
    history: [
      pull('closed'),
      pull('closed', { closed_at: new Date(NOW - DAY).toISOString() }),
    ],
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('mixed-case exemption also preserves closed PR branches', async () => {
  const { run, calls } = fixture({
    history: [pull('closed', { labels: [{ name: 'Keep-Open' }] })],
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('keep-open also exempts branches with closed PR history', async () => {
  const { run, calls } = fixture({
    history: [pull('closed', { labels: [{ name: 'keep-open' }] })],
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

for (const history of [[], [pull('closed')]]) {
  test(`recent push/creation keeps an old tip (closed PR=${!!history.length})`, async () => {
    const { run, calls } = fixture({
      age: 100,
      history,
      activity: [{ timestamp: new Date(NOW - DAY).toISOString() }],
    })
    await run()
    assert.ok(!calls.some((call) => call.method === 'delete'))
    assert.equal(
      calls.find((call) => call.method === 'activity').args.ref,
      'refs/heads/feature',
    )
  })
}

test('a recent push of an old commit does not count as 30 days inactive', async () => {
  const { run, calls } = fixture({
    age: 100,
    activity: [{ timestamp: new Date(NOW - 20 * DAY).toISOString() }],
  })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
})

test('invalid activity timestamp fails safe', async () => {
  const { run, calls } = fixture({ activity: [{ timestamp: 'invalid' }] })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
  assert.ok(calls.some((call) => call.method === 'warning'))
})

test('dry run logs candidates without deleting', async () => {
  const { run, calls } = fixture({ dryRun: true })
  await run()
  assert.ok(!calls.some((call) => call.method === 'delete'))
  assert.ok(
    calls.some(
      (call) => call.method === 'info' && call.args.includes('[dry-run]'),
    ),
  )
})

test('reports branch deletion failures', async () => {
  const { run, calls, github } = fixture()
  github.rest.git.deleteRef = async () => {
    throw new Error('Permission denied')
  }
  await run()
  assert.ok(calls.some((call) => call.method === 'failed'))
})
