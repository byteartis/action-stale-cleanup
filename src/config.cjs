const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_OPTIONS = Object.freeze({
  prStaleDays: 7,
  prWarningDays: 7,
  branchInactiveDays: 30,
  branchGraceDays: 7,
  staleLabel: 'stale',
  exemptLabel: 'keep-open',
  exemptDrafts: true,
  excludedBranches: Object.freeze([]),
})

function resolveOptions(overrides = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides }
  for (const name of [
    'prStaleDays',
    'prWarningDays',
    'branchInactiveDays',
    'branchGraceDays',
  ]) {
    const value = options[name]
    const parsed =
      typeof value === 'string' && /^[0-9]+$/.test(value)
        ? Number(value)
        : value
    if (
      typeof parsed !== 'number' ||
      !Number.isSafeInteger(parsed) ||
      parsed <= 0 ||
      !Number.isSafeInteger(parsed * DAY_MS)
    ) {
      throw new Error(`${name} must be a positive integer number of days`)
    }
    options[name] = parsed
  }
  for (const name of ['staleLabel', 'exemptLabel']) {
    if (
      typeof options[name] !== 'string' ||
      !options[name].trim() ||
      options[name].length > 50 ||
      /[\r\n`]/.test(options[name])
    ) {
      throw new Error(
        `${name} must be a nonempty label of at most 50 characters without newlines or backticks`,
      )
    }
  }
  if (options.staleLabel.toLowerCase() === options.exemptLabel.toLowerCase()) {
    throw new Error('staleLabel and exemptLabel must be different')
  }
  if (typeof options.exemptDrafts !== 'boolean')
    throw new Error('exemptDrafts must be boolean')
  if (
    !Array.isArray(options.excludedBranches) ||
    options.excludedBranches.some(
      (pattern) =>
        typeof pattern !== 'string' ||
        !pattern.trim() ||
        /[\r\n]/.test(pattern),
    )
  ) {
    throw new Error(
      'excludedBranches must be an array of nonempty branch patterns',
    )
  }
  return options
}

function readInputs(core) {
  const input = (name, fallback) => core.getInput(name) || fallback
  const options = resolveOptions({
    prStaleDays: input('pr-stale-days', DEFAULT_OPTIONS.prStaleDays),
    prWarningDays: input('pr-warning-days', DEFAULT_OPTIONS.prWarningDays),
    branchInactiveDays: input(
      'branch-inactive-days',
      DEFAULT_OPTIONS.branchInactiveDays,
    ),
    branchGraceDays: input(
      'branch-grace-days',
      DEFAULT_OPTIONS.branchGraceDays,
    ),
    staleLabel: input('stale-label', DEFAULT_OPTIONS.staleLabel),
    exemptLabel: input('exempt-label', DEFAULT_OPTIONS.exemptLabel),
    exemptDrafts: core.getBooleanInput('exempt-drafts'),
    excludedBranches: core.getMultilineInput('excluded-branches'),
  })
  return { options, dryRun: core.getBooleanInput('dry-run') }
}

module.exports = { DAY_MS, DEFAULT_OPTIONS, resolveOptions, readInputs }
