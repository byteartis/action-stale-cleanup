# Stale Cleanup

A self-contained GitHub Action for warning and closing old pull requests and deleting unused branches. Defaults to **dry run**. Uses the consuming repository's `GITHUB_TOKEN`; no checkout, dependency installation, or personal access token is required.

## Usage

Add a workflow in each repository you want to clean:

```yaml
name: Repository Cleanup

on:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: repository-cleanup
  cancel-in-progress: false

jobs:
  cleanup:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: byteartis/action-stale-cleanup@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          dry-run: 'true'
          pr-stale-days: '7'
          pr-warning-days: '7'
          branch-inactive-days: '30'
          branch-grace-days: '7'
          excluded-branches: |
            release/*
            staging
```

`@main` is usable after this implementation is pushed. No version tag is assumed to exist yet. For production, pin a released version or preferably a full commit SHA. The action's `node24` runtime requires a sufficiently recent Actions runner; GitHub-hosted runners provide it.

For manual **job parameters** with number inputs, repository-variable fallbacks for scheduled runs, and preview-only scheduling until `CLEANUP_ENABLED=true`, copy [examples/cleanup.yml](examples/cleanup.yml). Schedules belong to the consuming workflow, not the action. GitHub may disable scheduled workflows in public repositories after 60 days without repository activity; re-enable them when needed.

## Inputs

| Input                  | Default               | Meaning                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`         | `${{ github.token }}` | Consuming repository's `GITHUB_TOKEN`; use this token so warning comments are authored by `github-actions[bot]`. Other token identities are not supported. Existing warning markers from other bots or repository owners/members/collaborators are skipped with a warning instead of repeatedly commenting; after switching to `GITHUB_TOKEN`, remove those marked comments to resume cleanup. |
| `dry-run`              | `true`                | Log candidates without mutating labels, comments, PRs, or branches.                                                                                                                                                                                                                                                                                                                            |
| `pr-stale-days`        | `7`                   | PR **creation age** before warning; strictly greater than this number.                                                                                                                                                                                                                                                                                                                         |
| `pr-warning-days`      | `7`                   | Full days after both the delivered warning and latest stale label before closure.                                                                                                                                                                                                                                                                                                              |
| `branch-inactive-days` | `30`                  | Inactivity threshold for branches with no PR history or new work after closure; strictly greater than this number.                                                                                                                                                                                                                                                                             |
| `branch-grace-days`    | `7`                   | Minimum grace since all PR closures and recorded ref activity for unchanged closed PR heads.                                                                                                                                                                                                                                                                                                   |
| `stale-label`          | `stale`               | Automatically created if needed; starts the warning clock together with the bot comment.                                                                                                                                                                                                                                                                                                       |
| `exempt-label`         | `keep-open`           | Preserve the PR and its source branch, including closed PR history.                                                                                                                                                                                                                                                                                                                            |
| `exempt-drafts`        | `true`                | Skip draft PRs.                                                                                                                                                                                                                                                                                                                                                                                |
| `excluded-branches`    | empty                 | Newline-separated, case-sensitive patterns. `*` matches any sequence (including `/`); all other characters are literal.                                                                                                                                                                                                                                                                        |

All day values must be positive integers representable safely as milliseconds. Invalid values or malformed booleans fail before any GitHub mutation. Labels must be distinct (case-insensitively), nonempty, at most 50 characters, and contain no newlines or backticks.

Label matching is case-insensitive, including timeline events. The exemption label is **not** automatically created: create it in the consuming repository before using it.

The default branch is **always excluded**. No organization-specific branch names are built in. Explicitly configure exclusions for deployment, environment and release branches in each repository, and protect them against deletion with GitHub rulesets or branch protection too.

## Cleanup policy

### Pull requests

- PR deadlines are based on **age**, not inactivity. Comments and commits do not extend either deadline.
- Drafts (unless disabled), PRs with the exemption label, and same-repository heads matching the default branch or configured exclusions are skipped. Fork heads are not exempt merely because their names match a local exclusion; fork branches are still never deleted.
- Deliver a warning comment before applying the stale label. Both a bot-authored marked warning and the latest label event are required for closure; manually labeling a PR alone is not sufficient.
- Reopening, marking ready for review, or removing the exemption label triggers a fresh warning period. Removing the stale label restarts the warning; the exemption label is the permanent opt-out.
- After automatic closure, an unchanged same-repository source branch can be deleted immediately if no other open PR uses it as head or base. Fork branches are never deleted. This immediate path does not use the orphan-branch grace period.
- PR state and exemptions are re-read before closure. Failed closure notifications do not prevent separately guarded branch cleanup.

### Branches

- Preserve default/excluded/protected branches and branches used as an open PR **head or base**. An exemption label on any historical local PR also preserves the branch.
- The closed-PR fast path requires that the tip matches a closed PR's exact head, all PRs have been closed for at least `branch-grace-days`, and any recorded latest ref activity is at least that old.
- Branches with no PR history or commits after PR closure require more than `branch-inactive-days` since the later of commit committer time and recorded ref activity, plus any applicable closure/activity grace.
- Latest push/creation/merge activity comes from GitHub's repository activity API. If no activity is retained for the ref, commit time is the fallback for the inactivity rule. Commit age is **not** branch creation time or last push time.
- Recheck SHA/protection and open PR heads/bases immediately before deleting. GitHub has no atomic compare-and-delete API: a push or PR opening in the final API-call window cannot be completely ruled out. Critical branches must be excluded and protected.

The action paginates and isolates per-item errors. It attempts independently guarded branch cleanup even if the PR phase fails, but the action remains failed if any non-benign error occurs. Protection/ruleset denial is reported, not bypassed; disappeared resources are warnings.

## Relationship to `actions/stale`

[`actions/stale`](https://github.com/actions/stale) already supplies ordinary PR warning, labeling, and closure. Prefer it when activity-based closure meets your needs. This action deliberately keeps a small fixed-deadline PR processor and separate guarded branch cleanup rather than maintaining a broad upstream fork. See the [alignment decision and behavior matrix](docs/PR_ALIGNMENT_DECISION.md) and [deadline contract](docs/PR_POLICY_CONTRACT.md).

| This action                   | Upstream equivalent or difference                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pr-stale-days`               | `days-before-pr-stale` with `ignore-pr-updates: true` for creation-age eligibility                     |
| `pr-warning-days`             | Similar to `days-before-pr-close`, but our deadline is independent of later activity                   |
| `stale-label`, `exempt-label` | `stale-pr-label`, `exempt-pr-labels`                                                                   |
| `exempt-drafts`, `dry-run`    | `exempt-draft-pr`, `debug-only`                                                                        |
| PR-only processing            | Upstream issue stale/close thresholds can both be set to `-1`                                          |
| Guarded branch cleanup        | Not equivalent to upstream `delete-branch`; includes orphan/historical PR branches and safety rechecks |

