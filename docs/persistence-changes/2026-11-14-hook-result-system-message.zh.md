---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-14-hook-result-system-message

[English](2026-11-14-hook-result-system-message.md) | 中文

## 概述

为 hook/result 事件新增可选的 systemMessage 字段，使 hook 面向操作者的通知可以从持久化日志中查看。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：该字段是可选的，对不产生 systemMessage 的 hook 缺失。忽略未知字段的读取方不受影响，也没有读取方会为回放而消费 systemMessage；桥接只警告并记录它，因此缺失不携带任何含义。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/hook-protocol packages/experimental/hooks-claude-code：156 个测试通过，包括 events.spec.ts 中新增的记录与省略用例。

<a id="dev-note"></a>
## 开发备注

无。
