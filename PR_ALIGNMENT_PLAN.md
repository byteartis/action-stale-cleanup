# PR cleanup alignment plan

## Goal and scope

Retain **activity-independent PR closure**, while bringing the implementation closer to `actions/stale` and reducing duplicated maintenance where practical. This is a new design review, not a reopening of the completed baseline review.

The requirement is not ordinary inactivity-based staling: comments and commits must not postpone closure once a valid warning period has started. Exemptions and explicit lifecycle transitions may restart that period.

The user has authorized local implementation and iterative Opus 5.5 High review against this plan. Publication, release tags, live GitHub mutations, and rollout remain separately gated.

## Upstream baseline

Compare against the immutable [actions/stale v11.0.0 release](https://github.com/actions/stale/releases/tag/v11.0.0), rather than a moving `main` branch:

- [Inputs](https://github.com/actions/stale/blob/v11.0.0/action.yml)
- [PR/issue processor](https://github.com/actions/stale/blob/v11.0.0/src/classes/issues-processor.ts)

Upstream already handles warning comments, stale labels, configurable thresholds, draft/label exemptions, preview mode, operation limits, and resumable processing. Creation-age warning eligibility is available through `ignore-pr-updates`.

However, its closure path still checks recent `updated_at` and human comments since labeling, even when stale-label removal on updates is disabled. Warning-comment failure does not prevent a subsequent label attempt. Its branch deletion does not implement our SHA, open-head/base, or configured exclusion checks. Configuration alone is therefore not an equivalent replacement.

## Non-negotiable safeguards

- Default to preview; validate configuration before any mutation.
- Preserve `GITHUB_TOKEN` support and the existing warning-author trust boundary. Do not expand PAT support as part of alignment.
- Never close solely because someone applied a stale label; require evidence of a delivered trusted warning.
- Re-read PR state and exemptions before closure. Skip merged/closed PRs and current exemptions.
- Keep guarded repository-wide branch cleanup separate from PR policy. Do not substitute upstream `delete-branch` for `src/cleanup-policy.cjs`.
- Preserve fork, default/excluded/protected branch, unchanged-SHA, and other open PR head/base protections.
- Preserve per-item failure isolation and failed-run reporting; a PR-phase failure must not prevent independently guarded branch cleanup.

## Phase 1 — Specify the deadline contract before refactoring

- [x] Produce a behavior matrix covering our implementation, upstream behavior, and the intended policy. See [docs/PR_ALIGNMENT_DECISION.md](docs/PR_ALIGNMENT_DECISION.md).
- [x] Confirm the proposed baseline contract below, distinguishing intentional differences from behavior that can converge upstream. Implementation authorization accepts this contract; edge-case decisions are recorded in [docs/PR_POLICY_CONTRACT.md](docs/PR_POLICY_CONTRACT.md).
- [x] Turn the matrix into policy tests independent of the eventual processor architecture. `src/pr-policy.test.cjs` tests the pure decision contract; processor regressions are written before wiring the new policy.

Proposed contract, preserving current documented policy unless explicitly revised:

1. Warning eligibility: creation age is strictly greater than `pr-stale-days`; comments and commits do not change it.
2. Deliver the warning before applying the label. A failed warning must not start a closure clock.
3. Closure deadline: `max(valid warning creation time, latest stale-label event time) + pr-warning-days * 24h`. Closure is eligible at or after that deadline, on the next scheduled run; it is not an exact-time timer.
4. The stale label must still be present. No trusted warning or no valid label event means a fresh warning, not immediate closure.
5. Reopening, becoming ready for review, and removing the exemption label require a fresh warning period. Removing the stale label also requires a fresh warning before closure.
6. Comments, pushes, and unrelated label changes neither reset nor postpone the deadline.
7. Current draft/label/branch exemptions override deadline eligibility.

Explicitly review these edge cases rather than silently preserving incidental behavior:

- Same-second warning/reset timestamps and event ordering.
- Deleted/edited warnings, malformed timestamps, missing evidence, and unsupported/spoofed marker authors.
- Warning succeeds but labeling fails; labeling is retried on a later run. Decide whether a second warning is necessary and ensure retries cannot shorten the full warning period.
- Threshold changes while a warning is pending; proposed baseline uses current inputs, as today. Document that reducing the warning period can advance closure eligibility.
- Reset events or label changes between inspection and closure; document the remaining GitHub API race rather than claiming atomicity.

**Exit:** an approved contract and executable tests. No architecture changes before this gate.

## Phase 2 — Choose actual reuse versus targeted alignment

- [x] Run a bounded, non-production spike against the pinned upstream release. The executable suite compiles the real unmodified processor at `4391f3da665fdf50b6810c1a66712fb9ba21aa93`; 33 mocked comparison tests pass.
- [x] Compare two approaches using the Phase 1 tests and a written maintenance-cost assessment. Chosen: **B**, as recorded in [docs/PR_ALIGNMENT_DECISION.md](docs/PR_ALIGNMENT_DECISION.md), before production wiring. No fork or vendored upstream code.

### A. Minimal upstream fork / upstream contribution

Investigate adding an explicit fixed-deadline closure policy to upstream, including delivered-warning evidence and lifecycle resets. Keep branch deletion disabled and use our separate guarded cleanup.

Measure the actual patch required: the needed safeguards may make this more than replacing one date comparison. Inventory PR branch exclusions, input compatibility, permissions, dry-run behavior, error handling, upstream cache/state requirements, attribution/license obligations, and the recurring work to merge upstream updates. Do not assume upstream exposes a supported policy plug-in API.

### B. Retain the small processor, align its structure and semantics

Separate eligibility, evidence collection, deadline decisions, and mutation execution in `src/close-stale-prs.cjs`. Follow upstream's recognizable warn/label/close pipeline and reuse compatible conventions without importing its activity-dependent closure behavior or building its entire feature set.

Keep the decision layer small and directly testable. Add only operational improvements justified by our use case; richer assignee/milestone/issue filtering is not in scope.

**Exit:** record one choice and its trade-offs before implementation. Prefer A only if it genuinely reduces long-term maintenance while passing the policy/safety tests. A broad fork with extensive custom changes is not a win merely because it shares upstream code.

## Phase 3 — Implement the chosen approach incrementally

- [x] First change architecture without changing the approved policy or branch safety behavior. Extracted pure eligibility/evidence/deadline decisions before wiring them into the processor; branch helpers and runner remain unchanged.
- [x] Make intentional policy corrections in separate, documented changes with focused regression tests. Corrections are isolated in [docs/PR_POLICY_CONTRACT.md](docs/PR_POLICY_CONTRACT.md) and dedicated tests: stale-label removal resets, valid-label retention to avoid self-reset loops, missing-label retry, invalid/future timestamps, and refreshed closure evidence. No commits were made.
- [x] Log PR decision reasons and, for pending closure, the warning time, label time, reset reason, and calculated deadline.
- [x] Evaluate upstream-style operation budgeting/resumption for large repositories. Account for safety re-reads and the separate branch phase; defer new inputs or persistent state unless necessary. The spike demonstrates upstream budget overshoot and processed-ID deferral; new state/budgets are deferred with rationale in the decision document.
- [x] Preserve existing public input names/defaults unless a migration is explicitly approved. Document upstream equivalents rather than adding duplicate aliases automatically. README documents mappings; inputs/defaults/permissions are unchanged.
- [x] Keep immediate post-closure deletion versus branch-phase grace behavior unchanged unless separately approved.

**Exit:** all existing applicable tests and new contract tests pass; source, documentation, and generated bundle agree.

## Phase 4 — Validate equivalence and intentional differences

- [x] Test shared warning/exemption/preview cases against both implementations using mocked GitHub scenarios. `npm run test:upstream` executes the pinned real processor, not a policy facsimile; 33 comparison tests pass after integration.
- [x] Test intentional divergence: an old warned PR with a recent human comment or push still closes under our fixed-deadline policy.
- [x] Test exact boundaries, lifecycle resets, retry failures, manually applied labels, multi-page evidence, final rechecks, and all existing branch guards. 244 local tests pass after review corrections and two optional post-review test-strength cases, including actual Octokit pagination over mocked HTTP, multi-run retry/timestamp-tie/repair scenarios, warning-reuse/application/expiry boundaries and label renames, mid-run diagnostics, and upstream-runner reproducibility checks.
- [x] Keep preview mutation-free, including in partial-failure paths.
- [x] Define warning migration: existing upstream comments or stale labels are not automatically trusted as our warning evidence. Default to a fresh full warning period unless a separately reviewed migration is implemented. README and contract document this behavior.
- [x] Run formatting, tests, bundle reproducibility, bundled-entrypoint smoke test, workflow lint, and dependency audit. Local checks pass; bundle rebuilt twice with identical output; audit reports zero vulnerabilities; actionlint v1.7.7 passes both workflows.
- [ ] After publication approval, require hosted CI and real consumer preview evidence. If lifecycle writes need integration coverage, use only a separately authorized disposable repository—not production PRs.

## Iterative review gate

- [x] Obtain Opus 5.5 High review against this plan; resolve actionable findings and repeat review with the original brief and prior findings until no actionable findings remain. Three rounds completed; round 3 reported no actionable issues and confirmed plan compliance. Evidence is recorded in [docs/PR_ALIGNMENT_REVIEW.md](docs/PR_ALIGNMENT_REVIEW.md).

## Publication gate

The local design/implementation and iterative-review gates are complete. Hosted CI and real consumer preview remain unperformed, publication-dependent checks. Continue the publication checklist in [OPEN_POINTS.md](OPEN_POINTS.md). Record the chosen architecture, intentional upstream differences, validation commit, and CI/preview evidence there. Release tags and enabling mutations remain separate approval decisions.
