import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { EnumerationError, enumerateFiles } from './file-enumeration'

// `enumerateFiles` runs two `git ls-files` calls. A real git cannot be made to answer them
// differently, so these tests put a stand-in `git` first on `PATH` (the spawn inherits
// `process.env`). The stand-in reports "not a git repository" for the calls `installFakeGit`
// is told to, and prints one tracked record otherwise.

let dir: string
let bin: string
let savedPath: string | undefined

function installFakeGit(notARepoFor: 'others' | 'both'): void {
  const others = `case "$*" in *--others*) echo 'fatal: not a git repository' >&2; exit 128;; esac`
  const script =
    notARepoFor === 'both'
      ? `#!/bin/sh\necho 'fatal: not a git repository' >&2\nexit 128\n`
      : `#!/bin/sh\n${others}\nprintf '100644 %s 0\\tlisted.txt\\000' e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n`
  fs.writeFileSync(path.join(bin, 'git'), script, { mode: 0o755 })
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'spek-enum-')))
  bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(dir, 'walked.txt'), 'x')
  savedPath = process.env.PATH
  process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`
})

afterEach(() => {
  if (savedPath === undefined) delete process.env.PATH
  else process.env.PATH = savedPath
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('enumerateFiles with two git calls', () => {
  it('rejects when only one call reports "not a git repository"', async () => {
    installFakeGit('others')

    await assert.rejects(
      enumerateFiles(dir),
      (error: unknown) => error instanceof EnumerationError && error.reason === 'failed',
    )
  })

  // Control for the test above: when both calls agree, the conservative walk runs as before.
  // Without it, the test above would also pass if the stand-in simply broke every listing.
  it('falls back to the conservative walk when both calls report "not a git repository"', async () => {
    installFakeGit('both')

    const files = await enumerateFiles(dir)

    assert.ok(files.includes('walked.txt'), JSON.stringify(files))
  })
})
