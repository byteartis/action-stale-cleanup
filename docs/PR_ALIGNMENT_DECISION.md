# PR alignment decision and bounded upstream spike

Choose **B: retain the small PR processor and extract its pure decision policy**.
Keep the recognizable warning → stale label → closure pipeline, creation-age
eligibility, exemptions and mutation-free preview. Keep guarded branch cleanup
separate. Configuration of upstream alone cannot implement the fixed deadline;
the required fork would change evidence, transitions, reads, execution, errors,
inputs and accounting together. No production dependency or fork is introduced.

This records the Phase 2 investigation and the upstream differential portion of
Phase 4. It does not approve publication, new permissions, persistent state, or
changes to branch policy. The parent owns production implementation and the
remaining validation gates in `PR_ALIGNMENT_PLAN.md`.

## Pinned evidence and scope

The spike fetched the actual `actions/stale` **v11.0.0** release, resolved to
**`4391f3da665fdf50b6810c1a66712fb9ba21aa93`**, into a temporary checkout.
The comparison runner verifies that commit and rejects tracked modifications and
untracked files in source, manifests and TypeScript configuration. It performs a
fresh `npm ci --ignore-scripts` from the pinned lockfile on every invocation,
including reused checkouts, before compiling with the locked compiler. No patch to upstream was implemented; this is a
source inventory and executable differential spike, not an estimated patch
advertised as a tested fork.

Primary evidence:

- [Processor, immutable source](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/src/classes/issues-processor.ts)
- [Inputs and defaults](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/action.yml)
- [Entrypoint and validation](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/src/main.ts)
- [State implementation](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/src/classes/state/state.ts),
  [cache storage](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/src/classes/state/state-cache-storage.ts)
