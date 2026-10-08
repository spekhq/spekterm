---
title: Keyboard shortcuts
description: Every shortcut spekterm adds, and why some keys are left to the terminal.
sidebar:
  order: 1
---

spekterm's shortcuts work wherever the focus is — in a terminal, in the editor, or in the side panel —
unless a dialog or a menu is open. The terminal almost always has the focus, so spekterm catches its keys
before the terminal does, and a key it uses never reaches the program running in the terminal.

## Sessions and the rail

| Shortcut | Action |
| --- | --- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous session in the current rail item, in tab order (wraps around). With focus in the side panel's change view: next / previous artifact |
| `Ctrl+↓` / `Ctrl+↑` | Next / previous rail item, including the global item (wraps around) |
| `Ctrl+T` | Open the new-session menu (fully usable from the keyboard) |
| `Ctrl+Shift+W` | Close the focused session |
| `Ctrl+Shift+H` | Hibernate the focused session — its process ends, it stays in the workspace to wake later |
| `Shift+↓` / `Shift+↑` | Move the selected repository one place down / up the rail (crossing into or out of the pinned group pins or unpins it) |
| `Shift+→` / `Shift+←` | Move the focused session one place along the tab bar |

## Side panel and files

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+M` | Maximize / restore the side panel |
| `Ctrl+P` | Quick open a file — only when the side panel has the focus |
| `Ctrl+S` | Save the open file |
| `Esc` | Close an overlay, a dialog, or a menu |

## Terminal

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste |
| `Ctrl+C` | Always an interrupt, even with a selection on screen |

## Keys spekterm leaves to the terminal

- **`Ctrl+P` with the terminal focused** goes to the terminal: Claude Code uses it for its previous
  history. Click into the side panel first to quick-open a file.
- **`Ctrl+C` is never taken.** Stopping an agent that has gone off course must always work, whatever is
  selected on screen.
- **`Ctrl+W` is not taken** — shells use it to delete a word. Closing a session is `Ctrl+Shift+W`.
- **`Shift+arrow` in a text field selects text** as usual; the reorder shortcuts only apply outside text
  fields.

One known cost: Claude Code's own agents view also uses `Shift+arrow`, which spekterm takes for
reordering.
