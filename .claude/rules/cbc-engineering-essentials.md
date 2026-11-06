---
paths: ["**"]
cbc_roles: [owner]
---

# Engineering essentials — read before writing, not after

Four defaults that hold in this repo. They are defaults, not gates: a good reason to depart is
fine, stated in the diff or the commit. What is not fine is departing silently and being caught by
an auditor at the end, when the code already exists.

Full form with evidence and enforcement: `rules/cbc-engineering-principles.md` §12–15. Paths in
this card that begin with `rules/` are relative to the CBC plugin root, not to the repository you
are working in.

## Portability — nothing names one machine, company, or person (§12)

The same bytes ship to every client. Before you write a path or a name, ask where it comes from:
`.cbc/config.yaml` (`company_name`, `entity_dir`, `entity_type`), the resolved entity,
`.cbc-bridge.md`, or the user. Never `~/PROJEKTY/…`, `~/AI-DATA/…`, `/Users/<name>/…`, and never a
company name where a config key belongs.

`data_dir` is deliberately not in that list: it is a `~/.cbc/machine.yaml` key, not a
`.cbc/config.yaml` one, and the bubble is normally found by walking up for `.cbc/config.yaml`
itself. This card named it wrong until 2026-08-14 — the cheapest possible demonstration of the
paragraph below.

If no config key holds the value today, say so and name the mechanism — do not invent a key and do
not swap in a different literal. Renaming something already shipped is a **migration**: keep the old
value in a `LEGACY_*` list and reap it, or the rename doubles what it meant to move.

## One fact, one place (§14)

A threshold, version, construct name, or protocol step has one home; everything else references it
by file and symbol, `` `path` (`symbol`) ``, never by line number. Copies are allowed only when a test binds them to the source — the "keep these in
sync" note is the failure mode, not the fix. Proving SSOT means mutation: change the value, confirm
**every** consumer's tests fail. Extraction alone proves nothing.

## A number that carries meaning carries a name — no magic numbers (§13)

Thresholds, caps, TTLs, timeouts, byte sizes, retention windows, depth limits → a named constant in
whichever module your project keeps constants in, or in the rule file that owns the bound. Indices,
`0`/`1`/`-1` arithmetic, HTTP codes, and single-use values next to their definition → leave them
alone.

The name is half of it: the bound also needs the right instrument, and the reason belongs at the
declaration. Ask what the number is really claiming. "Is this algorithm still linear" is measured
on-CPU, never on wall clock inside a parallel suite; "does this finish inside the platform's
timeout" is the reverse. If the broken version would hang rather than merely run slow, no timing
bound can gate it — assert the shape instead. A threshold with no complexity axis, no product
budget and no correctness co-assertion catches nothing and should be deleted, not tuned.

## Simplicity, surgically (§15)

Minimum code that solves the asked problem. No abstraction under two real consumers, no config knob
nobody requested, no branch for a state a caller cannot produce. Touch only what the task needs;
if you spot unrelated dead code, mention it rather than deleting it. Owner:
`rules/karpathy-coding-principles.md` §2–3.

## When this is worth re-reading

Long sessions drift — the rule read at prompt 1 stops steering by prompt 40, which is where
"just this once" paths and second copies of a constant get written. If you are deep into a session
and about to add a constant, a path, or an abstraction, re-read the four headings above first.

Comments carry WHY, never WHAT. Tests follow the CBC plugin's own `CLAUDE.md` rule 1: no new test by default — the suite, typecheck, build and an in-session check with output quoted prove a change; a new test only for a silent and costly failure nothing already running catches; a constant swap or prose earns nothing.
