## Context

`enumerateFiles` (`src/main/file-enumeration.ts`) lists a folder with one call,
`git ls-files --cached --others --exclude-standard -z`, and passes every entry through. When git
succeeds with **empty** output it falls back to the conservative hand-written walk, because that is
how git reports "the target is entirely inside an ignored directory".

Measured on git 2.50.1 with a repo that holds one of each kind of entry git can report:

| What sits in the folder | Entry git emits | Emitted by |
|---|---|---|
| a git worktree (`.claude/worktrees/wt`) | `.claude/worktrees/wt/` | `--others` |
| a plain nested repo (`git init` inside) | `nested/` | `--others` |
| a submodule (`sm`), committed or only staged | `sm` — **no trailing slash** | `--cached` (gitlink, mode `160000`) |
| a tracked symlink to a directory | `link-to-dir` | `--cached` (mode `120000`) |
| a file in a merge conflict | `c.txt` **three times** (stages 1–3) | `--cached` |
| an untracked directory with files | the files, one by one | `--others` |
| an empty directory | nothing | — |

Everything except the last two rows is a defect today: an entry that is not a file, or a file listed
more than once. The trailing-slash filter proposed in issue #55 only catches the first two rows.

**Two facts about `listFiles` shape the tests:** it passes each entry through `path.join` and
`path.relative`, which strip the trailing `/` — so at the `listFiles` level `nested/` arrives as
`nested`, and "no entry ends with `/`" is green while the defect is present. And the shared
`beforeEach` in `fs-service.test.ts` always seeds files, so git's raw output is never empty there.

**What hides the defect on the maintainer's machine** is the default excludes file,
`$XDG_CONFIG_HOME/git/ignore` (falling back to `~/.config/git/ignore`), which holds
`**/.claude/worktrees/`. Measured: `GIT_CONFIG_GLOBAL=/dev/null` alone leaves it in effect;
pointing `XDG_CONFIG_HOME` at an existing empty directory turns it off. An **empty string** for
`XDG_CONFIG_HOME` falls back to `~/.config` and does not.

## Goals / Non-Goals

**Goals:**

- The git path lists only regular files, each once: no worktrees, nested repos, submodules, tracked
  symlinks to directories, or repeated conflict entries.
- Every test in this change fails on the maintainer's machine too when its fix is reverted.

**Non-Goals:**

- **The conservative walk** still descends into nested working trees. It runs when the folder is not
  a git repo (for example `~/git` added as a folder, holding many repos) and when git succeeds with
  empty output inside a repo. Both are existing defects of that walk, tracked in issue #61.
- **Untracked symlinks to directories.** `--others` gives no mode, so recognizing them needs an
  `lstat` per untracked entry. Tracked in issue #62.
- **Tracked files deleted from the working tree** (and, under sparse checkout, files outside the
  cone): `--cached` still lists them and picking one fails with "not found". That is a file that does
  not exist, not a directory; left for its own issue.

## Decisions

### D1. Two `ls-files` calls: tracked with `--stage`, untracked on its own

- `git ls-files --cached --stage -z` → each record is `<mode> <object> <stage>\t<path>`, split at the
  **first** tab (paths may contain tabs and newlines; `-z` keeps them intact). The mode is checked
  against an **allow-list**: `100644` and `100755` are kept; `120000` (symlink) is kept only if
  `fs.stat` — which follows the link — says the target is a regular file; every other mode is
  dropped (`160000` gitlinks today, `040000` sparse-directory entries if `--sparse` is ever added).
- `git ls-files --others --exclude-standard -z` → entries ending in `/` are dropped (nested repos and
  worktrees).
- The result is the union, deduplicated with a `Set`. That collapses conflict stages, and it means
  correctness does not rest on the claim that the two sets never overlap.

An allow-list instead of "drop `160000`": a mode git adds later, or one we did not think of, is
excluded by default. This is the repo's standing rule that a structure should make the wrong case
inexpressible, rather than a list of known-bad values.

`stat` on symlinks only: the index already marks them, so the cost is bounded by the number of
tracked symlinks, not by the number of files.

