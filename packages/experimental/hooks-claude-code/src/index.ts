/**
 * Bridge for unmodified Claude Code command hooks on harness interception
 * extension points. It supports SessionStart, prompt/tool pre/post (including
 * PostToolUseFailure), Stop, subagent start/stop, and the compact boundaries.
 * It owns Claude payloads, environment, substitution, and decision
 * mapping; shared execution and parsing live in `dsh-hook-protocol`.
 * `updatedInput` is logged and warned but not honored. Bespoke behavior should
 * use typed native plugins on the same extension points.
 * @module @deepseek-ai/dsh-hooks-claude-code
 */

import type {} from '@deepseek-ai/dsh-working-directory'
// Pulls in the declaration-merged compaction session events the compact hooks observe.
import type {} from '@deepseek-ai/dsh-compaction'
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'hooks-claude-code': { kind: 'hooks-claude-code' } & ContextFormed
  }
}

import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH, type PostToolDecision, type PreToolDecision, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  appendHookInvoked,
  appendHookResult,
  createDetachedRuns,
  DEFAULT_HOOK_TIMEOUT_MS,
  DEFAULT_STDERR_SUMMARY_MAX_CHARS,
  HOOK_BLOCKED,
  HOOK_DENIED,
  HOOK_ERROR_NAME,
  mergeHookOutputs,
  runHook,
  selectHookGroups,
  type HookOutput,
  type MergedHookOutcome,
} from '@deepseek-ai/dsh-hook-protocol'
// Pulls in the declaration-merged subagent events and the identity pairing their
// start/end edges.
import type { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { parseClaudeCodeConfig, type ClaudeCodeHookConfig } from './config.ts'

export const name = 'hooks-claude-code'
// `shell` runs hooks and `agents` supplies turn numbers; the rest
// are read opportunistically via ctx.get so a deployment can omit them.
export const inject = ['shell', 'agents', 'workingDirectory']

/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's current directory (the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}

export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  pluginRoot: z.string(),
  projectDir: z.string(),
  defaultTimeoutMs: z.number().default(DEFAULT_HOOK_TIMEOUT_MS),
  stderrSummaryMaxChars: z.number().default(DEFAULT_STDERR_SUMMARY_MAX_CHARS),
})

/** A stable per-handler id so an invoked/result pair correlates in the log. */
let handlerCounter = 0
function nextHandlerId(point: string): string {
  return `claude-code:${point}:${++handlerCounter}`
}

/** The `{kind:'hooks-claude-code'}` producer source stamped on every context this bridge injects. */
const CONTEXT_SOURCE: MessageSource = { kind: 'hooks-claude-code' }

