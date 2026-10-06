# Open points

The reviewed implementation has no pending actionable review findings for its supported `GITHUB_TOKEN` configuration. The requested `actions/stale` alignment is locally complete, preserving activity-independent PR closure. Publication and rollout remain separate, unperformed gates.

## PR policy and upstream alignment

- [x] **Implement and complete iterative alignment review.** [PR_ALIGNMENT_PLAN.md](PR_ALIGNMENT_PLAN.md) is locally complete: the chosen small-processor architecture preserves fixed deadlines, delivered-warning evidence, and guarded branch cleanup. Three Opus 5.5 High review rounds resolved all actionable findings; round 3 found none. Final local validation passes 244 tests and 33 real-upstream comparisons, with a reproducible rebuilt bundle. See [docs/PR_ALIGNMENT_REVIEW.md](docs/PR_ALIGNMENT_REVIEW.md). No publication or live mutations were authorized or performed.

## Publication and rollout

- [ ] **Commit and push with approval.** All implementation changes are still local and uncommitted on `main`; the remote has only its initial commit. Review the working tree, include the generated `dist/` artifacts, and obtain authorization before publishing. See [README: Development and releases](README.md#development-and-releases).
- [ ] **Verify hosted CI.** Local tests, formatting, bundle reproducibility, workflow lint, and dependency audit passed. The new workflow has not yet run on GitHub. Completion: [.github/workflows/test.yml](.github/workflows/test.yml) passes against the published implementation.
- [ ] **Exercise the action in a real dry run.** Current tests mock GitHub; the bundled entrypoint has been smoke-tested only with invalid input. Run a consumer workflow using [examples/cleanup.yml](examples/cleanup.yml), retaining preview mode. Completion: real PR/branch reads and candidate logs behave as documented, with no mutations.
- [ ] **Choose and publish the initial release.** After CI and dry-run validation, agree on the release/tag policy described in the README and replace bootstrap `@main` references as appropriate. No release or version tags have been created by this work.
- [ ] **Adopt in consuming repositories deliberately.** Configure repository-specific exclusions and opt-outs before enabling mutations; use [README: Safe rollout](README.md#safe-rollout). The original `service-chat` checkout is clean and no longer contains the cleanup implementation. Adding a thin consumer workflow there is a separate follow-up, not already done.

## Optional, deferred hardening

- [ ] **Unsupported PAT identities with ambiguous author association.** The final Opus review noted that a PAT author's warning comments might appear as `CONTRIBUTOR` or `NONE` rather than owner/member/collaborator. Such markers may be ignored and repeated warnings may recur. PATs are explicitly unsupported; this is not a release blocker for `GITHUB_TOKEN`. If expanding support, consider recognizing the author of the latest stale-label event as privileged for the foreign-marker skip, without counting foreign comments as closure evidence. Relevant code: [src/pr-policy.cjs](src/pr-policy.cjs). Add tests for association ambiguity, label-actor identity, and outsider marker spoofing; rebuild `dist/` and re-review any change to this trust boundary.

## Review checkpoint

Six Opus 5.5 High rounds covered the original implementation and standalone packaging (173 tests at that baseline). Three additional alignment rounds are complete; the final round reported no actionable issues and independently verified 242 tests, 33 upstream comparisons, and bundle equivalence. Two optional test-strength cases added afterward bring local coverage to 244 tests without changing production code or the reviewed bundle. Only the unsupported-PAT hardening above remains deferred. Detailed policy and configuration remain authoritative in [README.md](README.md) and [action.yml](action.yml); review evidence is in [docs/PR_ALIGNMENT_REVIEW.md](docs/PR_ALIGNMENT_REVIEW.md).
