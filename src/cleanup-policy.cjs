const { DAY_MS, DEFAULT_OPTIONS } = require('./config.cjs')

// Patterns are anchored, case-sensitive, and support only '*' as a wildcard.
// Escape everything else so consumer input cannot become executable regex syntax.
function isExcludedBranch(name, defaultBranch, options = DEFAULT_OPTIONS) {
  return (
    name === defaultBranch ||
    options.excludedBranches.some((pattern) => {
      const expression = pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')
      return new RegExp(`^${expression}$`).test(name)
    })
  )
}

function labelsEqual(actual, expected) {
  return (
    typeof actual === 'string' &&
    typeof expected === 'string' &&
    actual.toLowerCase() === expected.toLowerCase()
  )
}

function hasLabel(pr, name) {
  return pr.labels?.some((label) => labelsEqual(label.name, name)) ?? false
}

function isExemptPull(pr, repository, options = DEFAULT_OPTIONS) {
  return (
    (options.exemptDrafts && pr.draft) ||
    hasLabel(pr, options.exemptLabel) ||
    (isLocalPull(pr, pr.head.ref, repository.full_name) &&
      isExcludedBranch(pr.head.ref, repository.default_branch, options))
  )
}

function isLocalPull(pr, name, fullName) {
  return pr.head.repo?.full_name === fullName && pr.head.ref === name
}

// GitHub has no compare-and-delete API. Recheck SHA/protection and both ends of
// open PRs immediately before deleting, minimizing (not eliminating) the race.
async function deleteBranch({
  github,
  context,
  core,
  repository,
  name,
  expectedSha,
  dryRun,
  options = DEFAULT_OPTIONS,
}) {
  if (isExcludedBranch(name, repository.default_branch, options)) return
  const repo = context.repo
  const { data: branch } = await github.rest.repos.getBranch({
    ...repo,
    branch: name,
  })
  if (branch.protected || branch.commit.sha !== expectedSha) return

  const heads = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'open',
    head: `${repo.owner}:${name}`,
    per_page: 100,
  })
  const bases = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'open',
    base: name,
    per_page: 100,
  })
  if (
    heads.some((pr) => isLocalPull(pr, name, repository.full_name)) ||
    bases.length
  ) {
    core.warning(`Branch ${name}: still used as the head or base of an open PR`)
    return
  }
  const { data: latest } = await github.rest.repos.getBranch({
    ...repo,
    branch: name,
  })
  if (latest.protected || latest.commit.sha !== expectedSha) return

  if (dryRun) {
    core.info(`[dry-run] Would delete branch ${name} at ${expectedSha}`)
    return
  }
  await github.rest.git.deleteRef({ ...repo, ref: `heads/${name}` })
  core.info(`Deleted branch ${name} at ${expectedSha}`)
}

module.exports = {
  DAY_MS,
  isExcludedBranch,
  hasLabel,
  labelsEqual,
  isExemptPull,
  isLocalPull,
  deleteBranch,
}
