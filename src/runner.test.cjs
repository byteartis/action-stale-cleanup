const assert = require('node:assert/strict')
const { test } = require('node:test')
const { run } = require('./runner.cjs')

function fixture(inputs = {}) {
  const calls = []
  const values = {
    'github-token': 'test-token',
    'dry-run': 'true',
    'exempt-drafts': 'true',
    ...inputs,
  }
  const core = {
    getInput: (name, options) => {
      const value = values[name] ?? ''
      if (options?.required && !value) throw new Error(`Missing ${name}`)
      return value
    },
    getBooleanInput: (name) => {
      if (!['true', 'false'].includes(values[name]))
        throw new Error(`Invalid boolean ${name}`)
      return values[name] === 'true'
    },
    getMultilineInput: () => [],
    info: (message) => calls.push({ name: 'info', message }),
    setFailed: (message) => calls.push({ name: 'failed', message }),
  }
  const github = { client: true }
  const context = { repo: { owner: 'consumer', repo: 'target' } }
  const githubSdk = {
    context,
    getOctokit: (token) => {
      calls.push({ name: 'client', token })
      return github
    },
  }
  const closePulls = async (args) => calls.push({ name: 'pulls', args })
  const cleanupBranches = async (args) => calls.push({ name: 'branches', args })
  return {
    calls,
    github,
    context,
    deps: { core, githubSdk, closePulls, cleanupBranches },
  }
}

test('runs both phases with the consuming repository, token and resolved defaults', async () => {
  const { deps, calls, github, context } = fixture()
  await run(deps)
  assert.equal(calls.find((call) => call.name === 'client').token, 'test-token')
  for (const phase of ['pulls', 'branches']) {
    const args = calls.find((call) => call.name === phase).args
    assert.equal(args.github, github)
    assert.equal(args.context, context)
    assert.equal(args.options.prWarningDays, 7)
    assert.equal(args.dryRun, true)
  }
  assert.ok(!calls.some((call) => call.name === 'failed'))
})

for (const inputs of [
  { 'pr-stale-days': '0' },
  { 'dry-run': 'maybe' },
  { 'github-token': '' },
]) {
  test(`invalid inputs fail before client creation or either cleanup phase: ${JSON.stringify(inputs)}`, async () => {
    const { deps, calls } = fixture(inputs)
    await run(deps)
    assert.ok(calls.some((call) => call.name === 'failed'))
    assert.ok(
      !calls.some((call) =>
        ['client', 'pulls', 'branches'].includes(call.name),
      ),
    )
  })
}

test('branch phase still runs and action stays failed when PR phase throws', async () => {
  const { deps, calls } = fixture()
  deps.closePulls = async () => {
    throw new Error('Unavailable')
  }
  await run(deps)
  assert.ok(
    calls.some(
      (call) =>
        call.name === 'failed' && call.message === 'PR cleanup: Unavailable',
    ),
  )
  assert.ok(calls.some((call) => call.name === 'branches'))
})

test('branch phase errors are reported', async () => {
  const { deps, calls } = fixture()
  deps.cleanupBranches = async () => {
    throw new Error('Permission denied')
  }
  await run(deps)
  assert.ok(
    calls.some(
      (call) =>
        call.name === 'failed' &&
        call.message === 'Branch cleanup: Permission denied',
    ),
  )
})