**Both calls run concurrently and fail together.** Either call timing out, overflowing, or failing
rejects the listing, and an `AbortController` kills the other process. "Not a git repository" (or
`ENOENT` for git itself) counts only when **both** calls report it; one reporting it while the other
lists files is a failure, not a fallback. Both keep `-z`, `LC_ALL=C`, and the timeout.

**The output limit is per call, and the tracked call gets more.** `--stage` adds about 50 bytes per
entry with SHA-1 object names (about 74 with SHA-256). Measured on two repos: 1.76–1.86× the plain
output. With the current 24 MB limit, a 200 000-file repo — the size the limit's comment was sized
for — would drop from about 2× headroom to about 1.1×, and a SHA-256 repo of that size would exceed
it. The tracked call's limit becomes 48 MB; the untracked call keeps 24 MB.

Alternatives considered:

- **One call, drop trailing slashes** (issue #55's fix). Misses submodules, tracked symlinks to
  directories, and conflict duplicates, all of which break the same requirement.
- **`--format='%(objectmode) %(path)'`**: about 7 bytes per entry instead of about 50, but git
  refuses `--format` together with `-o` (so still two calls) and it needs git ≥ 2.38, which would
  mean keeping `--stage` as a fallback anyway: two code paths for one job. Raising the limit is
  simpler.
- **`stat` every entry**: correct regardless of what git reports, but one syscall per file in a tree
  that can hold 200 000 of them, on the main process that also relays every pty's data.
- **A built-in exclude for `.claude/worktrees/`**: only fixes the maintainer's layout.

### D2. The fallback still looks at git's raw output, not the filtered list

"git succeeded with no output" is the signal for "the target is inside an ignored directory", and it
triggers the conservative walk — which descends into nested working trees (issue #61). If the
emptiness check ran after filtering, a folder whose only content is a nested worktree would become
an empty list, switch to the walk, and list every file in the worktree. So the check stays on the
raw output of both calls, and filtering happens after it.

The unit test for this needs its own fixture, because the shared one always seeds files: a clean
directory whose repo has only an empty commit, with a worktree checked out from a **different branch
that has a file**. A worktree checked out from the empty commit would hold nothing but its `.git`
file, which the walk skips, so the mutation would stay green (measured).

### D3. Tests isolate git from the user's configuration through the environment

`enumerateFiles` spawns git with `{ ...process.env, LC_ALL: 'C', LANG: 'C' }`, so the tests control
git's configuration through `process.env`, **for the whole test file** (every listing test in it is
exposed — a global excludes file containing `built/` or `out/` would turn "排除版控忽略的內容"
green too):

- `XDG_CONFIG_HOME=<an existing empty temp dir>` — this is what disables the default excludes file.
- `GIT_CONFIG_GLOBAL=/dev/null` — keeps a `core.excludesFile` in `~/.gitconfig` from doing the same.
- `GIT_CONFIG_NOSYSTEM=1` — the same for the system config.

They are set before the first test and restored after the last, even when a test throws. **The
product code does not get these variables**: the user's global excludes are a legitimate way to hide
things from the list, and honoring them is the existing behavior.

The assertion shape matters (see Context): tests assert **that every listed entry is a regular file**
(`fs.statSync(path.join(root, entry)).isFile()`) and that the specific paths (`nested`,
`.claude/worktrees/wt`, `sm`) are absent. Each also asserts that a tracked main-directory file is
present, so "the whole listing broke" cannot pass.

## Risks / Trade-offs

- **[Two git processes per quick open instead of one]** → listing happens once per opening of the
  overlay, not per keystroke, and the two run concurrently.
- **[A tracked symlink to a file outside the folder is still listed]** → it is a regular file by
  `stat`; picking it fails at the read boundary, as it does today. Not a directory, so not this
  change's defect.
- **[Setting `process.env` in a test file]** → scoped to that file's run (each test file is its own
  process under `node --test`) and restored in `after`.
- **[The acceptance probe cannot see this defect]** → `probe:openspec`'s `runQuickOpenScope` goes
  through git enumeration with a nested worktree, but it inherits the maintainer's global excludes and
  its query does not match the worktree path. It stays a regression check for quick open as a whole;
  the discriminating carriers are the unit tests, and the coverage table says so.
