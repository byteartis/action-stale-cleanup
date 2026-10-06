# PR alignment validation and review

## Scope

Original review request: implement `PR_ALIGNMENT_PLAN.md`, retain activity-independent PR closure, ask Opus 5.5 High to review against the plan, and iterate development/review until complete. That review scope authorized local work, not publication or live GitHub mutations. The historical review record below is preserved; subsequent implementation publication and explicitly requested read-only validation are recorded separately.

Chosen architecture: B (small processor with pure policy); see `PR_ALIGNMENT_DECISION.md` and `PR_POLICY_CONTRACT.md`. During the review rounds, the implementation was uncommitted on the original `main`, based on initial commit `a4eb597`. The session-local pre-alignment snapshot was `/tmp/stale-cleanup-baseline.arkmAx`. The implementation has since been committed and merged as `719c78d193ce6ac91f2ee2f5bd63ad62e8c86d3b`; see the publication checkpoint below.

## Local validation before review round 1

- `npm test`: 224 passing local tests, zero failures.
- `npm run test:upstream -- --upstream /tmp/stale-upstream-spike.kIzZ4G/upstream`: 33 passing comparisons against the real unmodified pinned upstream processor. The research child also verified the fresh-download/install path.
- `npm run format:check`: all source, scripts, workflows and documentation pass.
- `npm run build`, copy `dist/`, `npm run build`, `diff -r`: identical bundle output, including dependency notices. Updated generated artifacts remain in `dist/`.
- Bundled `dist/index.js` with invalid `INPUT_PR-STALE-DAYS`, preview enabled: exit 1 and expected validation error; no client creation or GitHub mutations.
- `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/test.yml examples/cleanup.yml`: pass.
- `npm audit --audit-level=low`: zero vulnerabilities.
- `git diff --check`: pass for tracked changes. New files are also covered by Prettier.

## Review rounds

### Round 1 — completed, changes requested

Opus 5.5 (`claude-opus-5-5`) with `effort=high` found no unsafe closure/deletion defect, but raised five actionable items: one medium test gap and four low diagnostic/retry/documentation/reproducibility findings. The reviewer confirmed 224 local tests, 33 upstream comparisons, formatting, bundle equivalence, unchanged branch/config/runner code, and real upstream harness execution.

- Request: `pr-alignment-opus-review-round-1`.
- Task: `node:delegated-task:command%3Amcp%3Afc4cdeaa-682f-49c0-8f70-d1dbab5bbb9b%3Adelegate-task%3Apr-alignment-opus-review-round-1`.

### Responses and validation for round 2

1. **Missing-label-event repair coverage:** pure policy now asserts `resetLabel=true`; processor asserts remove/comment/label order. A realistic multi-run test makes adding an existing label a no-op, records same-second removal/reapplication, allows only two fresh warnings, then waits and closes exactly after the full period from the last warning. A temp mutation forcing `resetLabel=false` now fails three tests (previously survived all tests).
2. **Mid-run timestamps:** malformed timestamps still warn/skip, but valid timestamps after the fixed run start defer at info level with `creation-after-run-start` or `evidence-after-run-start`. Added initial-list and final-refresh `NOW+1s` tests. No timestamp after run start authorizes a mutation, including genuinely future-dated evidence.
3. **Warning reuse:** require `labeledAt < warnedAt`, as well as label absence and no reset. Recorded successful/ambiguous applications at/after the warning now require a fresh comment. Equality and later/earlier boundaries plus processor behavior are tested. Removing this guard in a temp mutant fails three tests. Missing retained history cannot prove a failed request; the contract now says so rather than claiming exact knowledge, and every retry still grants a full period after labeling.
4. **Documentation:** updated current integration status, correct policy-module link, wired script, temp-directory behavior, bundle scope, and configuration-only exemption behavior. No publication approval is implied.
5. **Upstream reproducibility:** reject tracked and untracked source/manifest/config changes using `git status`; always reinstall via pinned-lockfile `npm ci --ignore-scripts`, even on a reused checkout. Three offline subprocess tests cover dirty source/config rejection and reinstall despite an existing compiler. The trusted-local reuse option now explicitly replaces its temporary checkout's `node_modules`.

