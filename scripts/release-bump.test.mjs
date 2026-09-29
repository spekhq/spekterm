/**
 * build-identity：版本的遞增與提交（`scripts/release-bump.mjs`）。
 *
 * ## fixture 必須含 `package-lock.json`
 *
 * **這不是完整性，是鑑別力。** `npm version` 會**一併改寫 lockfile**（實測），而 lockfile 在
 * 版控中。提交範圍漏掉它的話，它會永遠留在工作副本裡未提交 ⇒ 隨後每一次建置都判定工作副本
 * 不乾淨 ⇒ **每一份產物都被標為 dirty**，而那個欄位從此不傳遞任何資訊。
 *
 * 而**沒有 lockfile 的 fixture 抓不到這件事** —— 〈遞增後不留下未提交的版本宣告〉會在一個漏掉
 * lockfile 的實作上照樣全綠。這是本 repo 記載過的假綠形狀。
 *
 * ## 〈無法提交時明確告知〉要造兩種失敗
 *
 * 只造「不是 git repo」（最好造的那一種）會宣稱覆蓋了一條沒驗的路。**detached HEAD 下
 * `git commit` 會 exit 0**（實測），commit 落在一個 checkout 之後就消失的位置上 —— 只看結束碼
 * 的實作在那裡會**靜默通過**，而那正是本要求的理由所描述的情況。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUMP = join(repoRoot, 'scripts', 'release-bump.mjs')

function makeRepo({ withLock = true, version = '0.1.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-bump-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore', env: { ...process.env, LC_ALL: 'C' } })
  const gitOut = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim()

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx', version }, null, 2) + '\n')
  if (withLock) {
    // 形狀與真實 lockfile 一致：**root 與 packages[""] 兩處都有 version**，兩處都會被改寫。
    const lock = {
      name: 'fx',
      version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'fx', version } },
    }
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
  }
  git('init', '-q', '.')
  git('config', 'user.email', 'probe@example.com')
  git('config', 'user.name', 'probe')
  git('add', '-A')
  git('commit', '-qm', 'seed')
  return { root, git, gitOut, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** 跑 release-bump，回傳 `{ status, stderr }`（不拋，讓測試自己斷言結束碼）。 */
