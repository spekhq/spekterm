---
title: FAQ
description: Common questions about spek.
sidebar:
  order: 1
---

## Does spek change my files?

No. spek only reads: it shows your `openspec/` directory and git history and has no way to edit them.

## How is spek related to spekterm?

[spekterm](/) is a desktop workbench for running Claude Code sessions across repositories, with a side
panel that shows the OpenSpec change each session is working on. That side panel uses spek's engine
(`@spekjs/core`) to read OpenSpec and draws spek's graph and timeline (`@spekjs/ui`). Use spek to read specs
where you already work; use spekterm to run agents next to them. Neither needs the other.

## Do I need the OpenSpec CLI?

No. spek reads `openspec/` itself; the CLI, when installed, adds what spek can show about workflow schemas.
See [Install spek](/spek/docs/getting-started/install/#the-openspec-cli).

## Which forms aggregate worktrees?

The web app and the VS Code extension. The JetBrains plugin does not. See
[Worktree aggregation](/spek/docs/using/worktrees/).

## Is spek affiliated with Anthropic or OpenSpec?

No. spek is an independent open-source project; OpenSpec is its own project, and spek only reads its
files.

## Is it free?

Yes. spek is open source under the MIT license.
