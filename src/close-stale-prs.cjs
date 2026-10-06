const { deleteBranch } = require('./cleanup-policy.cjs')
const { resolveOptions } = require('./config.cjs')
const {
  WARNING_MARKER,
  pullEligibility,
  decidePullRequest,
} = require('./pr-policy.cjs')

module.exports = async function closeStalePullRequests({
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
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'open',
    per_page: 100,
  })
  const policyArgs = { repository, now, options }
  let labelReady = false

  async function ensureStaleLabel() {
    if (labelReady) return
    try {
      await github.rest.issues.getLabel({ ...repo, name: options.staleLabel })
    } catch (error) {
      if (error.status !== 404) throw error
      await github.rest.issues.createLabel({
        ...repo,
        name: options.staleLabel,
        color: 'ededed',
        description: 'Scheduled for automatic closure by stale cleanup',
      })
    }
    labelReady = true
  }

  async function readEvidence(issue) {
    const events = await github.paginate(github.rest.issues.listEvents, {
      ...issue,
      per_page: 100,
    })
    const comments = await github.paginate(github.rest.issues.listComments, {
      ...issue,
      per_page: 100,
    })
    return { events, comments }
  }

  function logDecision(number, decision, phase = 'inspect') {
    const time = (value) => {
      if (!value) return 'none'
      const date = new Date(value)
      return Number.isFinite(date.getTime())
        ? date.toISOString()
        : String(value)
    }
    core.info(
      `PR #${number} (${phase}): ${decision.action}; reason=${decision.reason}; warning=${time(decision.warnedAt)}; label=${time(decision.labeledAt)}; reset=${decision.resetReason || 'none'}@${time(decision.resetAt)}; deadline=${time(decision.deadline)}`,
    )
    if (decision.reason === 'unsupported-warning-author') {
      core.warning(
        `PR #${number}: skipping an unsupported warning author; use the repository GITHUB_TOKEN and remove the non-github-actions marked warning before retrying`,
      )
    } else if (decision.reason.startsWith('invalid-')) {
      core.warning(
        `PR #${number}: ${decision.reason}; skipping ambiguous evidence without mutations`,
      )
    }
  }

  async function warn(issue, decision) {
    if (dryRun) {
      core.info(
        `[dry-run] Would ${decision.reuseWarning ? 'retry flagging using the delivered warning for' : 'warn and flag'} PR #${issue.issue_number}`,
      )
      return
    }
    await ensureStaleLabel()
    if (decision.resetLabel) {
      try {
        await github.rest.issues.removeLabel({
          ...issue,
          name: options.staleLabel,
        })
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
    if (!decision.reuseWarning) {
      // Labeling depends on successful delivery, unlike upstream's independent
      // comment/label attempts. Never start a clock after a failed warning.
      await github.rest.issues.createComment({
        ...issue,
        body: `${WARNING_MARKER}\n\nThis pull request has been open for more than ${options.prStaleDays} days. It will be automatically closed ${options.prWarningDays} days after both this warning and the stale label are present, and its source branch may be deleted where safe and permitted. Comments and commits do not extend this deadline. Add the \`${options.exemptLabel}\` label to opt out; ${options.exemptDrafts ? 'drafts and ' : ''}configured excluded same-repository branches are exempt. Reopening, marking ready for review, or removing \`${options.exemptLabel}\` or \`${options.staleLabel}\` starts a fresh warning period. Current workflow thresholds determine the deadline.`,
      })
    }
    await github.rest.issues.addLabels({
      ...issue,
      labels: [options.staleLabel],
    })
  }

  for (const pr of pulls) {
    const initialReason = pullEligibility({ ...policyArgs, pr })
    if (initialReason) {
      logDecision(pr.number, { action: 'skip', reason: initialReason })
      continue
    }
    const issue = { ...repo, issue_number: pr.number }
    try {
      const { data: current } = await github.rest.pulls.get({
        ...repo,
        pull_number: pr.number,
      })
      const currentReason = pullEligibility({ ...policyArgs, pr: current })
      if (currentReason) {
        logDecision(pr.number, { action: 'skip', reason: currentReason })
        continue
      }
      const evidence = await readEvidence(issue)
      const decision = decidePullRequest({
        ...policyArgs,
        ...evidence,
        pr: current,
      })
      logDecision(pr.number, decision)
      if (decision.action === 'warn') {
        await warn(issue, decision)
        continue
      }
      if (decision.action !== 'close') continue

      // Refresh the evidence as well as PR state before acting on a deadline.
      // A change after these reads still cannot be ruled out atomically.
      const { data: refreshed } = await github.rest.pulls.get({
        ...repo,
        pull_number: pr.number,
      })
      const refreshedReason = pullEligibility({ ...policyArgs, pr: refreshed })
      if (refreshedReason) {
        logDecision(
          pr.number,
          { action: 'skip', reason: refreshedReason },
          'recheck',
        )
        continue
      }
      const freshEvidence = await readEvidence(issue)
      const { data: latest } = await github.rest.pulls.get({
        ...repo,
        pull_number: pr.number,
      })
      const finalDecision = decidePullRequest({
        ...policyArgs,
        ...freshEvidence,
        pr: latest,
      })
      logDecision(pr.number, finalDecision, 'recheck')
      // If a reset requires another warning, leave it to the next run instead
      // of executing a different mutation using an out-of-date initial plan.
      if (finalDecision.action !== 'close') continue
      if (dryRun) {
        core.info(
          `[dry-run] Would close PR #${pr.number}; branch deletion would require a fresh safety check after closure`,
        )
        continue
      }
      await github.rest.pulls.update({
        ...repo,
        pull_number: pr.number,
        state: 'closed',
      })
      try {
        await github.rest.issues.createComment({
          ...issue,
          body: `Automatically closed after the ${options.prWarningDays}-day warning period. The source branch will be deleted only if it is unchanged, unprotected, and not used by another open PR.`,
        })
      } catch (error) {
        core.warning(
          `PR #${pr.number}: could not post closure comment: ${error.message}`,
        )
      }

      if (
        !latest.head.repo ||
        latest.head.repo.full_name !== repository.full_name
      ) {
        core.warning(
          `PR #${pr.number}: cannot delete a branch in a fork or missing repository`,
        )
        continue
      }
      await deleteBranch({
        github,
        context,
        core,
        repository,
        name: latest.head.ref,
        expectedSha: latest.head.sha,
        dryRun,
        options,
      })
    } catch (error) {
      if (error.status === 404) {
        core.warning(`PR #${pr.number}: resource disappeared during cleanup`)
        continue
      }
      core.setFailed(`PR #${pr.number}: ${error.message}`)
    }
  }
}