/** The summary cap bounds a persisted event field — a positive integer or the slice misbehaves silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`hooks-claude-code: ${name} must be a positive integer`)
  }
}

export function apply(ctx: Context, config: Config): void {
  // Validate before config parsing so a bad value cannot be hidden by its early return.
  const stderrSummaryMaxChars = config.stderrSummaryMaxChars ?? DEFAULT_STDERR_SUMMARY_MAX_CHARS
  assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars)
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS
  // Parse once at load. A read or parse failure logs and registers nothing.
  let parsed: ClaudeCodeHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    const result = parseClaudeCodeConfig(raw, {
      ...config.pluginRoot !== undefined ? { pluginRoot: config.pluginRoot } : {},
      ...config.projectDir !== undefined ? { projectDir: config.projectDir } : {},
    })
    parsed = result.config
    for (const s of result.skipped) {
      ctx.logger.warn(`hooks-claude-code: skipping unsupported "${s.type}" hook on ${s.event} (only command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-claude-code: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  // Emit-shaped points run detached, so track their chains; disposal aborts
  // active hooks and drains continuations before resolving.
  const detached = createDetachedRuns()
  // Only the start edge guarantees registry access. Retain each local child
  // through its paired end so stop hooks keep the session workspace after the
  // handle unregisters the agent. Every retained entry relies on that paired
  // end; a producer that can omit it must provide another release edge.
  const subagentChildren = new Map<SubagentRunId, Agent>()
  ctx.effect(() => () => detached.drain(), 'hooks-claude-code: drain detached hook runs')

  /**
   * Run every command hook configured for `point` whose matcher selects
   * `matchQuery`, with the per-event `payload` on stdin, and fold the results.
   * Writes a `hook/invoked`/`hook/result` pair per hook when `opts.turn` names
   * an open turn. Detached lifecycle points omit the pair. Returns the merged outcome (a neutral,
   * already-most-restrictive view) for the caller to map onto its extension point
   * decision. `matchQuery` is the event's matcher subject (tool name, session
   * source, …); `''` for events that ignore matchers.
   */
  async function runPoint(
    point: string,
    matchQuery: string,
    payload: Record<string, unknown>,
    opts: { agent?: Agent; turn?: number; directory?: 'committed'; readonly signal: AbortSignal },
  ): Promise<MergedHookOutcome> {
    const groups = selectHookGroups(parsed[point], matchQuery, 'claude-code')
    if (groups.length === 0) return mergeHookOutputs([])
    const outputs: HookOutput[] = []
    const workdir = opts.agent === undefined ? undefined
      : opts.directory === 'committed' ? ctx.workingDirectory.get(opts.agent.session)
        : await ctx.workingDirectory.ensure(opts.agent, opts.signal)
    // CLAUDE_PROJECT_DIR: an explicit config value wins; otherwise default it to the session
    // workspace (the same dir the hook runs in).
    const projectDir = config.projectDir ?? workdir
    const hookEnv = projectDir !== undefined ? { CLAUDE_PROJECT_DIR: projectDir } : undefined
    for (const group of groups) {
      for (const hook of group.hooks) {
        const handlerId = nextHandlerId(point)
        const session = opts.agent?.session
        if (session && opts.turn !== undefined) {
          appendHookInvoked(session, {
            turn: opts.turn, point, dialect: 'claude-code', handlerId,
            matcher: group.matcher,
          })
        }
        const { output, durationMs } = await runHook(ctx.shell, hook, {
          payload: { ...payload, cwd: workdir ?? process.cwd() },
          defaultTimeoutMs,
          ...hookEnv ? { env: hookEnv } : {},
          ...workdir !== undefined ? { cwd: workdir } : {},
          signal: opts.signal,
          trailingNewline: true,
          // Discard a `hookSpecificOutput` block whose `hookEventName` names a
          // different event than the one firing (the schemas key it by event).
          expectedEventName: point,
        }, () => performance.now())
        outputs.push(output)
        if (output.updatedInput !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook requested updatedInput, which is not yet honored (ignored)`)
        }
        if (output.systemMessage !== undefined) {
          ctx.logger.warn(`hooks-claude-code: ${point} hook emitted a systemMessage; no operator surface exists yet, so it is only recorded on hook/result`)
        }
        if (session && opts.turn !== undefined) {
          appendHookResult(session, { turn: opts.turn, point, handlerId, output, stderrSummaryMaxChars, durationMs })
        }
      }
    }
    return mergeHookOutputs(outputs)
  }

  // TODO(hook-continue-false): `merged.stop` is logged but needs a run-level halt mechanism.

  /** Build additional model context from hook output, or return undefined when empty. */
  function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
    if (merged.additionalContext.length === 0) return undefined
    const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
    return createUserMessage({ content, source: CONTEXT_SOURCE })
  }

  /** Prepend one context without flattening source fields or other downstream metadata. */
  function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
    return [ours, ...theirs ?? []]
  }

  ctx.on('agent/created', async ({ agent, source, signal }) => {
    const ownerSignal = signal === undefined ? detached.signal : AbortSignal.any([signal, detached.signal])
    const run = runPoint('SessionStart', source, sessionStartPayload(agent, source), { agent, signal: ownerSignal })
      .then((merged) => {
        const context = contextFrom(merged)
        if (context) agent.inject(context)
      })
      .catch((error: unknown) => {
        ctx.logger.warn(`hooks-claude-code: SessionStart hook failed: ${String(error)}`)
      })
    detached.track(run)
    await run
  })

  // --- UserPromptSubmit → PreStepDecision. The prompt text is the payload; no
  // matcher subject (CC ignores matchers for this event). ---
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    // Claude Code runs UserPromptSubmit for operator input only. The pre-step queue
    // also carries machine-fed messages (instruction reminders, injected context,
    // tool results); handing those to prompt hooks let a spliced system-reminder
    // classify machine text as a new prompt and inject a second, misrouted context
    // pack inside one turn (measured 2026-11-14 on a CBC bridge deployment).
    const operatorMessages = messages.filter(isOperatorInput)
    if (operatorMessages.length === 0) return next()
    const content = operatorMessages.flatMap(message => message.content)
    const merged = await runPoint('UserPromptSubmit', '', promptPayload(agent, content), { agent, turn, signal })
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Delegate so later listeners may still rewrite or reject, then prepend our
    // context only to a downstream enter decision.
    const downstream = await next()
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      ...downstream,
      messages: [...downstream.messages, ours],
    }
  })

  // --- PreToolUse → PreToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const turn = lastTurn(ctx, exec.agent)
    const merged = await runPoint('PreToolUse', ccToolName(exec.name), preToolPayload(exec), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook', info: { name: HOOK_ERROR_NAME, code: HOOK_DENIED } }
    if (merged.decision === 'ask') return { kind: 'ask', ...merged.reason !== undefined ? { reason: merged.reason } : {} }
    return next()
  })

  // --- PostToolUse → PostToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const turn = lastTurn(ctx, exec.agent)
    const failure = ccFailureView(result)
    if (failure !== undefined) {
      // Claude Code runs PostToolUse for successful calls only; a failed call
      // reaches PostToolUseFailure instead, and failures a hook never sees
      // (cancellation before dispatch, this bridge's own PreToolUse deny, an
      // approval denial) fire no event at all.
      if (!failure.fires) return next()
      const merged = await runPoint('PostToolUseFailure', ccToolName(exec.name), failurePayload(exec, failure), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
      if (merged.decision === 'deny') {
        ctx.logger.warn('hooks-claude-code: PostToolUseFailure hook deny is not honored (the call already failed; Claude Code offers additionalContext on this event only)')
      }
      const context = contextFrom(merged)
      const downstream = await next()
      if (!context) return downstream
      return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
    }
    const merged = await runPoint('PostToolUse', ccToolName(exec.name), postToolPayload(exec, result), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    const context = contextFrom(merged)
    if (merged.decision === 'deny') {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }],
        info: { name: HOOK_ERROR_NAME, code: HOOK_BLOCKED },
        ...context ? { additionalContexts: [context] } : {},
      }
    }
    // Our hooks did not block. DELEGATE so a later listener can still block/replace,
    // then fold our context onto its decision (a downstream block carries it too).
    const downstream = await next()
    if (!context) return downstream
    if (downstream.kind === 'block') {
      return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(context, downstream.additionalContexts),
    }
  })

  // A blocking Stop hook steers at the stopping boundary, which makes the
  // machine observe pending input and run another step.
  // TODO(stop-loop-guard): cap consecutive forced continuations; hooks must self-limit meanwhile.
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    const merged = await runPoint('Stop', '', stopPayload(agent), { agent, turn, signal })
    if (merged.decision === 'deny') {
      // A blocking Stop hook forces continuation.
      const text = merged.reason ?? 'continue: blocked by Stop hook'
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: CONTEXT_SOURCE }))
    }
  })

  // Compact hooks run detached off the post-commit session/event feed. By the
  // time `compaction/start` publishes, the compaction transaction has already
  // opened, so a PreCompact deny cannot block it (recorded as a limitation in
  // this package's README). Claude Code offers hooks no other control on these
  // events, so only the side effects and the hook/invoked pair remain.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'compaction/start') {
      const trigger = compactTrigger(event.data.turn)
      const agent = ctx.get('agents')?.get(session.header.id)
      detached.track(runPoint('PreCompact', trigger, preCompactPayload(session, trigger), {
        ...agent !== undefined ? { agent } : {},
        ...event.data.turn !== null ? { turn: event.data.turn } : {},
        signal: detached.signal,
      })
        .then(merged => warnIgnoredCompactControls('PreCompact', merged, ctx))
        .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: PreCompact hook failed: ${String(error)}`) }))
    } else if (event.type === 'compaction/end' && event.data.error === undefined) {
      const trigger = compactTrigger(event.data.turn)
      const summary = compactSummaryText(session, event.data.compactionId)
      const agent = ctx.get('agents')?.get(session.header.id)
      detached.track(runPoint('PostCompact', trigger, postCompactPayload(session, trigger, summary), {
        ...agent !== undefined ? { agent } : {},
        ...event.data.turn !== null ? { turn: event.data.turn } : {},
        signal: detached.signal,
      })
        .then(merged => warnIgnoredCompactControls('PostCompact', merged, ctx))
        .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: PostCompact hook failed: ${String(error)}`) }))
    }
  })

  // SubagentStart may inject child context; SubagentStop only observes. Both
  // use the child's directory and the generic agent-type matcher subject.
  ctx.on('subagent/start', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    if (child !== undefined) subagentChildren.set(info.runId, child)
    detached.track(runPoint('SubagentStart', SUBAGENT_TYPE, subagentPayload('SubagentStart', info, child), { ...child ? { agent: child } : {}, signal: detached.signal })
      .then((merged) => {
        const context = contextFrom(merged)
        if (context && child) child.inject(context)
      })
      .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: SubagentStart hook failed: ${String(error)}`) }))
  })
  ctx.on('subagent/end', (info) => {
    const child = subagentChildren.get(info.runId) ?? ctx.get('agents')?.get(info.id)
    subagentChildren.delete(info.runId)
    // The end edge follows child disposal; committed Session state remains readable.
    detached.track(runPoint('SubagentStop', SUBAGENT_TYPE, subagentPayload('SubagentStop', info, child), { ...child ? { agent: child, directory: 'committed' } : {}, signal: detached.signal })
      .catch((error: unknown) => { ctx.logger.warn(`hooks-claude-code: SubagentStop hook failed: ${String(error)}`) }))
  })
}

