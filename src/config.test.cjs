const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DEFAULT_OPTIONS, resolveOptions, readInputs } = require('./config.cjs')
const { isExcludedBranch } = require('./cleanup-policy.cjs')

const inputKeys = {
  'pr-stale-days': 'prStaleDays',
  'pr-warning-days': 'prWarningDays',
  'branch-inactive-days': 'branchInactiveDays',
  'branch-grace-days': 'branchGraceDays',
  'stale-label': 'staleLabel',
  'exempt-label': 'exemptLabel',
}

function coreInputs(overrides = {}) {
  const values = Object.fromEntries(
    Object.entries(inputKeys).map(([name, key]) => [
      name,
      String(DEFAULT_OPTIONS[key]),
    ]),
  )
  Object.assign(
    values,
    { 'dry-run': 'true', 'exempt-drafts': 'true', 'excluded-branches': '' },
    overrides,
  )
  return {
    getInput: (name) => values[name] ?? '',
    getBooleanInput: (name) => {
      if (!['true', 'false'].includes(values[name]))
        throw new Error(`Invalid boolean ${name}`)
      return values[name] === 'true'
    },
    getMultilineInput: (name) =>
      values[name]
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean),
  }
}

module.exports = { coreInputs }

test('default thresholds and labels match original policy without organization-specific exclusions', () => {
  assert.deepEqual(resolveOptions(), DEFAULT_OPTIONS)
  assert.equal(readInputs(coreInputs()).dryRun, true)
  assert.equal(isExcludedBranch('team/mobile', 'main'), false)
  assert.equal(isExcludedBranch('gov-dev', 'main'), false)
  assert.equal(isExcludedBranch('main', 'main'), true)
})

for (const name of [
  'prStaleDays',
  'prWarningDays',
  'branchInactiveDays',
  'branchGraceDays',
]) {
  for (const value of [
    0,
    -1,
    1.5,
    '0',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '1e2',
    '0x10',
    true,
    null,
    Number.MAX_SAFE_INTEGER,
  ]) {
    test(`rejects invalid ${name}=${JSON.stringify(value)}`, () => {
      assert.throws(() => resolveOptions({ [name]: value }), /positive integer/)
    })
  }
}

test('parses custom day values and consumer exclusions', () => {
  const { options, dryRun } = readInputs(
    coreInputs({
      'pr-stale-days': '14',
      'pr-warning-days': '3',
      'branch-inactive-days': '60',
      'branch-grace-days': '10',
      'excluded-branches': 'team/*\n\ngov-dev\n',
      'dry-run': 'false',
    }),
  )
  assert.equal(options.prStaleDays, 14)
  assert.equal(options.prWarningDays, 3)
  assert.equal(options.branchInactiveDays, 60)
  assert.equal(options.branchGraceDays, 10)
  assert.deepEqual(options.excludedBranches, ['team/*', 'gov-dev'])
  assert.equal(dryRun, false)
})

for (const name of ['dry-run', 'exempt-drafts']) {
  test(`invalid boolean ${name} fails input validation`, () => {
    assert.throws(
      () => readInputs(coreInputs({ [name]: 'maybe' })),
      /Invalid boolean/,
    )
  })
}

for (const value of ['', ' ', 'a'.repeat(51), 'line\nbreak', '`label`']) {
  test(`rejects malformed labels ${JSON.stringify(value)}`, () => {
    assert.throws(() => resolveOptions({ staleLabel: value }), /staleLabel/)
  })
}

test('stale and exempt labels cannot collide even case-insensitively', () => {
  assert.throws(
    () => resolveOptions({ staleLabel: 'KEEP-OPEN' }),
    /must be different/,
  )
})

for (const value of ['team/*', [null], [''], ['a\nb']]) {
  test(`rejects invalid exclusion arrays ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => resolveOptions({ excludedBranches: value }),
      /excludedBranches/,
    )
  })
}

test('exclusion patterns support stars and treat regex characters literally', () => {
  const options = resolveOptions({
    excludedBranches: [
      'team/*',
      'release/*',
      'prod.v1',
      '[environment]',
      'a+b',
    ],
  })
  for (const branch of [
    'team/mobile',
    'team/x/y',
    'release/v1',
    'prod.v1',
    '[environment]',
    'a+b',
    'main',
  ]) {
    assert.equal(isExcludedBranch(branch, 'main', options), true, branch)
  }
  for (const branch of [
    'my-team/mobile',
    'prodXv1',
    'environment',
    'ab',
    'team',
  ]) {
    assert.equal(isExcludedBranch(branch, 'main', options), false, branch)
  }
})
