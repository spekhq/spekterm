---
title: The OpenSpec side panel
description: Follow an OpenSpec change while your agent works on it — artifacts, tasks, spec deltas, browsing, worktrees, Graph and Timeline.
sidebar:
  order: 2
---

The side panel is the reason spekterm exists. Instead of switching to an editor to read the spec, you keep
the change your agent is working on next to its terminal, and watch it change as the agent writes.

The panel has two identities, switched at its top: **OpenSpec** and **Files**. This page covers
OpenSpec; Files has [its own page](/docs/using/files/). A repository without an `openspec/` directory only
offers Files.

## This change

**This change** shows one change, with one tab per artifact: the proposal, the design, the spec deltas,
the tasks, and any data files the change carries. The tabs follow the order your OpenSpec schema defines.

- **Tasks** shows progress and the tasks grouped under their headings. The progress count is also in the
  status bar.
- **Spec deltas** marks each requirement as added, modified, removed, or renamed, and highlights the
  `WHEN` / `THEN` keywords of scenarios.
- Everything updates as files change on disk. When the agent checks off a task, the tab updates.

With focus in the change view, `Ctrl+Tab` / `Ctrl+Shift+Tab` move between artifact tabs, and the arrow
keys, `Page Up` / `Page Down`, `Home`, `End`, and `Space` scroll the content.

## Choosing the change

spekterm does not guess which change a session is working on from the agent's output — a panel that
sometimes jumped to the wrong change would be worse than none. You choose:

1. Open **Browse**.
2. Expand **Changes** (**Active** or **Archived**) and pick one.

That change is now anchored for this folder, and **This change** shows it. Each folder remembers its own
choice across restarts. If a repository has exactly one active change, it is shown without choosing.

**Browse** also lists every spec. Opening a spec shows which changes touch it.

## Continue a change

When the change is missing an artifact, **This change** shows **Continue** and lists what is not written
yet. Pressing it sends `/opsx:continue <change>` to the focused `claude` session in this repository, which
writes the next artifact. spekterm does not decide which artifact comes next — OpenSpec does.

**Continue** is disabled, with the reason shown, when no session can take it: no session in this
repository, the focused session is a shell, it is not running, or the change lives in a different working
directory from the session.

## Changes in other worktrees

If you keep one change per git worktree, the panel shows changes from every worktree of the repository,
each labeled with its working directory. When the change you are looking at lives in a worktree where no
session is running, **Open a session there** starts a `claude` session in that worktree and anchors the
change for you.

## Showing another repository

The panel normally shows the repository selected on the rail, but it can show any folder in your
workspace — for example, to read a spec in a shared library while your session works in an app. Click the
source indicator at the top of the panel and pick a folder; **Back to the selected repo** returns. The
status bar shows `panel: <name>` while the panel shows another repository.

## Moving between specs and files

From an artifact, **Open in Files** opens the underlying file in the Files identity. From a file under
`openspec/`, **View in OpenSpec** goes back. `Ctrl+P` (with focus in the side panel) opens quick open to
find any file by name — see [Files and quick open](/docs/using/files/).

## Maximize, Graph, and Timeline

`Ctrl+Shift+M` maximizes the side panel over the session tabs and the terminal, which keep running
underneath; press it again, or **Restore**, to go back. The rail stays visible.

The OpenSpec identity has two more views, shown only while the panel is maximized (choosing one maximizes
it for you):

- **Graph** — how specs and changes relate: which changes touch which specs.
- **Timeline** — the life cycle of each change on a time axis.

Click a change in either view to open it in **This change**; click a spec in Graph to open it in
**Browse**. Restoring the panel brings back the view you had before, at the same artifact and scroll
position.

## Keeping up with the disk

The panel watches the repository and redraws when files change. If it stops updating after a while, your
system's file-watch limit is probably too low — see [Troubleshooting](/docs/help/troubleshooting/).
