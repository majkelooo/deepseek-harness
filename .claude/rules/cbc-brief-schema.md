---
paths: ["**"]
cbc_roles: [owner]
---
# CBC Brief Schema — session card

The four decisions an OODA-loop agent may emit, and the two rules that make them parseable. The
FULL shapes — every field of every template, the Pre-Emit Verification checklist, the MT→TASK_BRIEF
translation table and the Peer Specialist Contracts — live in `rules/cbc-brief-schema.md` and are
NOT restated here.

Every path in this card that begins with `rules/` or `dist/` is relative to the **CBC plugin root**,
not to the repository you are working in. Do not look for them in your project tree and do not
report them missing when they are not there — in a project of your own, `dist/` is your build
output and has nothing to do with the file named below.

This card loads into every prompt of every session, including sessions that will never emit a
brief. Carrying the whole 300-line file here cost every client seat ~5 500 tokens per prompt for a
reference whose consumers are dispatched agents — and those read it from the plugin's `rules/` by
path, which is the only channel that ever delivered it, because `rules/` is not a loader target
(ADR-033, Bitfloo/CBC#118).

## The four decisions

Exactly ONE per turn.

| Decision | Purpose | Emitted by | Consumed by |
|---|---|---|---|
| `TASK_BRIEF` | Implementation spec for a new feature / module / change | brain, planner | task-splitter (multi-file) or builder (single-file) |
| `FIX_BRIEF` | Root-cause analysis + fix instructions for a failing test / bug | brain | builder |
| `PHASE_REPORT` | End-of-phase spec-compliance audit | brain | dev-loop (phase gate) |
| `ESCALATE` | Human decision needed — agent refuses to proceed autonomously | any brief-emitting agent | human |

## The two rules

**Headings are literal.** Downstream parsers match the exact strings. Do not paraphrase a field
name, reorder sections, or "improve" a heading. An agent emitting a brief reads the full file
first: recalling a shape from memory is how a field name drifts.

**A brief terminates.** It ends with the complete template block or with one of the sentinels
below. There is no resume — an agent that stops mid-thought has emitted nothing a consumer can use.

Sentinels are valid terminal output, and are how an agent refuses to hallucinate:

- `NEEDS_INPUT: <what, and where you looked for it>` — a FACT the work needs that the repo, the
  entity's memory and this turn's inputs do not hold. Never for the operator's attendance: a seat
  may be configured for full autonomy, so a stop that only waits for a human stalls the lane
  instead of ending it. A missing DECISION is `ESCALATE` with the fork, not this.
- `QUOTE_NOT_FOUND: <what was looked for in {file}>` — a spec quote could not be located verbatim
- `CONTRACT_NOT_VERIFIED: <module>` — an API signature was not read from the module's source this turn
- `INVESTIGATION_CHECKPOINT` — work budget exhausted before verification passed
- `ESCALATE` — the full block, per the table above

## Before emitting

Read the plugin's `rules/cbc-brief-schema.md` and follow its Pre-Emit Verification section.
Those seven checks are gates, not advice: spec quotes verbatim from a file Read this turn, API
contracts read from source rather than recalled, an `Errata Overrides` block present even when it
says `None`, an evidence-backed classification on a FIX, a grounded rules checklist, a
terminal-output gate, and the Builder-simulation ambiguity walk.

The first, second and fifth reduce to "does this file contain this string", so they are settled by
the plugin's `dist/core/grounding-check.js` per citation rather than by re-reading your own draft.
The count is pinned to the rule's actual item count by a test.

Routing to a peer specialist needs that file too — a chain `A → B` is valid only if
`A.returns ⊆ B.accepts`, and the accepts/returns table lives there. A missing row is a gap to
report, never a refusal.