function bump(root, level) {
  const env = { ...process.env }
  delete env.RELEASE_LEVEL
  if (level !== undefined) env.RELEASE_LEVEL = level
  try {
    execFileSync('node', [BUMP, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
    return { status: 0, stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stderr: String(error.stderr ?? '') }
  }
}

const versionOf = (root) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

test('連續兩次打包產出不同的版本', () => {
  const { root, cleanup } = makeRepo()
  try {
    assert.equal(bump(root).status, 0)
    const first = versionOf(root)
    assert.equal(bump(root).status, 0)
    const second = versionOf(root)
    assert.notEqual(first, second)
    assert.equal(first, '0.1.1')
    assert.equal(second, '0.1.2')
  } finally {
    cleanup()
  }
})

test('遞增後工作副本中不留下未提交的版本宣告', () => {
  const { root, gitOut, cleanup } = makeRepo()
  try {
    assert.equal(bump(root).status, 0)
    // 漏掉 lockfile 的實作會在這裡留下 ` M package-lock.json`，而那會讓每一份產物都被標為 dirty。
    assert.equal(gitOut('status', '--porcelain'), '')
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    assert.equal(lock.version, '0.1.1', 'lockfile 的版本也要被推進，否則它會永久漂移')
  } finally {
    cleanup()
  }
})

test('工作副本帶有其他未提交的變更時，它們不被提交', () => {
  const { root, gitOut, cleanup } = makeRepo()
  try {
    writeFileSync(join(root, 'my-work.txt'), 'wip\n')
    writeFileSync(join(root, 'seed-edit.md'), 'edited\n')
    assert.equal(bump(root).status, 0)

    // 那些變更仍然是未提交的 —— `-a` 會把它們掃進一個看似無關的換版提交裡。
    const status = gitOut('status', '--porcelain')
    assert.match(status, /my-work\.txt/)
    assert.match(status, /seed-edit\.md/)

    // 而換版提交本身只動了版本宣告。
    const changed = gitOut('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort()
    assert.deepEqual(changed, ['package-lock.json', 'package.json'])
  } finally {
    cleanup()
  }
})

test('打包不建立 tag', () => {
  const { root, gitOut, cleanup } = makeRepo()
  try {
    assert.equal(bump(root).status, 0)
    assert.equal(gitOut('tag'), '', 'dogfood 期間每次打包一個 tag 只是噪音')
  } finally {
    cleanup()
  }
})

test('版本宣告檔案已被修改時拒絕打包', () => {
  for (const file of ['package.json', 'package-lock.json']) {
    const { root, gitOut, cleanup } = makeRepo()
    try {
      const before = gitOut('rev-parse', 'HEAD')
      const target = join(root, file)
      const json = JSON.parse(readFileSync(target, 'utf8'))
      json.description = 'touched'
      writeFileSync(target, JSON.stringify(json, null, 2) + '\n')

      const { status, stderr } = bump(root)
      assert.equal(status, 1, `${file} 已被修改時應拒絕`)
      assert.match(stderr, /先提交或還原/)
      assert.equal(versionOf(root), '0.1.0', '拒絕時不得遞增版本')
      assert.equal(gitOut('rev-parse', 'HEAD'), before, '拒絕時不得產生提交')
    } finally {
      cleanup()
    }
  }
})

test('無法提交時明確告知 —— 不是 git repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'spekterm-nogit-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fx', version: '0.1.0' }) + '\n')
    const { status, stderr } = bump(root)
    assert.equal(status, 1)
    assert.match(stderr, /git 工作副本/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('無法提交時明確告知 —— detached HEAD', () => {
  const { root, git, cleanup } = makeRepo()
  try {
    git('checkout', '-q', '--detach')
    const { status, stderr } = bump(root)
    // 只看 `git commit` 結束碼的實作在這裡會**靜默通過** —— 實測 detached HEAD 下它 exit 0。
    assert.equal(status, 1)
    assert.match(stderr, /detached/)
    assert.equal(versionOf(root), '0.1.0')
  } finally {
    cleanup()
  }
})

// ── 遞增的層級（`build-identity`「遞增的層級可由執行者指定，預設為 patch」）──────

test('未指定層級時遞增 patch', () => {
  const { root, cleanup } = makeRepo({ version: '0.1.18' })
  try {
    assert.equal(bump(root).status, 0)
    assert.equal(versionOf(root), '0.1.19')
  } finally {
    cleanup()
  }
})

test('指定 minor 時遞增 minor 並把 patch 歸零，且該遞增被提交', () => {
  const { root, gitOut, cleanup } = makeRepo({ version: '0.1.18' })
  try {
    assert.equal(bump(root, 'minor').status, 0)
    assert.equal(versionOf(root), '0.2.0')
    assert.equal(gitOut('log', '-1', '--no-color', '--format=%s'), 'chore(release): 0.2.0')
    assert.equal(gitOut('status', '--porcelain'), '')
  } finally {
    cleanup()
  }
})

test('不認得的層級被拒絕，版本不動、沒有新的提交', () => {
  const { root, gitOut, cleanup } = makeRepo({ version: '0.1.18' })
  try {
    const before = gitOut('rev-parse', 'HEAD')
    const { status, stderr } = bump(root, 'minr')
    assert.notEqual(status, 0)
    assert.match(stderr, /patch、minor、major/)
    assert.equal(versionOf(root), '0.1.18')
    assert.equal(gitOut('rev-parse', 'HEAD'), before)
    assert.equal(gitOut('status', '--porcelain'), '')
  } finally {
    cleanup()
  }
})