/**
 * The `agent_type` value the bridge reports for SubagentStart/Stop. The harness
 * subagent seam carries no per-kind label, so the bridge uses Claude Code's own
 * Task-tool default — a hooks.json with a default/`*`/empty `agent_type` matcher
 * fires; a config matching a specific kind (e.g. `code-reviewer`) does not.
 */
const SUBAGENT_TYPE = 'general-purpose'

// --- Per-event stdin payloads (the CC DIALECT shape). Field names match CC's
// hook input schema; this is the part a bridge owns. ---

/** The last open turn number in the agent's log, or 0 without an agent. */
function lastTurn(ctx: Context, agent: Agent | undefined): number {
  if (!agent) return 0
  return ctx.agents.turnBoundaryOf(agent.session).lastTurn
}

/** Flatten content blocks to the text a hook payload carries (the common case). */
function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}

/** Operator-authored input — the only subject Claude Code's UserPromptSubmit covers. */
function isOperatorInput(message: UserMessage): boolean {
  return message.source.kind === 'user'
}

/**
 * DSH tool names are lower-case; Claude Code matchers are case-sensitive literal
 * alternations over CC tool names (`Bash`, `Read|Write|Edit`, …), and CC hooks
 * branch on `tool_name` the same way. Map each DSH tool with a Claude Code
 * counterpart to that name for both matcher selection and the payload's
 * `tool_name`, so an unmodified hooks.json selects and drives the same hooks it
 * does under Claude Code. Tools without a CC counterpart pass through
 * unchanged; both subagent tools collapse onto the one CC agent-tool name.
 */
