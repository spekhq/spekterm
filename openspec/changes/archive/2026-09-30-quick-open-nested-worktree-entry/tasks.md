## 1. Tests first

- [x] 1.1 `src/main/fs-service.test.ts`: isolate the **whole file** from the user's git configuration — before the first test set `XDG_CONFIG_HOME` to an existing empty temp directory (not an empty string), `GIT_CONFIG_GLOBAL=/dev/null`, and `GIT_CONFIG_NOSYSTEM=1`; restore the previous values after the last test, even when a test throws (design D3)
- [x] 1.2 Replace the `todo` test `排除位於自身之內的其他 git 工作目錄` (and its `issue #55` pointer) with one test per new scenario, each named after its scenario. Every test asserts that each listed entry is a regular file (`fs.statSync(...).isFile()`), that the specific paths are absent (`nested`, `.claude/worktrees/wt`, `sm`, the directory link) — not "no entry ends with `/`", which `listFiles` makes green regardless — and that a tracked main-directory file is present:
  - (a) a worktree and a plain nested repo inside the folder
  - (b) a submodule added from a local repo (`-c protocol.file.allow=always`); no file from inside it is listed either
  - (c) a tracked symlink to a directory is absent while a tracked symlink to a file inside the repo is present
  - (d) a file in an unresolved merge conflict appears exactly once
- [x] 1.3 Add the test for the scenario "A folder whose only content is a nested working tree lists nothing from inside it", in its **own clean directory** rather than the shared `beforeEach` fixture (which always seeds files): the main branch has only an `--allow-empty` commit, a `feat` branch commits one file, `git worktree add .claude/worktrees/wt feat`; assert `deepEqual(files, [])` (design D2)
- [x] 1.4 Run 1.2 against the current `file-enumeration.ts` on this machine and confirm (a)–(d) go red — this checks that 1.1 actually defeats the maintainer's global ignore. The 1.3 test is red on the current code too, but for the (a) reason (the worktree directory itself is listed); its discriminating power for design D2 is shown only by the mutation in 2.4

## 2. Implementation

- [x] 2.1 `src/main/file-enumeration.ts`: replace the single call with `--cached --stage -z` and `--others --exclude-standard -z`, run concurrently. Parse `--stage` records by splitting at the first tab; keep modes `100644` / `100755`, keep `120000` only when `fs.stat` says the target is a regular file, drop every other mode; drop `--others` entries ending in `/`; return the union through a `Set` (design D1)
- [x] 2.2 Error handling for the two calls: any timeout, overflow, or failure rejects and aborts the other process (`AbortController`); "not a git repository" / `ENOENT` counts only when both calls report it, otherwise it is a failure. Output limit: 48 MB for the `--stage` call, 24 MB for the untracked call; update the `MAX_GIT_OUTPUT_BYTES` comment with the measured per-entry overhead. Unit test: when only one of the two calls reports "not a git repository", the listing rejects instead of falling back
- [x] 2.3 Keep the "git succeeded with no output ⇒ conservative walk" check on the raw output of both calls, before filtering (design D2); rewrite the header comment to cover the entry shapes and why filtering comes after the check
- [x] 2.4 Confirm 1.2 and 1.3 pass, then run the control groups, restoring after each: drop the trailing-slash filter ⇒ (a) red; replace the mode allow-list with "keep everything" ⇒ (b) and (c) red; remove the `Set` ⇒ (d) red; move the emptiness check after filtering ⇒ the 1.3 test red
  - Ran (2026-09-30, git 2.50.1): drop the trailing-slash filter ⇒ (a) and the 1.3 test red; allow-list replaced with "keep everything" ⇒ (b) and (c) red; `Set` replaced with an array ⇒ (d) red; emptiness judged on the filtered list ⇒ only the 1.3 test red; the "both calls must agree" check removed ⇒ `rejects when only one call reports "not a git repository"` red. Each restored afterwards

## 3. Coverage table and docs

- [x] 3.1 `scripts/scenario-coverage.test.mjs`: add `quick-open-nested-worktree-entry` to `COVERED_CHANGES` and one row per scenario in the delta spec — the new ones and the unchanged ones it restates — with carrier, `greenIfAbsent`, and the mutation from 2.4. Find each existing carrier by searching for it, not from memory; for "目錄不出現在結果中" record that its current carriers (`probe-files`, which uses the conservative walk, and the unit test over `sub` / `sub/deep`, which git never emits) are green regardless of the git path. The new scenarios describe the `Ctrl+P` entry while their carriers are `listFiles` unit tests: say in the note that the UI half is carried by `probe:openspec`'s `runQuickOpenScope`, which cannot see this defect (design, Risks)
- [x] 3.2 `CLAUDE.md`, section "列舉檔案（`quick-open` 的 `listFiles`）", in English: the entry shapes git reports (trailing `/` from `--others`, bare gitlink and symlink paths from `--cached`, one line per conflict stage), and that the default excludes file under `$XDG_CONFIG_HOME/git/ignore` can hide the first on one machine and not another — `GIT_CONFIG_GLOBAL=/dev/null` alone does not turn it off
- [x] 3.3 `docs/lessons/probes.md`, in English: probes that build git fixtures inherit the maintainer's global excludes (`probe:openspec`'s nested worktree is hidden by it), so a git-shaped defect can be invisible to them on the machine that runs them

## 4. Verification

- [x] 4.1 `npm test`, `npm run typecheck`, `npm run lint` all green
- [x] 4.2 `PROBE_ONLY=runQuickOpenSection npm run probe:openspec` green (its prerequisite sections are pulled in automatically) (the quick-open acceptance that goes through git enumeration with a nested worktree)
