const { DAY_MS } = require('./config.cjs')
const { hasLabel, labelsEqual, isExemptPull } = require('./cleanup-policy.cjs')
const WARNING_MARKER = '<!-- repository-cleanup:stale-warning -->'

// Pure decisions: no API calls, logging, mutations, or updated_at dependency.
function pullEligibility({ pr, repository, now, options }) {
  if (pr.state !== 'open' || pr.merged) return 'not-open'
  if (isExemptPull(pr, repository, options)) return 'exempt'
  const createdAt = timestamp(pr.created_at)
  if (createdAt === null) return 'invalid-creation-time'
  if (createdAt > now) return 'creation-after-run-start'
  if (now - createdAt <= options.prStaleDays * DAY_MS) return 'too-young'
  return null
}

function timestamp(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function collectWarningEvidence({ events, comments, now, options }) {
  let labeledAt = 0
  let warnedAt = 0
  let foreignWarnedAt = 0
  let resetAt = 0
  let resetReason = null
  let invalid = false
  let changedDuringRun = false
  for (const event of events) {
    const labeled =
      event.event === 'labeled' &&
      labelsEqual(event.label?.name, options.staleLabel)
    const reset =
      ['reopened', 'ready_for_review'].includes(event.event) ||
      (event.event === 'unlabeled' &&
        [options.exemptLabel, options.staleLabel].some((label) =>
          labelsEqual(event.label?.name, label),
        ))
    if (!labeled && !reset) continue
    const at = timestamp(event.created_at)
    if (at === null) {
      invalid = true
      continue
    }
    if (at > now) changedDuringRun = true
    if (labeled) labeledAt = Math.max(labeledAt, at)
    if (reset && at >= resetAt) {
      resetAt = at
      resetReason =
        event.event === 'unlabeled'
          ? `removed-${labelsEqual(event.label?.name, options.staleLabel) ? 'stale' : 'exemption'}-label`
          : event.event
    }
  }
  for (const comment of comments) {
    if (!comment.body?.includes(WARNING_MARKER)) continue
    const trusted = comment.user?.login === 'github-actions[bot]'
    const foreign =
      !trusted &&
      (comment.user?.type === 'Bot' ||
        ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(
          comment.author_association,
        ))
    // Outsider marker spoofing cannot reset a deadline or suppress cleanup.
    if (!trusted && !foreign) continue
    const at = timestamp(comment.created_at)
    if (at === null) {
      invalid = true
      continue
    }
    if (at > now) changedDuringRun = true
    if (trusted) warnedAt = Math.max(warnedAt, at)
    else foreignWarnedAt = Math.max(foreignWarnedAt, at)
  }
  return {
    labeledAt,
    warnedAt,
    foreignWarnedAt,
    resetAt,
    resetReason,
    invalid,
    changedDuringRun,
  }
}

function decidePullRequest(args) {
  const { pr, now, options } = args
  const ineligible = pullEligibility(args)
  if (ineligible) return { action: 'skip', reason: ineligible }
  const evidence = collectWarningEvidence(args)
  const { labeledAt, warnedAt, foreignWarnedAt, resetAt } = evidence
  if (evidence.invalid)
    return { ...evidence, action: 'skip', reason: 'invalid-warning-evidence' }
  if (evidence.changedDuringRun)
    return { ...evidence, action: 'skip', reason: 'evidence-after-run-start' }
  if (
    foreignWarnedAt &&
    foreignWarnedAt >= warnedAt &&
    foreignWarnedAt >= resetAt
  )
    return { ...evidence, action: 'skip', reason: 'unsupported-warning-author' }

  const hasStaleLabel = hasLabel(pr, options.staleLabel)
  const resetWarning = !warnedAt || resetAt >= warnedAt
  if (!hasStaleLabel || !labeledAt || resetWarning) {
    // Retry an absent label only if no recorded successful application at or
    // after this warning exists. Otherwise its disappearance needs a fresh
    // warning even when the removal event is missing. Labeling grants a full
    // new period; missing history is not proof of a previous request failure.
    // Quiet retries are bounded to the warning's own current period; expired
    // warnings must be delivered again, including after label configuration changes.
    const reuseWarning =
      !hasStaleLabel &&
      !resetWarning &&
      labeledAt < warnedAt &&
      now < warnedAt + options.prWarningDays * DAY_MS
    return {
      ...evidence,
      action: 'warn',
      reason: resetWarning
        ? warnedAt
          ? 'lifecycle-reset'
          : 'missing-warning'
        : !hasStaleLabel
          ? 'missing-stale-label'
          : 'missing-label-event',
      // An intact label event need not be recreated: the new warning alone
      // starts a full period. Avoid our own unlabeled event feeding back as
      // a same-second reset on every subsequent run.
      resetLabel: hasStaleLabel && !labeledAt,
      reuseWarning,
    }
  }
  const deadline =
    Math.max(labeledAt, warnedAt) + options.prWarningDays * DAY_MS
  return {
    ...evidence,
    deadline,
    action: now >= deadline ? 'close' : 'wait',
    reason: now >= deadline ? 'deadline-reached' : 'warning-period',
  }
}

module.exports = {
  WARNING_MARKER,
  pullEligibility,
  collectWarningEvidence,
  decidePullRequest,
}
