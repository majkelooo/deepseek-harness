# Agent Note: Repository-variable guards for unavailable CI resources

Status: implemented

English | [中文](2026-11-09-repository-variable-ci-guards.zh.md)

## Problem

A repository copy that lacks the in-house self-hosted pools, the named fleet runner pools, the `DEEPSEEK_API_KEY_EXTERNAL` secret, or the upstream GitHub App, Cloudflare credentials, and repository identity still runs the same workflows. Jobs that select those pools wait 24 hours for a runner and then fail. Jobs that reach a real-API key preflight fail by design. Issue and preview workflows fail on missing upstream credentials or a hard-coded upstream repository. Master and pull-request CI then stay red for reasons unrelated to the commit under validation.

## Decision

Two repository variables opt jobs in; when a variable is unset, GitHub reports the job as skipped.

- `vars.DSH_SELF_HOSTED == 'true'` is AND-combined into the `if:` of jobs whose `runs-on` falls back to the self-hosted or named fleet pools: the [CI master](../../../../.github/workflows/ci-master.yml) standby drills `serial-linux-selfhosted` and `serial-windows`, the manual `larger-runner-benchmark` and `consolidated-runner-benchmark` suites, and the [CI](../../../../.github/workflows/ci.yml) jobs `node-24`, `node-24-coverage`, `node-24-consumers`, `windows-build`, `windows-coverage`, `windows-native-tests`, and `windows-observational`.
- `vars.DSH_REAL_API == 'true'` is AND-combined into the `python-runtime` caller job in CI master and in CI, and into the [real-API e2e](../../../../.github/workflows/e2e.yml) `e2e` job.

Each `python-runtime` guard is on the caller job, so the [reusable Python runtime builder](../../../../.github/workflows/build-exe-for-python-sdk.yml) and its release callers are unchanged. Every builder target that runs in CI reaches the real-API preflight, so no narrower guard keeps a runnable target. The builder step `Preflight installed-wheel real API test (POSIX)`, its Windows counterpart, and the e2e step `Preflight (require DEEPSEEK_API_KEY)` are unchanged: a job that runs without the secret still fails. Enabling a lane requires setting its variable to `true`; real-API lanes also require the `DEEPSEEK_API_KEY_EXTERNAL` secret.

The CI `all-checks-passed` verdict keeps `${{ !cancelled() && github.event_name == 'pull_request' }}` and fails when `contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')`. A skipped need passes the verdict, because the guards report unavailable lanes as skipped.

The [preview](../../../../.github/workflows/build-preview-cloudflare.yml), [issue lifecycle](../../../../.github/workflows/issue-lifecycle.yml), and [issue policy](../../../../.github/workflows/issue-policy.yml) jobs carry `github.repository == 'deepseek-harness/deepseek-harness'`, AND-combined with any existing condition. The repository name is the owner and repository that issue policy passes to its GitHub App token; the other two workflows name none.

## Alternatives considered

**Remove or soften the key preflights.** Keyless runs would then report an all-skipped e2e suite as green, the false green that the [real-API e2e decision](../testing/2026-06-19-real-api-e2e-ci.md) exists to prevent.

**Disable whole workflows in repository settings.** Disabling CI master also drops the hosted Wine job, disabling CI drops the hosted compatibility and keyless SDK jobs, and the setting is invisible in the repository history.

**Guard inside the reusable builder.** Release callers require the installed-wheel real-API test; a guard there would change release behavior for every caller.

**Retarget fleet jobs to standard hosted runners when the variable is unset.** The 16-core sizing is part of those lanes' timeout budgets; standard runners would trade a skipped job for timeouts and a second runner policy.

**Keep the aggregate failing on skipped needs.** Every guarded lane would then fail the required verdict in a repository without the resources, which is the red state this decision removes.

## Consequences

With the variables unset, the standby drills, the manual benchmarks, both Python runtime carriers, real-API e2e, and the fleet-sized static, coverage, snapshot, and native Windows PR jobs are skipped. A pull request in such a repository is validated only by the hosted jobs: `node-24-bench`, the `node-compat` matrix, and `python-sdk`. A skipped job is not evidence: a green verdict does not cover skipped lanes. A repository that has the resources must set both variables to keep its previous coverage.

The skipped-is-passing verdict also passes needs skipped for any other reason. This partly supersedes the skip clause in the [cancellation decision](2026-09-09-cancel-superseded-ci.md); its cancellation policy is unchanged.

## Verification

[Workflow regressions](../../../../scripts/ci-workflow.spec.ts) and [platform routing regressions](../../../../scripts/tests/ci-master-platforms.spec.ts) pin the exact guarded conditions and the verdict's failure condition. These configuration checks do not reproduce GitHub job skipping; skipped-job evidence comes from live CI, CI master, and e2e runs.
