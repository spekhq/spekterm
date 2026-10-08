---
title: Install
description: Download the spekterm AppImage, make it executable, and run it.
sidebar:
  order: 1
---

spekterm is distributed as an AppImage: one file that runs without installing anything system-wide.
Linux builds are available today. macOS and Windows are not supported yet.

## Requirements

- **Linux on x86_64.** The AppImage needs `libfuse2` to run. Ubuntu 22.04 and later no longer install it
  by default — see [If the AppImage does not start](#if-the-appimage-does-not-start).
- **Claude Code** for agent sessions: the `claude` command must be on your `PATH`. spekterm runs the real
  CLI with your own login and subscription; it never asks for an API key. Shell sessions work without it.
- **OpenSpec** is optional. The side panel reads the `openspec/` directory of your repositories directly;
  a few details, such as the order of a change's artifacts, come from the `openspec` CLI when it is
  installed. Without an `openspec/` directory you still get terminals and the Files view.

## Download and run

1. Open the [latest release](https://github.com/spekhq/spekterm/releases/latest) and download
   `Spekterm-<version>.AppImage`.
2. Make it executable and start it:

   ```bash
   chmod +x Spekterm-<version>.AppImage
   ./Spekterm-<version>.AppImage
   ```

The first start opens an empty workspace. Continue with [Your first workspace](/docs/getting-started/first-workspace/).

spekterm reads your shell environment once when it starts (your login shell's `PATH`, and the variables
your agent sessions need). If you change your `.zshrc` or `.bashrc`, restart spekterm for new sessions to
see the change.

## If the AppImage does not start

If you see an error like `dlopen(): error loading libfuse.so.2`, the AppImage cannot mount itself.
Either install the library:

```bash
sudo apt install libfuse2
```

or run the AppImage without FUSE, which unpacks it to a temporary directory first:

```bash
./Spekterm-<version>.AppImage --appimage-extract-and-run
```

Both work; installing `libfuse2` makes every start faster. More problems and fixes are on the
[Troubleshooting](/docs/help/troubleshooting/) page.

## Add it to your applications menu

The AppImage runs from wherever you put it. If you build spekterm from source, the repository has a
command that installs the built AppImage into `~/.local/bin` and adds an entry, with its icon, to your
desktop's applications menu:

```bash
git clone https://github.com/spekhq/spekterm.git
cd spekterm
npm install
npm run build && npx electron-builder --linux   # → release/Spekterm-<version>.AppImage
npm run install:desktop                          # → ~/.local/bin + your applications menu
```

You need Node.js 22 to build. The first packaging run downloads the Electron binary, so it needs network
access. To remove the menu entry and the installed copy, run `npm run uninstall:desktop`.

## Where spekterm keeps its data

Everything spekterm remembers — your folder list, sessions, side panel positions, preferences, the inbox —
lives in `~/.config/Spekterm`. Nothing is written into your repositories. Removing that directory resets
spekterm to a fresh install; it does not touch your code.

## Updating

There is no automatic update yet. Download the new AppImage from the
[latest release](https://github.com/spekhq/spekterm/releases/latest) and run it in place of the old one.
Your data in `~/.config/Spekterm` carries over. **Settings → About** shows which version you are running.
