## Why

Quick open (`Ctrl+P`) lists a git worktree that lives inside the folder (for example
`.claude/worktrees/<slug>/`) as if it were a file. Picking it fails, because the side panel's viewer
cannot open a directory (issue #55).

`git ls-files --cached --others --exclude-standard -z` does not descend into a nested working tree,
but with `--others` it still reports the nested working tree **itself** as one untracked entry with
a trailing slash (`.claude/worktrees/wt/`). `listFiles` passes that entry through as a file path.

The existing requirement already forbids this ("the list SHALL contain only files, SHALL NOT
contain directories"), yet the defect passed every round of acceptance. It only shows up when the
user's global git excludes file does **not** ignore `.claude/worktrees/` — the maintainer's machine
happens to ignore it, so git never reported the entry there. CI (clean git config) caught it, and
the unit test is currently marked `todo` so CI stays green.

The gap in the spec is that its scenario for nested working trees only asks about **files inside**
the worktree ("the file appears exactly once, not under the worktree"). An implementation that lists
the worktree directory itself satisfies that scenario, so nothing tied the defect to a scenario.

## What Changes

- The git path of `listFiles` lists only regular files, each once. Measuring what git emits turned
  up more shapes of the same defect than the issue names, and all of them are fixed:
  - a nested worktree or nested repository — reported with a trailing `/`;
  - a **submodule** — reported as a bare path with no slash (from the index, as a gitlink), so a
    trailing-slash filter alone would miss it;
  - a **tracked symlink to a directory**;
  - a **file in a merge conflict** — listed three times today, once per conflict stage.
- The `todo` marker on the existing unit test is removed, and the listing tests run in an
  environment whose git configuration cannot hide the defect (no global or default excludes file),
  so the maintainer's own configuration can no longer turn them green.
- Scenarios are added to the quick-open requirement for each of these shapes, and for a folder
  whose only content is a nested worktree (the case that would switch to the fallback walk if the
  fix filtered too early). They state the environment condition explicitly, because the defect is
  invisible under a global ignore that happens to cover the worktree location.

Not in this change, each tracked separately:

- The conservative walk (used when the folder is not a git repo, or git lists nothing) also descends
  into nested working trees — issue #61.
- Untracked symlinks to directories — issue #62. Recognizing them needs a filesystem call per
  untracked entry.
- Tracked files deleted from the working tree still being listed: a missing file, not a directory.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `quick-open`: the requirement "清單不含其他工作目錄與版控忽略的內容" gains scenarios for nested
  working trees and repositories, submodules, tracked symlinks to directories, conflicted files, and
  a folder whose only content is a nested worktree — independent of the user's global git ignore
  rules. The requirement's text does not change.

## Impact

- `src/main/file-enumeration.ts` (two `git ls-files` calls, mode allow-list, per-call output limits).
- `src/main/fs-service.test.ts` (remove `todo`, isolate from git config, new tests).
- `openspec/specs/quick-open/spec.md` (scenarios), and `scripts/scenario-coverage.test.mjs`
  (register this change; `quick-open` is not covered there yet).
- `CLAUDE.md` ("列舉檔案" section) and `docs/lessons/probes.md` (a global excludes file makes git
  fixtures behave differently on the maintainer's machine).
- No IPC, renderer, or persisted-data changes.
