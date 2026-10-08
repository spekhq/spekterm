---
title: Worktree aggregation
description: How spek shows the changes of every git worktree of a repository, and jj workspaces as an experimental option.
sidebar:
  order: 2
---

A repository often has several working copies at once — each agent, or each parallel task, on its own branch
in its own git worktree. The OpenSpec changes for that work are spread over those copies, and a viewer
pointed at one of them sees only part of it.

spek finds every worktree of the repository (with `git worktree list`) and shows their in-flight changes in
one list:

- **Changes from every worktree**, each tagged with the branch it comes from; the main worktree's are left
  unlabelled, so the feature work stands out.
- **One change, one row** — a change that several worktrees inherited is shown once. Which copy wins is
  decided from git history (the worktree that moved it past the main branch), not from file times.
- **Archived changes** from every worktree, merged.
- It refreshes when any worktree's `openspec/` changes.

Point spek at any worktree, or at the main checkout: the result is the same.

## The scope control

When there is more than one working copy, the header shows a scope control: **Current dir**,
**Worktrees**, and — when a jj workspace is detected — **Worktrees + jj**. The choice is remembered: in the
web app in the browser's storage, in VS Code in the `spek.aggregateWorktrees` and
`spek.aggregateJjWorkspaces` settings.

## jj workspaces (experimental)

In a repository that uses both git and [jj](https://jj-vcs.github.io/jj/), jj workspaces are invisible to
`git worktree list`. Choose **Worktrees + jj** (or set `spek.aggregateJjWorkspaces` in VS Code) and spek
also scans every jj workspace:

- Off by default, and offered only when a jj workspace exists.
- Copies of a change that are identical collapse into one; a workspace that has diverged keeps its own entry,
  marked as conflicting, and as *editing* when it is the workspace's current change.
- jj is never required: without it, or with the option off, spek behaves as without this feature.

## Where it works

The web app and the VS Code extension aggregate worktrees. The JetBrains plugin does not.