After corrections: `npm test` passes **235 tests**; the real-upstream comparison passes **33 tests**, including a fresh locked dependency reinstall on the reused checkout. Both policy mutants are killed (3 failures each in the 119-test focused policy/processor suite); only temporary copies were mutated. Formatting, updated bundle reproducibility/smoke, workflow lint and audit are revalidated before review dispatch. No objections are left unaddressed by the parent; final acceptance remains the next reviewer's decision.

### Round 2 — completed, one low-severity change requested

Opus 5.5 High independently confirmed all five round-1 findings resolved, 235 local tests and 33 upstream comparisons passing, authentic upstream execution, bundle equivalence, and plan compliance. A 19-mutant sweep caught deadline, trust, ordering and final-read regressions. One new low finding remained: changing `stale-label` can quietly apply the new label using an old warning that still instructs authors to remove the old label. No unsafe closure/deletion defect was found.

- Request: `pr-alignment-opus-review-round-2`.
- Task: `node:delegated-task:command%3Amcp%3A4214a123-4ed1-42bd-899c-58affb4e7259%3Adelegate-task%3Apr-alignment-opus-review-round-2`.

### Response for round 3

Warning reuse is now additionally bounded by `now < warnedAt + current pr-warning-days * 24h`. A warning at the boundary or older must be delivered again, covering stale-label renames and old warnings without retained label history. Pure tests cover just-before/exact/just-after the boundary and a 200-day-old warning; processor tests cover recent versus expired warnings during a label rename. Existing same-second repair and successful-warning/failed-label retry behavior remains covered.

The contract and README explicitly describe the remaining recent-warning rename behavior: a still-unexpired warning can quietly acquire the new label, but its old label-removal/opt-out instructions do not update automatically. Preview and review pending PRs before renaming either policy label. To force updated notices, remove prior marked bot warning comments; merely removing old labels is not sufficient. Old labels are not automatically removed. This takes the reviewer's code option plus its documentation mitigation rather than implying that an age bound proves label-name compatibility.

Validation after these changes: **242 local tests and 33 real-upstream comparisons pass**, along with formatting, updated bundle reproducibility/smoke, workflow lint, audit (zero vulnerabilities), and whitespace checks. In the focused 126-test policy/processor suite, deleting the expiry guard fails five tests and changing `<` to `<=` fails two; only temporary copies were mutated and then removed.

### Round 3 — completed, no actionable findings

Opus 5.5 High reported **no actionable issues**. It independently confirmed the expiry guard, honest recent-warning rename guidance, plan compliance, 242 passing local tests, 33 pinned-upstream comparisons after a fresh locked reinstall, formatting/whitespace checks, zero audit vulnerabilities, reproducible bundle (including licenses), and an invalid-input bundled smoke test with no API calls. Branch/config/runner/action files remain byte-identical to the pre-alignment snapshot. Additional mutation probes caught expiry-formula, period scaling, label-ordering and reset regressions.

The reviewer suggested two optional improvements: describe retry eligibility as an unexpired warning in the behavior matrix, and directly distinguish `prWarningDays` from `prStaleDays` in an expiry test. Both are addressed after the clean review without changing production code or the reviewed bundle.

- Request: `pr-alignment-opus-review-round-3`.
- Task: `node:delegated-task:command%3Amcp%3A4214a123-4ed1-42bd-899c-58affb4e7259%3Adelegate-task%3Apr-alignment-opus-review-round-3`.

## Final local checkpoint

- `npm test`: **244 passing tests**, including two new unequal-threshold expiry cases (`prStaleDays=2/prWarningDays=10` and `20/3`).
- A temporary mutation using `prStaleDays` for retry expiry now fails both new cases directly (44 pass, 2 fail in the 46-test pure-policy suite); the temporary copy was removed.
- The production policy and bundle are unchanged from the clean round-3 review. Only optional tests, matrix wording, and completion bookkeeping changed afterward.
- Real-upstream comparisons: **33 pass** against the pinned release, verified independently in round 3. Formatting, bundle reproducibility/smoke, workflow lint and audit also pass.
- No actionable review objections remain. The local implementation/review loop is complete.

