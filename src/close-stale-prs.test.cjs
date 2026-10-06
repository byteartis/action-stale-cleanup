const assert = require('node:assert/strict')
const { test } = require('node:test')
const closeStalePullRequests = require('./close-stale-prs.cjs')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-06-20T00:00:00Z')
const ago = (days) => new Date(NOW - days * DAY).toISOString()

function fixture({
  age = 15,
  flagged = 7,
  fork = false,
  branch = 'feature',
  merged = false,
  shared = false,
  base = false,
  protectedBranch = false,
  draft = false,
  exempt = false,
  reopened = null,
  dryRun = false,
  warned = flagged,
  warningAuthor = 'github-actions[bot]',
  warningAssociation = 'COLLABORATOR',
  extraComments = [],
  extraEvents = [],
  labelTransform = (name) => name,
  options = {},
} = {}) {
  const calls = []
  const record =
    (name, result = {}) =>
    async (args) => {
      calls.push({ name, args })
      return { data: result }
    }
  const pr = {
    number: 1,
    created_at: ago(age),
    updated_at: ago(0),
    labels: [
      ...(flagged === null ? [] : [{ name: labelTransform('stale') }]),
      ...(exempt ? [{ name: labelTransform('keep-open') }] : []),
    ],
    state: merged ? 'closed' : 'open',
    merged,
    draft,
    head: {
      ref: branch,
      sha: 'original-sha',
      repo: { full_name: fork ? 'contributor/chat' : 'sword/chat' },
    },
  }
  const branchData = {
    protected: protectedBranch,
    commit: { sha: 'original-sha' },
  }
  const rest = {
    repos: {
      get: record('repository', {
        full_name: 'sword/chat',
        default_branch: 'master',
      }),
      getBranch: record('branch', branchData),
    },
    pulls: { list: () => {}, get: record('get', pr), update: record('close') },
    issues: {
      getLabel: record('label'),
      createLabel: record('createLabel'),
      addLabels: record('flag'),
      removeLabel: record('unflag'),
      createComment: record('comment'),
      listEvents: () => {},
      listComments: () => {},
    },
    git: { deleteRef: record('delete') },
  }
  const github = {
    rest,
    paginate: async (method, args) => {
      assert.equal(args.per_page, 100)
      if (method === rest.pulls.list) {
        if (args.base) return base ? [{ number: 3 }] : []
        if (args.head) return shared ? [pr] : []
        return [pr]
      }
      if (method === rest.issues.listComments)
        return [
          ...(warned === null
            ? []
            : [
                {
                  body: '<!-- repository-cleanup:stale-warning -->',
                  user: {
                    login: warningAuthor,
                    type: warningAuthor.endsWith('[bot]') ? 'Bot' : 'User',
                  },
                  author_association: warningAssociation,
                  created_at: ago(warned),
                },
              ]),
          ...extraComments,
        ]
      assert.equal(method, rest.issues.listEvents)
      return [
        ...(flagged === null
          ? []
          : [
              {
                event: 'labeled',
                label: { name: labelTransform('stale') },
                created_at: ago(flagged + 10),
              },
              {
                event: 'labeled',
                label: { name: labelTransform('stale') },
                created_at: ago(flagged),
              },
            ]),
        ...(reopened === null
          ? []
          : [{ event: 'reopened', created_at: ago(reopened) }]),
        ...extraEvents,
      ]
    },
  }
  return {
    calls,
    github,
    pr,
    branchData,
    run: (now = NOW) =>
      closeStalePullRequests({
        github,
        context: { repo: { owner: 'sword', repo: 'chat' } },
        core: {
          info: record('info'),
          warning: record('warning'),
          setFailed: record('failed'),
        },
        now,
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
const did = (calls, name) => calls.some((call) => call.name === name)

for (const age of [1, 7]) {
  test(`does not flag a PR open for ${age} days`, async () => {
    const { run, calls } = fixture({ age, flagged: null })
    await run()
    assert.deepEqual(
      calls.map((call) => call.name),
      ['repository', 'info'],
    )
    assert.match(
      calls.find((call) => call.name === 'info').args,
      /reason=too-young/,
    )
  })
}

for (const branch of ['master', 'team/mobile', 'release/1']) {
  test(`fork branch ${branch} is warned and closed, never deleted`, async () => {
    const warning = fixture({ fork: true, branch, flagged: null })
    await warning.run()
    assert.ok(did(warning.calls, 'flag') && did(warning.calls, 'comment'))
    const closure = fixture({ fork: true, branch })
    await closure.run()
    assert.ok(did(closure.calls, 'close') && !did(closure.calls, 'delete'))
  })
}

for (const options of [{ draft: true }, { exempt: true }]) {
  test(`fork PR retains label/draft exemption: ${JSON.stringify(options)}`, async () => {
    const { run, calls } = fixture({ fork: true, branch: 'master', ...options })
    await run()
    assert.ok(
      !did(calls, 'flag') && !did(calls, 'close') && !did(calls, 'delete'),
    )
  })
}

test('custom PR age and warning deadlines are respected', async () => {
  const first = fixture({
    age: 15,
    flagged: null,
    options: { prStaleDays: 20 },
  })
  await first.run()
  assert.ok(!did(first.calls, 'flag'))
  const waiting = fixture({ flagged: 7, options: { prWarningDays: 10 } })
  await waiting.run()
  assert.ok(!did(waiting.calls, 'close'))
  const closing = fixture({ flagged: 10, options: { prWarningDays: 10 } })
  await closing.run()
  assert.ok(did(closing.calls, 'close'))
})

test('warning text and labels use the custom configuration', async () => {
  const { run, calls } = fixture({
    age: 100,
    flagged: null,
    options: {
      prStaleDays: 20,
      prWarningDays: 10,
      staleLabel: 'inactive',
      exemptLabel: 'retain',
      exemptDrafts: false,
    },
  })
  await run()
  const comment = calls.find((call) => call.name === 'comment').args.body
  assert.ok(
    comment.includes('20 days') &&
      comment.includes('10 days') &&
      comment.includes('`retain`'),
  )
  assert.ok(!comment.includes('drafts and'))
  assert.deepEqual(calls.find((call) => call.name === 'flag').args.labels, [
    'inactive',
  ])
})

test('draft exemption can be disabled', async () => {
  const { run, calls } = fixture({
    draft: true,
    options: { exemptDrafts: false },
  })
  await run()
  assert.ok(did(calls, 'close'))
})

test('consumer exclusions can be disabled, but the default branch stays safe', async () => {
  const { run, calls } = fixture({
    branch: 'team/mobile',
    options: { excludedBranches: [] },
  })
  await run()
  assert.ok(did(calls, 'close') && did(calls, 'delete'))
})

test('warns before flagging an old PR despite recent updates', async () => {
  const { run, calls } = fixture({ age: 100, flagged: null })
  await run()
  assert.deepEqual(
    calls.map((call) => call.name),
    ['repository', 'get', 'info', 'label', 'comment', 'flag'],
  )
})

test('a failed warning never starts the closure clock', async () => {
  const { run, calls, github } = fixture({ flagged: null })
  github.rest.issues.createComment = async () => {
    throw new Error('Comment failed')
  }
  await run()
  assert.ok(did(calls, 'failed'))
  assert.ok(!did(calls, 'flag') && !did(calls, 'close'))
})

test('waits seven days from the most recent stale label', async () => {
  const { run, calls } = fixture({ flagged: 6 })
  await run()
  assert.ok(!did(calls, 'close'))
})

test('closes and deletes after seven days despite recent updates', async () => {
  const { run, calls } = fixture()
  await run()
  assert.ok(did(calls, 'close'))
  assert.equal(
    calls.find((call) => call.name === 'delete').args.ref,
    'heads/feature',
  )
})

for (const options of [
  { fork: true },
  { shared: true },
  { base: true },
  { protectedBranch: true },
]) {
  test(`closes but safely skips branch deletion: ${JSON.stringify(options)}`, async () => {
    const { run, calls } = fixture(options)
    await run()
    assert.ok(did(calls, 'close'))
    assert.ok(!did(calls, 'delete'))
  })
}

for (const options of [
  { draft: true },
  { exempt: true },
  ...[
    'master',
    'team/mobile',
    'gov-dev',
    'staging',
    'staging-d2c',
    'release/1',
  ].map((branch) => ({ branch })),
]) {
  test(`exempts PR entirely: ${JSON.stringify(options)}`, async () => {
    const { run, calls } = fixture(options)
    await run()
    assert.deepEqual(
      calls.map((call) => call.name),
      ['repository', 'info'],
    )
    assert.match(
      calls.find((call) => call.name === 'info').args,
      /reason=exempt/,
    )
  })
}

test('rechecks newly added exemptions before warning or closing', async () => {
  const { run, calls, pr, github } = fixture()
  // Snapshot eligible, but the fresh read sees keep-open.
  github.rest.pulls.get = async () => ({
    data: { ...pr, labels: [...pr.labels, { name: 'keep-open' }] },
  })
  await run()
  assert.ok(!did(calls, 'close') && !did(calls, 'flag'))
})

for (const reopened of [0, 7]) {
  test(`reopening ${reopened} days ago resets the warning period`, async () => {
    const { run, calls } = fixture({ reopened })
    await run()
    assert.ok(!did(calls, 'close') && !did(calls, 'delete'))
    assert.deepEqual(
      calls
        .filter((call) => ['unflag', 'comment', 'flag'].includes(call.name))
        .map((call) => call.name),
      ['comment', 'flag'],
    )
  })
}

for (const event of ['ready_for_review', 'unlabeled']) {
  for (const days of [0, 7, 9]) {
    test(`exemption lifted by ${event} ${days} days ago respects warning order`, async () => {
      const { run, calls } = fixture({
        extraEvents: [
          {
            event,
            created_at: ago(days),
            ...(event === 'unlabeled' ? { label: { name: 'keep-open' } } : {}),
          },
        ],
      })
      await run()
      assert.equal(did(calls, 'close'), days > 7)
      if (days <= 7) {
        assert.ok(
          did(calls, 'comment') && did(calls, 'flag') && !did(calls, 'delete'),
        )
      }
    })
  }
}

test('removing an unrelated label does not reset the warning period', async () => {
  const { run, calls } = fixture({
    extraEvents: [
      { event: 'unlabeled', label: { name: 'bug' }, created_at: ago(0) },
    ],
  })
  await run()
  assert.ok(did(calls, 'close'))
})

test('the most recent exemption transition resets even after an older reopening', async () => {
  const { run, calls } = fixture({
    reopened: 10,
    extraEvents: [{ event: 'ready_for_review', created_at: ago(0) }],
  })
  await run()
  assert.ok(did(calls, 'flag') && !did(calls, 'close'))
})

test('an older reopening does not override a newer warning', async () => {
  const { run, calls } = fixture({ reopened: 9 })
  await run()
  assert.ok(did(calls, 'close'))
})

test('missing label events trigger a fresh warning rather than silent closure', async () => {
  const { run, calls, github } = fixture()
  const original = github.paginate
  github.paginate = (method, args) =>
    method === github.rest.issues.listEvents ? [] : original(method, args)
  await run()
  assert.ok(!did(calls, 'close'))
  assert.deepEqual(
    calls
      .filter((call) => ['unflag', 'comment', 'flag'].includes(call.name))
      .map((call) => call.name),
    ['unflag', 'comment', 'flag'],
  )
})

test('missing label-event repair converges across real label no-op semantics and same-second removal', async () => {
  const f = fixture({ fork: true })
  const original = f.github.paginate
  const events = []
  const delivered = []
  let clock = NOW
  f.github.paginate = async (method, args) => {
    if (method === f.github.rest.issues.listEvents) return events
    const data = await original(method, args)
    return method === f.github.rest.issues.listComments
      ? [...data, ...delivered]
      : data
  }
  f.github.rest.issues.removeLabel = async (args) => {
    f.calls.push({ name: 'unflag', args })
    f.pr.labels = []
    events.push({
      event: 'unlabeled',
      label: { name: 'stale' },
      created_at: new Date(clock).toISOString(),
    })
    return { data: [] }
  }
  f.github.rest.issues.addLabels = async (args) => {
    f.calls.push({ name: 'flag', args })
    if (!f.pr.labels.some((label) => label.name === 'stale')) {
      f.pr.labels = [{ name: 'stale' }]
      events.push({
        event: 'labeled',
        label: { name: 'stale' },
        created_at: new Date(clock).toISOString(),
      })
    }
    return { data: f.pr.labels }
  }
  f.github.rest.issues.createComment = async (args) => {
    f.calls.push({ name: 'comment', args })
    if (args.body.includes('<!-- repository-cleanup:stale-warning -->'))
      delivered.push({
        body: args.body,
        user: { login: 'github-actions[bot]' },
        created_at: new Date(clock).toISOString(),
      })
    return { data: {} }
  }
  await f.run(clock)
  assert.deepEqual(
    f.calls
      .filter((call) => ['unflag', 'comment', 'flag'].includes(call.name))
      .map((call) => call.name),
    ['unflag', 'comment', 'flag'],
  )
  clock += DAY
  await f.run(clock)
  clock += DAY
  await f.run(clock)
  assert.equal(delivered.length, 2)
  assert.equal(f.calls.filter((call) => call.name === 'unflag').length, 1)
  assert.match(
    f.calls.filter((call) => call.name === 'info').at(-1).args,
    /wait; reason=warning-period/,
  )
  clock = NOW + 8 * DAY - 1
  await f.run(clock)
  assert.ok(!did(f.calls, 'close'))
  clock += 1
  await f.run(clock)
  assert.ok(did(f.calls, 'close') && !did(f.calls, 'failed'))
})

test('missing bot-authored warning requires a fresh warning before closure', async () => {
  const { run, calls } = fixture({ warned: null })
  await run()
  assert.ok(!did(calls, 'close') && did(calls, 'flag'))
})

for (const warningAuthor of ['contributor', 'cleanup-app[bot]']) {
  for (const flagged of [null, 7]) {
    test(`unsupported ${warningAuthor} does not cause repeated warnings (flagged=${flagged})`, async () => {
      const { run, calls } = fixture({ warningAuthor, flagged, warned: 1 })
      await run()
      await run()
      assert.ok(did(calls, 'warning'))
      assert.ok(
        !calls.some((call) =>
          ['comment', 'flag', 'unflag', 'close', 'delete'].includes(call.name),
        ),
      )
    })
  }
}

test('outsider marker comments cannot suppress cleanup or serve as closure evidence', async () => {
  const closing = fixture({
    extraComments: [
      {
        body: '<!-- repository-cleanup:stale-warning -->',
        user: { login: 'outsider', type: 'User' },
        author_association: 'NONE',
        created_at: ago(0),
      },
    ],
  })
  await closing.run()
  assert.ok(did(closing.calls, 'close'))
  const warning = fixture({
    warned: 1,
    warningAuthor: 'outsider',
    warningAssociation: 'NONE',
  })
  await warning.run()
  assert.ok(did(warning.calls, 'flag') && !did(warning.calls, 'close'))
})

test('older privileged foreign marker does not override a newer bot warning', async () => {
  const { run, calls } = fixture({
    extraComments: [
      {
        body: '<!-- repository-cleanup:stale-warning -->',
        user: { login: 'collaborator', type: 'User' },
        author_association: 'COLLABORATOR',
        created_at: ago(10),
      },
    ],
  })
  await run()
  assert.ok(did(calls, 'close'))
})

test('a reset newer than a privileged foreign marker allows one fresh warning', async () => {
  const { run, calls } = fixture({
    warningAuthor: 'cleanup-app[bot]',
    warned: 2,
    reopened: 1,
  })
  await run()
  assert.ok(did(calls, 'flag') && did(calls, 'comment') && !did(calls, 'close'))
})

test('mixed-case stale PR labels and timeline events do not restart the warning', async () => {
  const { run, calls } = fixture({
    labelTransform: (name) => name.toUpperCase(),
  })
  await run()
  assert.ok(did(calls, 'close') && did(calls, 'delete') && !did(calls, 'flag'))
})

test('mixed-case exemption labels preserve the PR', async () => {
  const { run, calls } = fixture({
    exempt: true,
    labelTransform: (name) => name.toUpperCase(),
  })
  await run()
  assert.ok(
    !did(calls, 'flag') && !did(calls, 'close') && !did(calls, 'delete'),
  )
})

test('mixed-case exemption removal events restart the warning', async () => {
  const { run, calls } = fixture({
    extraEvents: [
      { event: 'unlabeled', label: { name: 'Keep-Open' }, created_at: ago(0) },
    ],
  })
  await run()
  assert.ok(did(calls, 'flag') && !did(calls, 'close'))
})

test('a later warning gets its full seven days even if the label is old', async () => {
  const { run, calls } = fixture({ warned: 2 })
  await run()
  assert.ok(!did(calls, 'close'))
})

test('creates the repository label only when missing', async () => {
  const { run, calls, github } = fixture({ flagged: null })
  github.rest.issues.getLabel = async () => {
    throw Object.assign(new Error('Missing'), { status: 404 })
  }
  await run()
  assert.ok(did(calls, 'createLabel') && did(calls, 'flag'))
})

test('still deletes the branch if the closure comment fails', async () => {
  const { run, calls, github } = fixture()
  github.rest.issues.createComment = async () => {
    throw new Error('Comment failed')
  }
  await run()
  assert.ok(did(calls, 'delete') && did(calls, 'warning'))
})

test('reports branch deletion failures without undoing closure', async () => {
  const { run, calls, github } = fixture()
  github.rest.git.deleteRef = async () => {
    throw new Error('Protected branch')
  }
  await run()
  assert.ok(did(calls, 'close') && did(calls, 'failed'))
})

test('an already missing branch is not a failure', async () => {
  const { run, calls, github } = fixture()
  github.rest.repos.getBranch = async () => {
    throw Object.assign(new Error('Missing'), { status: 404 })
  }
  await run()
  assert.ok(
    did(calls, 'close') && did(calls, 'warning') && !did(calls, 'failed'),
  )
})

test('does not close or delete a PR merged during the run', async () => {
  const { run, calls } = fixture({ merged: true })
  await run()
  assert.ok(!did(calls, 'close') && !did(calls, 'delete'))
})

for (const change of ['commit', 'protection']) {
  test(`keeps a branch whose ${change} changes before deletion`, async () => {
    const { run, calls, github, branchData } = fixture()
    let reads = 0
    github.rest.repos.getBranch = async () => ({
      data:
        ++reads === 1
          ? branchData
          : {
              protected: change === 'protection',
              commit: { sha: change === 'commit' ? 'new-sha' : 'original-sha' },
            },
    })
    await run()
    assert.ok(did(calls, 'close') && !did(calls, 'delete'))
  })
}

test('same-second lifecycle reset converges without self-generated label-removal loops', async () => {
  const f = fixture({
    fork: true,
    extraEvents: [{ event: 'reopened', created_at: ago(0) }],
  })
  const original = f.github.paginate
  const delivered = []
  let clock = NOW
  f.github.paginate = async (method, args) => {
    const data = await original(method, args)
    return method === f.github.rest.issues.listComments
      ? [...data, ...delivered]
      : data
  }
  f.github.rest.issues.createComment = async (args) => {
    f.calls.push({ name: 'comment', args })
    if (args.body.includes('<!-- repository-cleanup:stale-warning -->'))
      delivered.push({
        body: args.body,
        user: { login: 'github-actions[bot]' },
        created_at: new Date(clock).toISOString(),
      })
    return { data: {} }
  }
  const run = () =>
    closeStalePullRequests({
      github: f.github,
      context: { repo: { owner: 'sword', repo: 'chat' } },
      core: {
        info: (args) => f.calls.push({ name: 'info', args }),
        warning: (args) => f.calls.push({ name: 'warning', args }),
        setFailed: (args) => f.calls.push({ name: 'failed', args }),
      },
      now: clock,
    })
  await run()
  clock += DAY
  await run()
  clock += DAY
  await run()
  assert.equal(
    delivered.length,
    2,
    'One conservative retry resolves the timestamp tie',
  )
  assert.ok(!did(f.calls, 'unflag') && !did(f.calls, 'close'))
  clock = NOW + 8 * DAY
  await run()
  assert.ok(did(f.calls, 'close') && !did(f.calls, 'failed'))
})

test('a label retried a day later starts a full warning period', async () => {
  const f = fixture({ flagged: null, warned: null, fork: true })
  const original = f.github.paginate
  const comments = []
  const events = []
  let clock = NOW
  let attempts = 0
  f.github.paginate = async (method, args) => {
    if (method === f.github.rest.issues.listComments) return comments
    if (method === f.github.rest.issues.listEvents) return events
    return original(method, args)
  }
  f.github.rest.issues.createComment = async (args) => {
    f.calls.push({ name: 'comment', args })
    comments.push({
      body: args.body,
      user: { login: 'github-actions[bot]' },
      created_at: new Date(clock).toISOString(),
    })
    return { data: {} }
  }
  f.github.rest.issues.addLabels = async () => {
    if (++attempts === 1) throw new Error('Label failed')
    f.pr.labels = [{ name: 'stale' }]
    events.push({
      event: 'labeled',
      label: { name: 'stale' },
      created_at: new Date(clock).toISOString(),
    })
    return { data: {} }
  }
  const run = () =>
    closeStalePullRequests({
      github: f.github,
      context: { repo: { owner: 'sword', repo: 'chat' } },
      core: {
        info: (args) => f.calls.push({ name: 'info', args }),
        warning: (args) => f.calls.push({ name: 'warning', args }),
        setFailed: (args) => f.calls.push({ name: 'failed', args }),
      },
      now: clock,
    })
  await run()
  clock += DAY
  await run()
  assert.equal(comments.length, 1)
  clock = NOW + 7 * DAY
  await run()
  assert.ok(
    !did(f.calls, 'close'),
    'The original warning is seven days old but labeling is only six days old',
  )
  clock += DAY
  await run()
  assert.ok(did(f.calls, 'close'))
})

test('waiting decisions log the evidence and computed deadline', async () => {
  const f = fixture({ flagged: 6, reopened: 9 })
  await f.run()
  const log = f.calls.find((call) => call.name === 'info').args
  assert.match(log, /wait; reason=warning-period/)
  assert.ok(
    log.includes(`warning=${ago(6)}`) && log.includes(`label=${ago(6)}`),
  )
  assert.ok(log.includes(`reset=reopened@${ago(9)}`))
  assert.ok(log.includes(`deadline=${new Date(NOW + DAY).toISOString()}`))
})

for (const dryRun of [false, true]) {
  for (const endpoint of ['events', 'comments']) {
    test(`final ${endpoint} evidence failure prevents mutations (preview=${dryRun})`, async () => {
      const f = fixture({ dryRun })
      const original = f.github.paginate
      let reads = 0
      f.github.paginate = async (method, args) => {
        const expected =
          endpoint === 'events'
            ? f.github.rest.issues.listEvents
            : f.github.rest.issues.listComments
        if (method === expected && ++reads === 2)
          throw new Error('Final evidence failed')
        return original(method, args)
      }
      await f.run()
      assert.ok(did(f.calls, 'failed'))
      assert.ok(
        !f.calls.some((call) =>
          [
            'comment',
            'flag',
            'unflag',
            'close',
            'delete',
            'createLabel',
          ].includes(call.name),
        ),
      )
    })
  }
}

test('failed PR closure never proceeds to branch deletion', async () => {
  const f = fixture()
  f.github.rest.pulls.update = async () => {
    throw new Error('Closure failed')
  }
  await f.run()
  assert.ok(
    did(f.calls, 'failed') &&
      !did(f.calls, 'delete') &&
      !did(f.calls, 'comment'),
  )
})

test('successful warning and failed label retry does not repeat the comment', async () => {
  const { run, calls, github, pr } = fixture({ flagged: null, warned: null })
  const original = github.paginate
  const comments = []
  github.paginate = async (method, args) =>
    method === github.rest.issues.listComments
      ? comments
      : original(method, args)
  github.rest.issues.createComment = async (args) => {
    calls.push({ name: 'comment', args })
    comments.push({
      body: args.body,
      user: { login: 'github-actions[bot]' },
      created_at: ago(0),
    })
    return { data: {} }
  }
  let attempts = 0
  github.rest.issues.addLabels = async (args) => {
    calls.push({ name: 'flag', args })
    if (++attempts === 1) throw new Error('Label failed')
    pr.labels = [{ name: 'stale' }]
    return { data: {} }
  }
  await run()
  await run()
  assert.equal(calls.filter((call) => call.name === 'comment').length, 1)
  assert.equal(calls.filter((call) => call.name === 'flag').length, 2)
  assert.ok(did(calls, 'failed') && !did(calls, 'close'))
})

test('a PR created one second after run start gets an info-level defer diagnostic', async () => {
  const f = fixture()
  f.pr.created_at = new Date(NOW + 1000).toISOString()
  await f.run()
  assert.match(
    f.calls.find((call) => call.name === 'info').args,
    /reason=creation-after-run-start/,
  )
  assert.ok(
    !did(f.calls, 'warning') &&
      !did(f.calls, 'failed') &&
      !did(f.calls, 'close'),
  )
})

test('a reset observed one second after run start defers closure without an invalid-evidence warning', async () => {
  const f = fixture()
  const original = f.github.paginate
  let reads = 0
  f.github.paginate = async (method, args) => {
    const data = await original(method, args)
    if (method === f.github.rest.issues.listEvents && ++reads === 2)
      data.push({
        event: 'unlabeled',
        label: { name: 'stale' },
        created_at: new Date(NOW + 1000).toISOString(),
      })
    return data
  }
  await f.run()
  assert.match(
    f.calls.filter((call) => call.name === 'info').at(-1).args,
    /reason=evidence-after-run-start/,
  )
  assert.ok(
    !did(f.calls, 'warning') &&
      !did(f.calls, 'failed') &&
      !did(f.calls, 'close') &&
      !did(f.calls, 'delete'),
  )
})

for (const [warningAge, freshComment] of [
  [1, false],
  [7, true],
]) {
  test(`stale-label rename with warning age ${warningAge} honors the bounded quiet-retry policy`, async () => {
    const f = fixture({
      warned: warningAge,
      options: { staleLabel: 'inactive' },
    })
    const original = f.github.paginate
    f.github.paginate = async (method, args) => {
      const data = await original(method, args)
      if (method === f.github.rest.issues.listComments)
        data[0].body += '\nRemove `stale` to restart the warning.'
      return data
    }
    await f.run()
    assert.equal(did(f.calls, 'comment'), freshComment)
    if (freshComment)
      assert.ok(
        f.calls
          .find((call) => call.name === 'comment')
          .args.body.includes('`inactive`'),
      )
    assert.deepEqual(f.calls.find((call) => call.name === 'flag').args.labels, [
      'inactive',
    ])
    assert.ok(!did(f.calls, 'close') && !did(f.calls, 'unflag'))
  })
}

test('an absent label previously applied at the warning time gets a new warning, not a quiet retry', async () => {
  const f = fixture()
  f.pr.labels = []
  await f.run()
  assert.ok(
    did(f.calls, 'comment') && did(f.calls, 'flag') && !did(f.calls, 'close'),
  )
})

for (const change of [
  'reopened',
  'relabel',
  'warning-deleted',
  'new-warning',
]) {
  test(`final evidence refresh prevents closure after ${change}`, async () => {
    const { run, calls, github } = fixture()
    const original = github.paginate
    let eventReads = 0
    let commentReads = 0
    github.paginate = async (method, args) => {
      const data = await original(method, args)
      if (method === github.rest.issues.listEvents && ++eventReads > 1) {
        if (change === 'reopened')
          data.push({ event: 'reopened', created_at: ago(0) })
        if (change === 'relabel')
          data.push({
            event: 'labeled',
            label: { name: 'stale' },
            created_at: ago(0),
          })
      }
      if (method === github.rest.issues.listComments && ++commentReads > 1) {
        if (change === 'warning-deleted') return []
        if (change === 'new-warning')
          data.push({
            body: '<!-- repository-cleanup:stale-warning -->',
            user: { login: 'github-actions[bot]' },
            created_at: ago(0),
          })
      }
      return data
    }
    await run()
    assert.ok(!did(calls, 'close') && !did(calls, 'delete'))
  })
}

test('last PR read after evidence collection still checks exemptions', async () => {
  const { run, calls, github, pr } = fixture()
  let reads = 0
  github.rest.pulls.get = async () => ({
    data:
      ++reads >= 3
        ? { ...pr, labels: [...pr.labels, { name: 'keep-open' }] }
        : pr,
  })
  await run()
  assert.ok(!did(calls, 'close') && !did(calls, 'delete'))
})

test('a per-item failure does not prevent processing a second PR', async () => {
  const { run, calls, github, pr } = fixture({ flagged: null, warned: null })
  const original = github.paginate
  github.paginate = async (method, args) =>
    method === github.rest.pulls.list && !args.head && !args.base
      ? [pr, { ...pr, number: 2 }]
      : original(method, args)
  github.rest.pulls.get = async (args) => ({
    data: { ...pr, number: args.pull_number },
  })
  github.rest.issues.createComment = async (args) => {
    if (args.issue_number === 1) throw new Error('First warning failed')
    calls.push({ name: 'comment', args })
    return { data: {} }
  }
  await run()
  assert.ok(did(calls, 'failed'))
  assert.equal(calls.find((call) => call.name === 'flag').args.issue_number, 2)
})

for (const flagged of [null, 7]) {
  test(`dry run never mutates any resource (flagged=${flagged})`, async () => {
    const { run, calls } = fixture({ dryRun: true, flagged })
    await run()
    assert.ok(did(calls, 'info'))
    assert.ok(
      !calls.some((call) =>
        [
          'flag',
          'unflag',
          'comment',
          'close',
          'delete',
          'createLabel',
        ].includes(call.name),
      ),
    )
  })
}