- [Upstream permissions/state documentation](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/README.md),
  [MIT license](https://github.com/actions/stale/blob/4391f3da665fdf50b6810c1a66712fb9ba21aa93/LICENSE)

The upstream processor is 1,385 lines; its main entrypoint, cache storage and
state implementation add 213, 133 and 72 lines. The initial local PR processor
was 217 lines. These are checkout measurements, not a forecast of fork patch
size. A local policy extraction remains materially smaller than carrying
upstream's issue processing, optional filters, statistics and cache lifecycle.

## Behavior matrix

The upstream column uses the closest practical configuration: creation age via
`ignore-pr-updates=true`, `remove-pr-stale-when-updated=false`, matching 7-day
thresholds/labels, draft exemption enabled, and `delete-branch=false`.
“Baseline” refers to the small processor inspected at the start of the spike;
the intended column also includes the parent's explicit policy corrections.

| Scenario                                                    | Local baseline                                                                            | Pinned upstream                                      | Intended fixed-deadline policy                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Creation age exactly 7 days                                 | Skip                                                                                      | Skip                                                 | Skip; eligibility is strictly greater                             |
| Old unlabelled PR, recent comment/push                      | Warn, then label                                                                          | Warn, then label                                     | Same shared behavior                                              |
| Draft or `keep-open` label                                  | Exempt                                                                                    | Exempt when configured                               | Exempt, including current rechecks                                |
| Draft exemption disabled                                    | Process                                                                                   | Process                                              | Preserve configurable behavior                                    |
| Same-repository excluded/default head                       | Exempt whole PR                                                                           | No equivalent branch exemption                       | Preserve local exemption                                          |
| Same-named fork head                                        | Process PR, never delete fork branch                                                      | Process PR                                           | Preserve distinction between local and fork heads                 |
| Warning/label younger than 7 days                           | Wait                                                                                      | Wait in ordinary undisturbed case                    | Wait until computed deadline                                      |
| Undisturbed warning/label older than 7 days                 | Close                                                                                     | Close                                                | Shared closure case                                               |
| Exactly at closure deadline                                 | Close                                                                                     | Wait if `updated_at` is exactly 7 days old           | Inclusive `now >= deadline`                                       |
| Recent human comment after warning                          | Close when deadline reached                                                               | Wait, even with stale removal disabled               | Close; comment cannot extend deadline                             |
| Human comment after label, then over 7 days of inactivity   | Close                                                                                     | Still wait while that comment is returned            | Close; distinguishes comment gate from update gate                |
| Recent push/unrelated label update                          | Close when deadline reached                                                               | Wait on recent `updated_at`                          | Close; activity does not extend deadline                          |
| Stale label manually applied, no trusted warning            | Fresh warning                                                                             | Can close after inactivity                           | Fresh full warning period                                         |
| Label present, label event missing                          | Fresh warning                                                                             | Falls back to `updated_at`; can close                | Fresh warning, never infer warning delivery                       |
| Upstream warning text/label migrated locally                | Fresh local marked warning                                                                | Treats label as stale; no delivered-warning proof    | Fresh full local period; no automatic migration trust             |
| Reopened, ready-for-review, exemption removed after warning | Fresh warning                                                                             | No explicit reset; can close after inactivity        | Fresh full warning period                                         |
| Stale label removed then reapplied after warning            | May reuse old warning                                                                     | No delivered-warning/reset contract                  | Fresh warning for stale-label removal                             |
| Warning and reset in same second                            | Fresh warning for recognized reset                                                        | No warning/reset ordering contract                   | Conservative fresh warning; reset wins ties                       |
| Warning comment request fails                               | No label attempt; failed run                                                              | Logs error, still attempts stale label               | Preserve delivery-before-label dependency                         |
| Warning succeeds, label request fails                       | Failed run; another warning on retry                                                      | Logs error; another warning when unlabelled          | Retry label using unexpired warning; new label starts full period |
| Comment evidence read fails                                 | Failed item, no closure                                                                   | Logs error, returns empty comments; can close        | Fail closed for incomplete safety evidence                        |
| Exemption added between snapshot and closure                | Fresh reads prevent closure                                                               | Uses listed issue; no final PR/exemption reread      | Final PR read after fresh evidence collection                     |
| Reset/new warning/deletion during inspection                | Baseline evidence not refreshed                                                           | No final evidence refresh                            | Refresh events/comments and PR before closure; API race remains   |
| Evidence spans pages                                        | Paginate all events/comments                                                              | Paginate events; comment gate reads one default page | Retain complete local evidence collection                         |
| Preview warning/closure/evidence failure                    | No mutation attempts                                                                      | Processor skips mutation calls                       | Preserve mutation-free preview throughout failures                |
| Warning trust/spoofing                                      | Repository bot marker trusted; foreign privileged authors skipped; outsider spoof ignored | No corresponding marker-author contract              | Preserve `GITHUB_TOKEN` trust boundary                            |
| Relevant malformed/future timestamps                        | Incomplete validation                                                                     | No fixed-deadline evidence validation                | Conservative skip for invalid evidence                            |
| Warning-period input changed mid-period                     | Current input applies                                                                     | Current input applies to inactivity window           | Current input applies; reducing it can advance closure            |

The executable differential fixtures cover the shared pipeline and intentional
differences through preview, plus real upstream budget/state behavior. The last
local contract corrections (stale-label removal, retry reuse, timestamp
validation, final evidence refresh and detailed author/order cases) belong to the
parent's pure-policy/processor regression tests. This document does not claim
that every matrix row is an upstream differential test.

## Practical fork touchpoints and maintenance assessment

| Touchpoint                                                     | Required change for A                                                                                                                                 | Cost avoided by B                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `processIssue`, `Issue`, exemption helpers                     | Obtain current PR/repository data; introduce local branch exclusions and approved input defaults                                                      | Reuse existing eligibility and branch helpers                  |
| `_processStaleIssue`, `_hasCommentsSince`, `listIssueComments` | Replace inactivity gates with trusted-warning/label deadline; paginate full warning evidence; fail safely on read errors                              | One pure policy plus existing evidence loader                  |
| `getLabelCreationDate`                                         | Stop falling back to update time for missing evidence; collect reset events; handle stale-label removal and timestamp ambiguity                       | Explicit evidence contract                                     |
| `_markStale`                                                   | Return notification success; stop labeling on failure; support warning-success/label-failure retry                                                    | Dependent mutation execution                                   |
| `_closeIssue`, PR reads                                        | Refresh state/exemptions and warning/reset evidence; use inclusive deadline; propagate closure failure and distinguish intended vs successful results | Existing PR mutation path and targeted rechecks                |
| `_deleteBranch`                                                | Disable entirely; retain separate guarded local deletion, including immediate post-close safety checks                                                | No duplication of SHA/protection/head/base/exclusion guards    |
| Error handling and entrypoint                                  | Preserve per-item failed-run reporting and independent branch phase; upstream helpers often log and continue                                          | Existing runner phase isolation                                |
| Options, operations, state and tests                           | Add policy/evidence configuration; validate existing public inputs; account for all safety calls/pages/retries; revisit cached processed-ID semantics | Small public contract; defer state until scale evidence exists |

There is no documented policy injection API in this release. Although
`processIssue` is callable, key closure/mutation methods are TypeScript-private
implementation details. Subclassing or manipulating emitted private methods
would bind us to those internals. A wrapper that reimplements safety/evidence
outside upstream and then bypasses its closure path retains both processors'
maintenance burdens.

A fork would also retain upstream's mixed issue/PR listing and features outside
this project's scope. On each upstream update we would need to review overlapping
processor logic, inputs/defaults, REST/client changes, error paths, pagination,
state/cache behavior and generated output, then rerun both fork contract tests
and upstream tests. The spike identifies at least eight interacting work areas;
it does not provide an invented patch-line estimate or claim an upstream
contribution has been accepted. Reconsider A only if upstream offers a supported
fixed-deadline evidence policy that materially removes this custom work.

## Operations, resumption, permissions and state

The real upstream budget is checked between items. The mocked warning case with
`operationsPerRun=2` consumes **5** logical operations: issue page, warning
comment, label, event fetch and comment fetch. Pagination is counted as a single
logical operation, regardless of event-page count; Octokit retries also are not
separate processor operations. Therefore this is a traversal budget, not a hard
HTTP-call or GitHub rate-limit guarantee.

The real `State` class stores processed numeric issue IDs, skips them on resumed
scans and resets only when the scan reaches the end. The test demonstrates that
an ID processed in one run can be skipped on the next even when it is now due to
close. That can delay a deadline until a later completed sweep. Neither
architecture promises an exact-time timer: closure happens on a subsequent
scheduled run. Preview suppresses `State.persist`, but upstream's full entrypoint
still restores state through its cache adapter.

For B, defer new budgeting inputs/cache storage until repository scale or run
telemetry justifies them. If needed, count actual paginated/retried requests and
reserve enough capacity to complete dependent warning/label operations and all
final safety reads. Do not spend the last available call on closure and omit its
guards. Independently account for the branch phase: repository metadata, branch
and PR enumeration, history/activity evidence, open head/base pagination, repeated
SHA/protection checks and deletion. A PR-phase stop or failure must leave capacity
and runner control flow for independently guarded branch cleanup. Persisted
progress must not stand in for warning evidence or suppress required rereads;
use deterministic traversal/fairness and explicit incomplete-run reporting if a
budget is added. No hard operation limit is implemented by this research work.

Upstream's cache adapter lists and deletes Actions caches by the fixed `_state`
key, then saves/restores a state directory with `@actions/cache`. Its README
recommends `actions: write`, as well as issue/PR write permissions and contents
write for optional deletion. Adopting it would introduce cache service access,
eviction/recovery and shared-key/concurrent-run considerations absent from B.
Keep existing permissions and `GITHUB_TOKEN`; there is no reason to add cache
permissions or broaden PAT support for this alignment. The harness tests real
in-memory `State`, **not** hosted cache behavior or permission enforcement.

Compatible input mappings are `pr-stale-days` → `days-before-pr-stale`,
`pr-warning-days` → `days-before-pr-close` (duration only; deadline semantics
differ), `stale-label` → `stale-pr-label`, `exempt-label` → `exempt-pr-labels`,
`exempt-drafts` → `exempt-draft-pr`, and `dry-run` → `debug-only`. Upstream defaults
include mutation mode, different staleness duration and drafts not exempt, so
these mappings do not authorize replacing local defaults. `excluded-branches`
and guarded repository-wide branch cleanup have no equivalent upstream input.

The fetched upstream license is MIT. A redistributed fork or substantial copied
source must retain its actual copyright/permission notice and applicable bundled
dependency notices; do not invent an attribution notice from the repository
owner's name. B adds no vendored upstream source, and the research runner leaves
upstream's own license in the temporary checkout. No upstream dependency is added
to the production manifest or bundle. The alignment implementation rebuilds our
own production bundle; the research harness is not part of that bundle.

## Executable comparison and observed results

Run from the repository root with Node.js 24+, Git, npm and network access:

```sh
node scripts/check-upstream.cjs
```

The runner clones the tag into a directory under `os.tmpdir()` (on macOS normally
under `/var/folders`, not necessarily `/tmp`), verifies its immutable commit, runs
`npm ci --ignore-scripts --no-audit --no-fund` there, and compiles the unmodified
sources with `tsc --project tsconfig.app.json --outDir <temporary-lib>`. It invokes
Node's test runner with `--experimental-vm-modules`. `vm.SourceTextModule` executes
the compiled real `IssuesProcessor` and `State`; their methods are not replaced,
subclassed or reproduced. Only GitHub transport, core logging and wall-clock time
are mocked. Other imported dependencies come from the pinned installation.
The local side invokes the current `src/close-stale-prs.cjs` with matching fixtures,
so it continues testing the parent-owned policy extraction after integration.

The default runner cleans its source/build/dependencies on success or failure.
No production dependencies, GitHub API writes, releases or checkout-history
changes are involved. It makes read-only GitHub source/npm registry requests;
install lifecycle scripts are disabled. The first observed installation added
732 upstream packages, including development tools; this is acceptable for a
separate comparison job, not for every fast local unit-test run. Git/npm/compiler/
test subprocesses each have a four-minute timeout. This is not a bundled
upstream-action execution: the full entrypoint, cache adapter, hosted permissions,
rate limits and GitHub consistency/races remain outside this mocked comparison.

An existing pristine temporary checkout can avoid cloning on repeat runs, but its
`node_modules` is replaced via `npm ci` on every invocation. Use this option only
with a trusted local temporary checkout, never an arbitrary user's working copy.
Source/manifest/config changes (tracked or untracked) are rejected. Compiler output
is still rebuilt in a separate temporary directory:

```sh
node scripts/check-upstream.cjs --upstream /tmp/stale-upstream-spike.kIzZ4G/upstream
```

Observed on Node **v24.21.0**:

- `git clone --quiet --depth 1 --branch v11.0.0 https://github.com/actions/stale.git /tmp/stale-upstream-spike.kIzZ4G/upstream`:
  resolved to the pinned commit above.
- `npm ci --ignore-scripts --no-audit --no-fund` in that temporary source: exit 0,
  732 packages installed. npm emitted deprecation notices from upstream's lockfile.
- `./node_modules/.bin/tsc --project tsconfig.app.json` in the temporary source:
  exit 0.
- `node scripts/check-upstream.cjs`: exit 0; **33 tests, 33 passed, 0 failed**.
  This exercised the fresh-download/install/build path as well as the real
  processor. Node emitted the expected experimental VM-modules notice.
- `node scripts/check-upstream.cjs --upstream /tmp/stale-upstream-spike.kIzZ4G/upstream`:
  exit 0; **33 tests, 33 passed, 0 failed** on the final repeat; no upstream
  tracked source changed.
- `node_modules/.bin/prettier --check docs/PR_ALIGNMENT_DECISION.md 'scripts/**/*.cjs'`:
  exit 0; all research files match repository formatting.

The separate command is wired into `package.json` without adding production
dependencies:

```json
"test:upstream": "node scripts/check-upstream.cjs"
```

Run `npm run test:upstream` explicitly in a network-enabled validation job. Keep
the fast existing unit suite separate. Include these files in formatting using
`prettier --check docs/PR_ALIGNMENT_DECISION.md 'scripts/**/*.cjs'`.

The integrated processor passed all 224 local tests before Opus review round 1,
including the seven regression expectations written before production wiring.
Branch guards, formatting, bundle reproducibility, bundled-entrypoint smoke,
workflow lint and audit also passed. Current results and iterative-review
corrections are recorded in [PR_ALIGNMENT_REVIEW.md](PR_ALIGNMENT_REVIEW.md), which
supersedes these initial spike observations for release readiness. Hosted CI and
real preview remain separately gated. No disposable-repository writes were run.
