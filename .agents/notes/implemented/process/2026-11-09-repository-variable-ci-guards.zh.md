# Agent Note: 针对不可用 CI 资源的仓库变量守卫

Status: implemented

[English](2026-11-09-repository-variable-ci-guards.md) | 中文

## 问题

缺少内部自托管池、命名机群运行器池、`DEEPSEEK_API_KEY_EXTERNAL` 密钥，或上游 GitHub App、Cloudflare 凭据和仓库身份的仓库副本，仍会运行相同的工作流。选择这些运行器池的作业会等待运行器 24 小时后失败。到达真实 API 密钥预检的作业按设计失败。议题和预览工作流因缺少上游凭据或写死的上游仓库而失败。master 和 PR CI 因此持续为红色，而原因与被验证的提交无关。

## 决策

两个仓库变量用于让作业选择加入；变量未设置时，GitHub 将作业报告为已跳过。

- `vars.DSH_SELF_HOSTED == 'true'` 以 AND 方式并入 `runs-on` 回退到自托管池或命名机群池的作业的 `if:`：[CI master](../../../../.github/workflows/ci-master.yml) 的热备演练 `serial-linux-selfhosted` 和 `serial-windows`，手动 `larger-runner-benchmark` 和 `consolidated-runner-benchmark` 套件，以及 [CI](../../../../.github/workflows/ci.yml) 中的 `node-24`、`node-24-coverage`、`node-24-consumers`、`windows-build`、`windows-coverage`、`windows-native-tests` 和 `windows-observational` 作业。
- `vars.DSH_REAL_API == 'true'` 以 AND 方式并入 CI master 和 CI 中的 `python-runtime` 调用方作业，以及[真实 API e2e](../../../../.github/workflows/e2e.yml) 的 `e2e` 作业。

每个 `python-runtime` 守卫都位于调用方作业，因此[可复用 Python 运行时构建器](../../../../.github/workflows/build-exe-for-python-sdk.yml)及其发布调用方保持不变。CI 中运行的每个构建器目标都会到达真实 API 预检，因此不存在能保留可运行目标的更窄守卫。构建器步骤 `Preflight installed-wheel real API test (POSIX)`、其 Windows 对应步骤和 e2e 步骤 `Preflight (require DEEPSEEK_API_KEY)` 保持不变：在没有密钥的情况下运行的作业仍会失败。启用某条通道需要将其变量设为 `true`；真实 API 通道还需要 `DEEPSEEK_API_KEY_EXTERNAL` 密钥。

CI 的 `all-checks-passed` 判定保留 `${{ !cancelled() && github.event_name == 'pull_request' }}`，并在 `contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')` 时失败。被跳过的依赖可以通过判定，因为守卫把不可用的通道报告为已跳过。

[预览](../../../../.github/workflows/build-preview-cloudflare.yml)、[议题生命周期](../../../../.github/workflows/issue-lifecycle.yml)和[议题策略](../../../../.github/workflows/issue-policy.yml)作业带有 `github.repository == 'deepseek-harness/deepseek-harness'`，并以 AND 方式与已有条件组合。该仓库名是议题策略传给其 GitHub App 令牌的所有者和仓库；另外两个工作流没有写明仓库。

## 曾考虑的替代方案

**移除或放宽密钥预检。** 无密钥运行会把全部跳过的 e2e 套件报告为绿色，这正是[真实 API e2e 决策](../testing/2026-06-19-real-api-e2e-ci.zh.md)要防止的虚假绿色。

**在仓库设置中禁用整个工作流。** 禁用 CI master 也会丢掉托管的 Wine 作业，禁用 CI 会丢掉托管的兼容性和无密钥 SDK 作业，而且该设置在仓库历史中不可见。

**在可复用构建器内部加守卫。** 发布调用方需要已安装 wheel 的真实 API 测试；在构建器内加守卫会改变每个调用方的发布行为。

**变量未设置时把机群作业改到标准托管运行器。** 16 核规格是这些通道超时预算的一部分；标准运行器会用超时和第二套运行器策略换掉已跳过的作业。

**让聚合在依赖被跳过时继续失败。** 在缺少这些资源的仓库中，每条被守卫的通道都会使必需判定失败，而这正是本决策要消除的红色状态。

## 后果

变量未设置时，热备演练、手动基准测试、两个 Python 运行时载体、真实 API e2e，以及按机群规格运行的静态、覆盖率、快照和原生 Windows PR 作业都会被跳过。此类仓库中的 PR 只由托管作业验证：`node-24-bench`、`node-compat` 矩阵和 `python-sdk`。被跳过的作业不是证据：绿色判定并不覆盖被跳过的通道。拥有这些资源的仓库必须设置两个变量才能保持原有覆盖。

“跳过即通过”的判定也会放行因其他原因被跳过的依赖。这部分取代了[取消决策](2026-09-09-cancel-superseded-ci.zh.md)中的跳过条款；其取消策略保持不变。

## 验证

[工作流回归测试](../../../../scripts/ci-workflow.spec.ts)和[平台路由回归测试](../../../../scripts/tests/ci-master-platforms.spec.ts)固定被守卫的精确条件和判定的失败条件。这些配置检查不会复现 GitHub 的作业跳过行为；已跳过作业的证据来自实际的 CI、CI master 和 e2e 运行。