## Implementation publication and hosted CI — 2026-10-06

- [PR #1](https://github.com/byteartis/action-stale-cleanup/pull/1) merged at `2026-10-06T17:15:13Z` as [`719c78d193ce6ac91f2ee2f5bd63ad62e8c86d3b`](https://github.com/byteartis/action-stale-cleanup/commit/719c78d193ce6ac91f2ee2f5bd63ad62e8c86d3b). Remote `main` points at this commit.
- [Test Action run 37502108844](https://github.com/byteartis/action-stale-cleanup/actions/runs/37502108844) completed successfully on that exact commit. All validation steps passed: `npm ci`, formatting, unit tests, rebuilding and comparing the committed bundle, and the invalid-input bundled smoke test.
- The implementation branch commit used for the local live previews was `265320ea033b2bdcff90a5c8be76763f295b6140`. Its `src/`, `dist/`, and `action.yml` are identical to those in the merged commit, as verified with `git diff`.
- Local release-readiness checks also reconfirmed 244 passing unit tests, formatting, bundle equivalence, and zero production dependency audit findings. These local checks are distinct from the earlier 33 upstream comparisons; those comparisons were not rerun for this documentation update.

## Live read-only validation — 2026-10-06

The user authorized local dry-run checks against the action repository and `SWORDHealth/service-chat`, using the `GITHUB_TOKEN` available in the login-shell environment. Both checks ran the committed `dist/index.js` with `dry-run: true`, first with documented defaults (`7/7/30/7` days for PR stale/warning and branch inactivity/grace), then with all four thresholds set to one day. No custom branch exclusions were configured, and draft exemptions remained enabled.

- **Action repository:** both scenarios exited successfully, each making 6 GET requests with HTTP 200 responses. No open PRs existed and the merged branch was still within the grace period, so no cleanup candidates were logged. Supplemental PR event/comment and repository activity reads also returned HTTP 200.
- **`service-chat`:** the repository had 30 branches and 6 open PRs. Defaults produced 3 PR warning candidates, no eligible closures, and 17 branch deletion candidates across 161 successful GET requests. One-day thresholds produced 3 warning candidates, no eligible closures, and 23 branch deletion candidates across 186 successful GET requests. Neither action run emitted warnings or errors. Supplemental event/comment/activity reads succeeded after retrying a connection failure in the validation harness.
- **Mutation safeguards:** a diagnostic-channel guard was configured to stop the action process before any non-read HTTP request. It observed only GET requests; no blocking was needed. Before/after snapshots matched: all branch names/SHAs/protection flags and open-PR state/labels/head SHAs were checked, along with closed PR history in the action repository and five sampled closed PRs in `service-chat`. This is a sampled state comparison, not an exhaustive audit of every repository resource. No GitHub cleanup mutations, project-file changes, or commits were made during these runs.
- **Rollout warning:** without custom exclusions, `team/mobile` qualified for deletion under defaults and all six `team/*` branches qualified under one-day thresholds. Candidate eligibility is not approval to delete these branches. Configure repository-specific exclusions and protections before enabling mutations.
- **Evidence retention:** sanitized logs, read-only request audits, and snapshot results were written outside the checkout to `/tmp/stale-cleanup-live-check.g7IM0S/` and `/tmp/stale-cleanup-service-chat.D74xxD/`. These session-local artifacts are temporary, not committed or hosted evidence; this document records their verified results.

These checks validate real API reads, candidate selection, and preview behavior. They did not run in a consuming Actions workflow, verify that the environment token was workflow-issued, establish write permissions, or test bot-authored warning/label delivery, PR closure, or branch deletion. No closure candidate was available, so live closure preview was not exercised. Any live-write validation requires separate explicit authorization.

## Remaining release/rollout gates

Implementation publication, hosted CI, local real-GitHub dry runs, and release-facing example updates are complete. The examples use `@v1` with full-SHA pinning guidance, but still require publication of the release tag. Initial release notes/tags, consuming-workflow authentication validation, repository-specific rollout configuration, and enabling mutations remain separate pending work in `OPEN_POINTS.md`. No live GitHub cleanup lifecycle writes have been performed or authorized by these dry-run requests.
