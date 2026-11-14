---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-14-hook-result-system-message

English | [中文](2026-11-14-hook-result-system-message.zh.md)

## Summary

Adds an optional systemMessage field to the hook/result event so a hook's operator-facing notice is inspectable from the durable log.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-14-hook-result-system-message
baseline: false
changes:
  - root: "event:hook/result"
    previous: "2026-09-11-initial"
    after: "f2e8147aa080c5ca7da0dd6ba775373acdd02cdd1f52f9a0b31442835cac3be0"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: the field is optional and absent for every hook that emits no systemMessage. Readers that ignore unknown fields are unaffected, and no reader consumes systemMessage for replay; the bridges warn and record it, so absence carries no meaning.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/hook-protocol packages/experimental/hooks-claude-code: 156 tests passed, including the new persist-and-omit case in events.spec.ts.

<a id="dev-note"></a>
## Dev Note

None.
