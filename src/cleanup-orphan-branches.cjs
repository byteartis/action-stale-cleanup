const {
  DAY_MS,
  hasLabel,
  isExcludedBranch,
  isLocalPull,
  deleteBranch,
} = require('./cleanup-policy.cjs')
const { resolveOptions } = require('./config.cjs')

module.exports = async function cleanupOrphanBranches({
  github,
  context,
  core,
  now = Date.now(),
  dryRun = false,
  options = {},
}) {
  options = resolveOptions(options)
  const repo = context.repo
  const { data: repository } = await github.rest.repos.get(repo)
  const branches = await github.paginate(github.rest.repos.listBranches, {
    ...repo,
    per_page: 100,
  })

  for (const branch of branches) {
    if (
      isExcludedBranch(branch.name, repository.default_branch, options) ||
      branch.protected
    )
      continue

    try {
      const { data: current } = await github.rest.repos.getBranch({
        ...repo,
        branch: branch.name,
      })
      if (current.protected || current.commit.sha !== branch.commit.sha)
        continue

      const history = await github.paginate(github.rest.pulls.list, {
        ...repo,
        state: 'all',
        head: `${repo.owner}:${branch.name}`,
        per_page: 100,
      })
      const pulls = history.filter((pr) =>
        isLocalPull(pr, branch.name, repository.full_name),
      )
      if (
        pulls.some(
          (pr) => pr.state === 'open' || hasLabel(pr, options.exemptLabel),
        )
      )
        continue

      // Give manually closed/merged PRs the configured grace period for reopening. Only use the
      // fast path when the branch still points at a closed PR's exact head.
      const closedAt = Math.max(...pulls.map((pr) => Date.parse(pr.closed_at)))
      if (
        pulls.length &&
        (!Number.isFinite(closedAt) ||
          now - closedAt < options.branchGraceDays * DAY_MS)
      )
        continue
      const unchangedClosedHead = pulls.some(
        (pr) => pr.head.sha === current.commit.sha,
      )

      // Push/creation time prevents deleting a recently recreated branch that
      // points at an old commit. GitHub can have no retained activity for old refs.
      const { data: activity } = await github.rest.repos.listActivities({
        ...repo,
        ref: `refs/heads/${branch.name}`,
        direction: 'desc',
        per_page: 1,
      })
      const lastActivity = activity.length
        ? Date.parse(activity[0].timestamp)
        : null
      if (activity.length && !Number.isFinite(lastActivity)) {
        core.warning(`Branch ${branch.name}: invalid activity timestamp`)
        continue
      }
      if (
        lastActivity !== null &&
        now - lastActivity < options.branchGraceDays * DAY_MS
      )
        continue

      if (!unchangedClosedHead) {
        const committedAt = Date.parse(current.commit.commit.committer?.date)
        if (!Number.isFinite(committedAt)) {
          core.warning(
            `Branch ${branch.name}: missing or invalid committer date`,
          )
          continue
        }
        const lastChange = Math.max(committedAt, lastActivity ?? committedAt)
        if (now - lastChange <= options.branchInactiveDays * DAY_MS) continue
      }

      await deleteBranch({
        github,
        context,
        core,
        repository,
        name: branch.name,
        expectedSha: current.commit.sha,
        dryRun,
        options,
      })
    } catch (error) {
      if (error.status === 404) {
        core.warning(
          `Branch ${branch.name}: resource disappeared during cleanup`,
        )
        continue
      }
      core.setFailed(`Branch ${branch.name}: ${error.message}`)
    }
  }
}
