---
paths: ["**"]
cbc_roles: [owner]
---

# Karpathy Coding Principles

Behavioral guidelines to reduce common LLM coding mistakes. Adopt for any implementation task in the repository you are working in, whatever its stack. Merge with project-specific instructions as needed.

Source: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) — distilled from Andrej Karpathy's observations on LLM coding pitfalls. Imported verbatim where possible; CBC-specific clarifications added only where they prevent ambiguity.

## The diagnostic (Karpathy, March 2025)

The four principles below answer this verbatim observation:

> "The models make wrong assumptions on your behalf and just run along with them without checking. They don't manage their confusion, don't seek clarifications, don't surface inconsistencies, don't present tradeoffs, don't push back when they should. They really like to overcomplicate code and APIs, bloat abstractions, don't clean up dead code... implement a bloated construction over 1000 lines when 100 would do. They still sometimes change/remove comments and code they don't sufficiently understand as side effects, even if orthogonal to the task."

This is the load-bearing reason every section below exists. Re-read it before claiming any rule "doesn't apply."

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear and the readings differ in scope or irreversibility, stop and ask; if they differ only in method, take the one you can evidence and record the assumption.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Feed it invalid input and quote the rejection"
- "Fix the bug" → "Reproduce it, fix it, show it gone with a one-off check; it keeps a test only if rule 1 of the CBC plugin's CLAUDE.md admits one"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

Before claiming done, run your project's own quality gate — whatever `CONTRIBUTING.md`, the `Makefile` or the package manifest defines as the check — and quote its actual output, pass count and exit code included. "Should pass" is not evidence.

---

## Enforcement (which auditor catches what)

Each principle maps to an auditor you can run on demand over a diff, directly or through `cbc:push-gate`. Nothing blocks a push on their verdict: work lands on `main` without a gate. Paths in the table below are relative to the CBC plugin root, not to the repository you are working in.

| Principle | Auditor(s) | What they catch |
|---|---|---|
| 1. Think Before Coding | (no auditor — human review) | Silent assumptions, missing clarifications. Surfaced via TASK_BRIEF self-check (`rules/cbc-brief-schema.md` Pre-Emit Verification). |
| 2. Simplicity First | `cbc:kiss-auditor`, `cbc:overengineering-guard` | LOC/nesting/complexity thresholds; abstractions/config knobs/DI with < 2 consumers. |
| 3. Surgical Changes | `cbc:slop-scorer`, `cbc:overthinking-guard` | Verbose/sycophantic/dead comments, removed WHY-comments, drive-by refactor; branching against impossible states. |
| 4. Goal-Driven Execution | `cbc:task-verifier` (verification enforcement) | Failing-test-first discipline where the risk earns it, a quoted in-session check where it does not; "should pass" without quoted output in either case. |

SSOT: this table points; the auditors own their checks. Do not re-document auditor checks here — read the agent file directly.

---

## Why this rule file exists

These guidelines are working if:

- Fewer unnecessary changes appear in diffs.
- Fewer rewrites because work was overcomplicated.
- Clarifying questions come before implementation rather than after mistakes.

If you notice the opposite, the rule is being ignored — raise it to the user, don't silently continue.
