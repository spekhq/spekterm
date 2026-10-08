---
title: Files and quick open
description: Browse, read, and edit the files of a repository in the side panel, and find any file by name with Ctrl+P.
sidebar:
  order: 4
---

The **Files** identity of the side panel is a file tree of the repository the panel shows, with a viewer
and editor for the file you open. It is meant for reading and small edits next to your agent — deeper
work belongs to the agent or to your own editor.

Switch to it with **Files** at the top of the side panel.

## The file tree

- Directories load when you expand them, so large repositories open quickly.
- Each row shows whether it is a file or a directory and how long ago it was modified; the header shows
  how many items are visible.
- The tree updates on its own when files are created, changed, or deleted on disk — by the agent, a
  build, or you in another program.
- Symbolic links that point inside the folder can be expanded like any directory. Links that point
  outside the folder cannot: the side panel only ever reads files inside the folders you added.

If the repository has more than one git worktree, **Change working directory** at the top of the tree
switches which one the tree shows. Each folder remembers its choice.

## Reading files

Click a file to open it. Markdown is rendered; other files are shown with syntax highlighting. For an
OpenSpec file, **View in OpenSpec** takes you to the same artifact or spec in the OpenSpec identity, and
**Back to file tree** returns.

Markdown from a repository is treated as untrusted content: raw HTML is shown as text, scripts never run,
and `http` / `https` links open in your browser instead of inside spekterm (other links are not
clickable). Images hosted on `https:` addresses are loaded
— see [Data and network](/docs/reference/data-and-network/).

## Editing

Opened files are editable.

- `Ctrl+S` saves.
- A file with unsaved changes is marked in the tree and in the status bar. Unsaved changes survive switching
  files and switching folders.
- If the file changed on disk since you opened it, saving does not overwrite it — spekterm asks what to do.
- Closing spekterm with unsaved changes asks whether to **Save All and Quit** or **Quit Without Saving**.

The editor highlights syntax but does not run language services (no type checking, completion, or
go-to-definition). That keeps spekterm small and fast; use your agent or your editor for deep changes.

## Creating, renaming, and deleting

Right-click in the tree for **New file**, **New folder**, **Rename**, and **Delete**. **New in root**
creates at the top of the tree.

- Names are checked before anything is created, and the reason is shown if a name cannot be used (an
  empty name, a reserved name, characters some systems do not allow).
- **Delete** always asks first and says when the item is a directory or has unsaved changes. It cannot be
  undone.
- The folder itself cannot be renamed or deleted from here; remove it from the rail instead.

## Quick open

Press `Ctrl+P` while the side panel has focus to find a file by name.

- Type any part of the name; the letters only need to appear in order (`scr` finds `score.ts`). Matches
  in the file name rank above matches in the directory path.
- It searches the working directory the panel shows. Files ignored by git and files in other worktrees
  are left out.
- Use the arrow keys and `Enter` to open the file in Files; `Esc` closes the list and returns focus to the
  side panel.

When a terminal has focus, `Ctrl+P` goes to the terminal instead — Claude Code uses it for its prompt
history. Click in the side panel first, or use the tree.

## What Files can and cannot reach

Files reads and writes only inside the folders on your rail. It cannot open a path outside them, even
through a link in a document. This boundary applies to the side panel only: terminals are real shells and
can go anywhere your user account can.
