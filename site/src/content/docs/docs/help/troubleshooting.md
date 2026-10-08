---
title: Troubleshooting
description: Fixes for the problems people run into most.
sidebar:
  order: 1
---

## The AppImage won't start

If starting it prints `dlopen(): error loading libfuse.so.2`, your system is missing `libfuse2`, which
AppImages need (Ubuntu 22.04 and later no longer install it by default). Install it:

```bash
sudo apt install libfuse2
```

Or run the AppImage without FUSE:

```bash
./Spekterm-<version>.AppImage --appimage-extract-and-run
```

## `claude` is not found when spekterm is started from the desktop menu

A program started from the desktop menu does not inherit your terminal's environment. spekterm reads your
login shell's environment once when it starts, and uses its `PATH` to find `claude`. So:

- make sure the directory that contains `claude` is added to `PATH` in your shell's startup files (for
  zsh, `.zshrc` or `.zprofile`);
- **restart spekterm** after changing them — the environment is read once at startup, so opening a new
  session is not enough.

## A change to my shell environment does not show up

Same cause: spekterm reads your environment once, at startup. Quit spekterm and start it again.

## The side panel or the file tree stops updating

Your inotify watch limit is probably too low (the error, `ENOSPC`, only shows up on spekterm's standard
error output). Check it:

```bash
cat /proc/sys/fs/inotify/max_user_watches
```

If it is 8192, raise it:

```bash
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf
sudo sysctl --system
```

## Which build am I running?

**Settings → About** shows the version, build time, and commit. Include them when you report a problem
on [GitHub](https://github.com/spekhq/spekterm/issues).
