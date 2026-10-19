export const SKILL_MD = `---
name: tokemitsu-delegate
description: Use when a file read was blocked for being too large, when you need facts about a big file without loading it, or when generating boilerplate that follows existing files. Routes the work to a cheaper model via the tokemitsu CLI.
---

# Delegated reads and boilerplate

## Bulk read
Large whole-file reads are blocked to protect your context. When blocked, or when you only need facts *about* a big file:

    tokemitsu delegate read <path> --ask "<specific question>"

Ask narrow questions ("which functions call retryRequest, with line numbers?"), not "summarise this".

## Code write
For boilerplate that copies the shape of existing files (test scaffolds, DTOs, similar handlers):

    tokemitsu delegate write --like <reference-file> [--like <another>] --spec "<what to generate>" --out <new-file>

The generated code is written straight to disk; you do not see it. Review it with a ranged Read before relying on it.

## Do NOT delegate
- **Editing.** Answers have no dependable line-exact text. Read the exact section (offset/limit) before changing it.
- **Reasoning or review** (correctness, concurrency, security). A cheap model can skim past real bugs.
- **Small files.** The extra seconds cost more than they save.

Narrow reads (offset/limit, grep pipelines) are never blocked.
`;
