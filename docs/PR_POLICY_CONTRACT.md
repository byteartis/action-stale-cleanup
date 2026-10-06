# Fixed-deadline PR contract

The user authorized implementation of `PR_ALIGNMENT_PLAN.md` with activity-independent closure. The following contract is the implementation gate; `src/pr-policy.test.cjs` exercises it without GitHub or mutation code.

## Decisions

| Condition                                                                                 | Decision                                                         |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Closed/merged, current exemption, or creation age at most the configured threshold        | Skip                                                             |
| Eligible, no delivered trusted warning                                                    | Warn, then label                                                 |
| Eligible, label present but no label event                                                | Remove label, deliver a fresh warning, then label                |
| Eligible, latest lifecycle reset at or after warning creation                             | Fresh warning and label period                                   |
| Eligible, label absent, unexpired warning, no reset or label application at/after warning | Retry labeling without another comment                           |
| Valid warning and label; before the deadline                                              | Wait                                                             |
| Valid warning and label; at/after the deadline                                            | Recheck and close                                                |
| Relevant evidence has malformed timestamps                                                | Skip with a diagnostic; never mutate based on ambiguous evidence |
| Creation/evidence dated after run start                                                   | Defer at info level; revisit next run                            |
| Current privileged foreign marked warning                                                 | Skip with the existing unsupported-author diagnostic             |

Eligibility uses `created_at`, strictly greater than `pr-stale-days * 24h`. Closure uses `max(warning.created_at, latest stale-label event.created_at) + pr-warning-days * 24h`, inclusive at the deadline. Both use current inputs; lowering thresholds can advance eligibility. Scheduled execution means closure occurs on the next successful run, not at an exact wall-clock instant.

## Lifecycle, retry, and warning identity

Reopening, becoming ready for review, removing `keep-open` (or configured exemption), and removing the stale label reset the warning requirement. Removal followed by manual reapplication does not bypass a fresh warning. A reset timestamp equal to the warning timestamp is ambiguous across separate comment/event APIs: conservatively re-warn. Array order is not proof of ordering across those APIs.

Fresh warnings normally retain an existing valid stale-label event rather than removing/reapplying the label: the newer warning timestamp already starts a full period. This follows upstream's add-label pipeline and avoids a feedback loop where our own label removal and new warning share a timestamp and repeatedly trigger another reset. Only a present label with no recorded label event is removed/recreated to repair that missing evidence. A same-second tie may require one conservative later warning; retaining the label prevents generating another ambiguous removal on every retry.

A delivered warning is reused only when the label is absent, no subsequent reset invalidates it, no recorded label application is at or after warning creation, and `now < warning.created_at + current pr-warning-days * 24h`. At the exact boundary or later, deliver a fresh warning rather than quietly reviving an expired one. An application timestamp equal to the warning is treated as successful/ambiguous, not as proof of a failed label request. If there is no retained application history, the action cannot prove that a previous request failed; only an unexpired warning can qualify, and labeling still grants a full new period. Otherwise, a disappeared label gets a fresh warning rather than a quiet reapplication. Retrying the label establishes a new label timestamp, so closure still waits a full period after successful labeling. A present label without a recorded event is not treated as a successful retry: restart conservatively.

Only the existing marked `github-actions[bot]` comments supply closure evidence. Outsider markers are ignored. Privileged foreign markers retain the baseline skip behavior, never closure authority; unsupported PAT support is unchanged. Upstream `actions/stale` comments without our marker do not supply evidence: migration requires a fresh full warning period.

Deleted comments or edits removing the marker remove their evidentiary value. Editing a marked trusted comment while retaining the marker does not reset its creation-time clock, as in the reviewed baseline; warning bodies are not an immutable policy snapshot. Threshold inputs are the authoritative policy. Relevant malformed dates cause a conservative skip with a warning. Valid dates after the run's fixed start time are deferred with the info-level `creation-after-run-start` or `evidence-after-run-start` reason: normal mid-run changes are not labeled corrupt evidence. Truly future-dated evidence is likewise deferred, never used to authorize a mutation. Unrelated events and outsider comments cannot poison evidence.

Changing `stale-label` does not adopt old label events under the new name. An expired pending warning gets a fresh comment naming the new label, but a recent, unexpired warning may qualify for quiet reapplication of the new label. In that case, its existing comment still names the old label; removing the old label no longer resets the current policy. A changed `exempt-label` likewise makes old comment opt-out instructions obsolete. Before changing either label name, run preview and review pending PRs. To force updated instructions for every pending PR, remove its prior marked bot warning comments before using the new configuration; removing the old labels alone does not guarantee a fresh warning. The old labels are not automatically removed by this action.

## Intentional hardening versus baseline

- Stale-label removal is now an explicit reset even when someone manually reapplies the label before the next run. Fresh warnings retain valid label evidence rather than generating another removal/reset themselves.
- Successful-warning/failed-label retries avoid duplicate comments only within the warning's current period and without evidence of a successful application at/after the warning; expired/ambiguous retries get a fresh notice.
- Relevant invalid/future timestamps cannot fall through to closure.
- Final closure evaluation refreshes warning and lifecycle evidence, not just PR state/labels.

No changes to input names, defaults, permissions, draft/branch exemptions, fork handling, per-item errors, or branch deletion policy are part of this contract. Ordinary comments, commits/pushes, and unrelated label changes do not affect closure eligibility. Configuration-only exemptions have no timeline reset: removing an exclusion or disabling draft exemption can make an already warned PR immediately eligible under its existing deadline. Review candidates in preview before changing such settings.

## Final check and remaining race

Before closure, refresh PR state, events and comments, then read PR state once more and evaluate the same pure policy. If evidence changed to a warning/wait/skip decision, do not close; let the next run handle any new warning. Branch deletion independently retains its SHA/protection/head/base safety checks. GitHub exposes no atomic conditional close/delete with all these predicates, so changes after the last reads remain possible. Do not claim the race is eliminated.