In the compared upstream v11.0.0 implementation, `ignore-pr-updates` changes warning eligibility; disabling stale-label removal on updates does **not** make closure activity-independent. Our closure requires a trusted delivered warning plus a label event, using the later timestamp and the current configured warning period. Closure becomes eligible at the deadline and happens on the next successful run. Lowering configured thresholds can advance pending deadlines.

Same-second reset/warning ordering is treated conservatively as a reset. Removing the stale label also resets the warning requirement, even if it is manually reapplied before the next run. A successfully delivered warning can retry a missing label without another comment only while that warning is still within its current warning period and no reset or recorded application at/after it exists; the newly applied label still gets a full warning period. Otherwise, a disappeared label gets a fresh warning. Malformed relevant dates are skipped with a warning; valid creation/evidence dates after the run began are deferred at info level, since normal mid-run changes are not corrupt evidence. Neither case authorizes mutations.

Before renaming `stale-label` or `exempt-label`, run preview and review pending PRs: old comment instructions do not automatically change. An expired warning gets a fresh notice, but an unexpired warning may quietly acquire the new stale label; removing the old stale label then no longer resets its deadline. To force new instructions for all pending PRs, remove their prior marked bot warning comments before using the new configuration. Removing old labels alone does not guarantee a fresh notice, and this action does not automatically remove those old labels.

Migration from upstream labels/comments does not adopt them as trusted warning evidence: expect a fresh full warning period. Deleting a warning or removing its marker invalidates that comment; edits retaining the trusted marker keep the creation-time clock. Do not run two cleanup actions against the same stale label at the same time.

## Safe rollout

1. Configure all long-lived branch exclusions and protections **before** enabling mutations.
2. Run with `dry-run: 'true'` and inspect logs. PR closure candidates do not simulate deletion of their still-open heads; a real deletion needs a fresh safety check after closure.
3. Add the exemption label to PRs that should survive.
4. Set `dry-run: 'false'` only after reviewing candidates. In the full example, manual false explicitly enables mutations; schedules remain preview-only until the repository Actions variable `CLEANUP_ENABLED` equals the literal string `true`.

The token needs only `contents: write` (branches/activity/ref deletion) and `pull-requests: write` (PRs, labels, comments, events). These endpoints accept Pull requests permission; `issues: write` is unnecessary. No issue cleanup occurs. Avoid adding unrelated token permissions or personal access tokens.

## Development and releases

```sh
npm ci
npm test
npm run format:check
npm run build
```

Tests use mocks, not live GitHub writes. `npm run test:upstream` optionally downloads the pinned `actions/stale` v11.0.0 source and its build dependencies into a temporary directory, then compares real upstream processing with this action using mocked GitHub scenarios. It requires network access; it is not part of the offline unit-test suite or routine CI. No downloaded code is included in the production bundle.

CI rebuilds and compares the committed `dist/` bundle, checks formatting, runs tests, and exercises the bundled entrypoint with invalid input without contacting GitHub. `dist/index.js` and its dependency license file must be committed: consumers run the bundle directly.

Before publishing, commit the source, tests, lockfile, action metadata and generated bundle together. Create a semver release tag (for example `v1.0.0`), then maintain the corresponding major tag (`v1`) for compatible updates. No releases or tags are created automatically. Keep destructive-policy changes documented and use major versions for breaking changes.

MIT licensed; see [LICENSE](LICENSE). Dependency notices are in `dist/licenses.txt`.