const CC_TOOL_NAMES: Readonly<Record<string, string>> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  glob: 'Glob',
  subagent: 'Agent',
  subagent_fork: 'Agent',
  todo_write: 'TodoWrite',
  ask_user_question: 'AskUserQuestion',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
}

/** The Claude Code tool name a DSH tool reports to hooks and matchers. */
function ccToolName(name: string): string {
  return CC_TOOL_NAMES[name] ?? name
}

function base(session: Session | undefined, event: string): Record<string, unknown> {
  return {
    session_id: session?.header.id ?? '',
    // The persistence seam exposes no artifact path; the field stays empty
    // (a durable consumer gap recorded in this package's README).
    transcript_path: '',
    hook_event_name: event,
  }
}

function sessionStartPayload(agent: Agent, source: string): Record<string, unknown> {
  return { ...base(agent.session, 'SessionStart'), source }
}
function promptPayload(agent: Agent, content: ContentBlock[]): Record<string, unknown> {
  return { ...base(agent.session, 'UserPromptSubmit'), prompt: blocksToText(content) }
}
function preToolPayload(exec: ToolExecution): Record<string, unknown> {
  return { ...base(exec.agent?.session, 'PreToolUse'), tool_name: ccToolName(exec.name), tool_input: exec.arguments, tool_use_id: exec.callId }
}
function postToolPayload(exec: ToolExecution, result: ToolExecutionResult): Record<string, unknown> {
  return { ...base(exec.agent?.session, 'PostToolUse'), tool_name: ccToolName(exec.name), tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
function stopPayload(agent: Agent): Record<string, unknown> {
  return { ...base(agent.session, 'Stop'), stop_hook_active: false }
}
/**
 * Build a SubagentStart/SubagentStop payload from the CC base (the child's
 * `session_id`/`cwd` when the child agent is available) plus the subagent-hook
 * fields. `agent_type` is the CC-default {@link SUBAGENT_TYPE}; `stop_hook_active`
 * is present on SubagentStop only (the loop-guard flag, always false).
 */
function subagentPayload(event: 'SubagentStart' | 'SubagentStop', info: { id: string }, child: Agent | undefined): Record<string, unknown> {
  return {
    ...base(child?.session, event),
    agent_id: info.id,
    agent_type: SUBAGENT_TYPE,
    ...event === 'SubagentStop' ? { stop_hook_active: false } : {},
  }
}

/** The CC view of one settled call that Claude Code would report as a failure. */
interface FailureView {
  /** Claude Code's `error` string: the failed call's model-facing text. */
  readonly error: string
  /** Whether the failure reached the host as an abort rather than a tool-reported error. */
  readonly isInterrupt: boolean
  /** Whether the event fires at all; pre-execution refusals fire nothing. */
  readonly fires: boolean
}

/**
 * Translate one settled result into Claude Code's success/failure split. Claude Code
 * fires PostToolUseFailure when a started tool fails and never for a pre-execution
 * refusal: cancellation before the body dispatches, this bridge's own PreToolUse
 * deny, and an approval denial all stop the call without the hook (other DSH policy
 * denials that flow through the same pipeline, such as a sandbox guard, still fire,
 * a documented deviation). DSH additionally models a shell command's non-zero exit
 * as a successful result whose value carries `exitCode`; Claude Code reports that
 * case as `Exit code N` plus the command output, so the event follows the exit code.
 */
function ccFailureView(result: ToolExecutionResult): FailureView | undefined {
  if (result.isError) {
    const { code, name } = result.error.info ?? {}
    if (code === TOOL_ABORTED_BEFORE_DISPATCH) return undefined
    if (name === HOOK_ERROR_NAME && code === HOOK_DENIED) return undefined
    if (name === 'ApprovalError') return undefined // persisted identity, SSOT: dsh-tools error-codes.ts
    return { error: blocksToText(result.content) || result.error.message, isInterrupt: code === TOOL_ABORTED, fires: true }
  }
  const value = result.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const exitCode = (value as { exitCode?: unknown }).exitCode
  if (typeof exitCode !== 'number' || exitCode === 0) return undefined
  return { error: `Exit code ${exitCode}\n${blocksToText(result.content)}`, isInterrupt: false, fires: true }
}

function failurePayload(exec: ToolExecution, failure: FailureView): Record<string, unknown> {
  return {
    ...base(exec.agent?.session, 'PostToolUseFailure'),
    tool_name: ccToolName(exec.name),
    tool_input: exec.arguments,
    tool_use_id: exec.callId,
    error: failure.error,
    is_interrupt: failure.isInterrupt,
  }
}

/** The event payload data of a `compaction/end` session event. */
type CompactionEndData = Extract<SessionEvent, { type: 'compaction/end' }>['data']

/**
 * The CC trigger value for a compaction event. Claude Code reports `manual` for an
 * explicit compact and `auto` for pressure compaction; the harness encodes the same
 * split as the event's turn owner — `null` marks a standalone manual transaction
 * between turns, a numbered owner is strictly enclosed by an automatic compaction's
 * open turn.
 */
function compactTrigger(turn: CompactionEndData['turn']): 'manual' | 'auto' {
  return turn === null ? 'manual' : 'auto'
}

/** The summary text of one compaction transaction, from its `compaction/summary` event. */
function compactSummaryText(session: Session, compactionId: CompactionEndData['compactionId']): string {
  const log = session.snapshotEvents()
  for (let i = log.length - 1; i >= 0; i--) {
    const event: SessionEvent | undefined = log[i]
    if (event?.type === 'compaction/summary' && event.data.compactionId === compactionId) {
      return blocksToText(event.data.summary)
    }
  }
  return ''
}

function preCompactPayload(session: Session, trigger: 'manual' | 'auto'): Record<string, unknown> {
  // Claude Code passes the operator's /compact instructions here and null otherwise;
  // the harness compact seam accepts no instructions, so the field is always null.
  return { ...base(session, 'PreCompact'), trigger, custom_instructions: null }
}

function postCompactPayload(session: Session, trigger: 'manual' | 'auto', compactSummary: string): Record<string, unknown> {
  return { ...base(session, 'PostCompact'), trigger, compact_summary: compactSummary }
}

/** Warn about hook output Claude Code discards on the compact events, so the drop stays visible. */
function warnIgnoredCompactControls(point: 'PreCompact' | 'PostCompact', merged: MergedHookOutcome, ctx: Context): void {
  if (merged.decision === 'deny') {
    ctx.logger.warn(`hooks-claude-code: ${point} hook deny is not honored (Claude Code offers no decision control on this event)`)
  }
  if (merged.additionalContext.length > 0) {
    ctx.logger.warn(`hooks-claude-code: ${point} hook additionalContext is not honored (Claude Code offers no context injection on this event)`)
  }
}
