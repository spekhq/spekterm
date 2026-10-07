# spekterm

**English** | [繁體中文](README.zh-TW.md)

An agent-first local development workbench. spekterm hosts one [Claude Code](https://code.claude.com/docs)
session per repository in a single window, and puts an [OpenSpec](https://github.com/Fission-AI/OpenSpec)-aware
side panel right next to it — so you can drive your agents and read the change they're working on
without opening an IDE.

> **Status:** early, and Linux only. `0.2.1` is the first published release. macOS and Windows builds,
> auto-update, and code signing are not available yet.

## Why

Running several agents at once usually means a stack of terminal tabs and an editor you switch to just
to read the spec. spekterm's value over "four terminal tabs" is the side panel: it understands OpenSpec
— the change a session is working on, its artifacts, its tasks, and its specs — and follows along as the
agent writes to disk.

## Features

**Workspace**

- Add any number of folders; reorder them, pin the ones you use most.
- A global session that belongs to no repository, for everything else.

**Terminals**

- Real terminals (`node-pty` + xterm.js with WebGL), several sessions per repository, git worktrees
  included.
- Sessions survive a restart: `claude` sessions resume their conversation, shells respawn in their last
  working directory with the previous screen replayed. Restored sessions stay dormant — no process —
  until you press Wake.
- Sessions you keep for occasional use can be hibernated: their process ends and they wait, dormant,
  in the workspace. You can do it by hand (`Ctrl+Shift+H` or the tab menu), and idle sessions are
  hibernated automatically after 24 hours (configurable in Settings; never the one on screen, a working
  agent or a shell running a job).
- Agent sessions can switch between the terminal and a conversation view. The view is built from the
  agent's own transcript and hooks — never by scraping the screen.

**OpenSpec side panel**

- Follows the change the focused session is working on: one tab per artifact, task progress always
  visible, spec deltas marked `ADDED` / `MODIFIED`.
- Browse specs and changes (active and archived), including changes that live in other git worktrees.
- Dependency graph and timeline, shared with [spek](https://github.com/spekhq/spek), in the side panel
  maximized over the terminal — the same maximize that gives any change or file the whole stage.
- Jump between specs, changes, and the underlying files; `Ctrl+P` for quick open; one click to ask the
  agent to continue the change.

**Files**

- File tree that updates as files change on disk, Markdown rendering, syntax highlighting (Monaco),
  editing, and file operations.

**Inbox and handoffs**

- **Slack:** when someone mentions you, it becomes an inbox item. You read it and choose the folder
  before any session is opened.
- **Agent handoffs:** an agent can hand work off to another repository in your workspace. spekterm
  opens a session there and sends the first prompt; the child session remembers its parent, reports
  back when it's done, and you get a notification.

**Built to render untrusted content**

- The UI can only address files inside the folders you added, and every filesystem check runs in the
  main process.
- A strict Content-Security-Policy and a navigation guard keep repository content and terminal output
  from running script or taking over the window.

## Requirements

- Linux x64 with `libfuse2` (needed to run AppImages; Ubuntu 22.04+ no longer installs it by default).
- [Claude Code](https://code.claude.com/docs) (`claude` on your `PATH`) for agent sessions. spekterm runs
  the real CLI with your own subscription — it never asks for an API key.

## Install

Download the latest `Spekterm-<version>.AppImage` from the
[Releases page](https://github.com/spekhq/spekterm/releases), then:

```bash
chmod +x Spekterm-<version>.AppImage
./Spekterm-<version>.AppImage
```

## Install from source

You'll need Node.js 22 (see [`.nvmrc`](.nvmrc)).

```bash
git clone https://github.com/spekhq/spekterm.git
cd spekterm
npm install
npm run build && npx electron-builder --linux   # → release/Spekterm-<version>.AppImage
npm run install:desktop                          # → ~/.local/bin + your applications menu
```

`install:desktop` can be re-run while spekterm is open; the running app keeps working. To remove it,
run `npm run uninstall:desktop`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous session in the current rail item; with focus in the side panel's change view, next / previous artifact |
| `Ctrl+↓` / `Ctrl+↑` | Next / previous rail item |
| `Ctrl+T` | Open the new-session menu |
| `Ctrl+Shift+W` | Close the focused session |
| `Ctrl+Shift+H` | Hibernate the focused session |
| `Ctrl+Shift+M` | Maximize / restore the side panel |
| `Shift+↓` / `Shift+↑` | Move the selected repository up / down the rail |
| `Shift+→` / `Shift+←` | Move the focused session along the tab bar |
| `Ctrl+P` | Quick open (when the side panel has focus) |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / paste in the terminal |
| `Ctrl+S` | Save |
| `Esc` | Close overlays, dialogs, and menus |

`Ctrl+C` in a terminal is always an interrupt, even with a selection on screen.

## Troubleshooting

- **The AppImage won't start (`dlopen(): error loading libfuse.so.2`).** Install `libfuse2`, or run it
  without FUSE: `./Spekterm-*.AppImage --appimage-extract-and-run`.
- **The side panel or file tree stops updating.** Your inotify watch limit is probably too low (the
  error, `ENOSPC`, only shows up on the main process's stderr). Check
  `cat /proc/sys/fs/inotify/max_user_watches`; if it's 8192, raise it:

  ```bash
  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf
  sudo sysctl --system
  ```

- **Which build am I running?** Settings → About shows the version, build time, and commit.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements, roadmap, and architecture decisions.
- [`docs/workspace-mockup.html`](docs/workspace-mockup.html) — the interactive UI mockup.
- [`CLAUDE.md`](CLAUDE.md) and [`docs/lessons/`](docs/lessons/) — working notes for contributors and
  agents, including the failures that were silent the first time.
- [`openspec/`](openspec/) — specs and the full history of changes.

Much of the existing documentation is in Traditional Chinese; new documentation is written in English.

## Relationship to spek

[spek](https://github.com/spekhq/spek) is an open-source OpenSpec viewer. spekterm is a separate
repository that reuses spek's scanning engine and visualizations through two npm packages:
[`@spekjs/core`](https://www.npmjs.com/package/@spekjs/core) and
[`@spekjs/ui`](https://www.npmjs.com/package/@spekjs/ui).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues
privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](./LICENSE). Packaged builds also include `THIRD_PARTY_LICENSES.txt`, which lists every
third-party package bundled into the app and its license.

## Disclaimer

spekterm is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by
Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC. OpenSpec is a separate project by its own
authors.
