import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TerminalError } from './terminal'
import { pickCreateWorktree, pickWorktree } from './worktree-pick'

/**
 * 工作目錄識別碼 → 這次 spawn 的 cwd。
 *
 * **這是本 change 唯一動到安全邊界的地方。** 邊界的保證從「renderer 沒有路徑詞彙」換成了
 * 「不可逆識別碼 + 查表」，而查表的兩個性質各自擔保不同的事：
 *
 * - **只對命中的值解析** → 圍堵性。可達的位置集合恆等於列舉結果。
 * - **建立時查無即拒絕** → 誠實性。退回 folder 根其實逸出不了任何邊界（那是舊邊界之內），
 *   但它會讓使用者以為 session 開在他選的工作目錄裡。
 *
 * 而**重建時查無對應不是錯誤** —— worktree 可能在應用程式沒開的時候被移除了。同一個問題，
 * 兩條路徑的正確行為相反。
 */
describe('pickWorktree', () => {
  const WORKTREES = [
    { key: 'aaaaaaaa', path: '/repo' },
    { key: 'bbbbbbbb', path: '/repo/.claude/worktrees/wt-a' },
    { key: 'cccccccc', path: '/tmp/wt-outside' },
  ]

  describe('建立（strict）', () => {
    it('未指定識別碼時不帶 cwd，但仍供應合法根集合', () => {
      const picked = pickWorktree(WORKTREES, undefined, { strict: true })

      assert.equal(picked.cwd, undefined)
      assert.deepEqual(picked.worktreeRoots, WORKTREES.map((w) => w.path))
    })

    it('命中時解析為該工作目錄的路徑', () => {
      assert.equal(
        pickWorktree(WORKTREES, 'bbbbbbbb', { strict: true }).cwd,
        '/repo/.claude/worktrees/wt-a',
      )
    })

    it('邊界外的工作目錄照樣解析得出來', () => {
      // 合法性來自列舉，不是路徑的包含關係 —— 這是本 change 的重點之一。
      assert.equal(pickWorktree(WORKTREES, 'cccccccc', { strict: true }).cwd, '/tmp/wt-outside')
    })

    /**
     * **拒絕，不是退回 folder 根。** 靜默退回會讓一個錯誤的識別碼把 session 開在別的地方，
     * 而使用者以為它開在他選的工作目錄裡。
     */
    for (const [label, key] of [
      ['不存在的識別碼', 'dddddddd'],
      ['別的 repo 的識別碼（對這個 folder 而言就是不存在）', '99999999'],
      ['空字串以外的畸形值', '../../etc'],
    ] as const) {
      it(`${label}被拒`, () => {
        assert.throws(
          () => pickWorktree(WORKTREES, key, { strict: true }),
          (error: unknown) => error instanceof TerminalError && error.code === 'UNKNOWN_WORKTREE',
        )
      })
    }

    it('空字串視為未指定（＝ folder 根），不是拒絕', () => {
      // renderer 送空字串是「沒有選工作目錄」的自然表達，不該讓 session 建不起來。
      const picked = pickWorktree(WORKTREES, '', { strict: true })

      assert.equal(picked.cwd, undefined)
    })

    it('列舉為空時，任何識別碼都被拒', () => {
      assert.throws(
        () => pickWorktree([], 'aaaaaaaa', { strict: true }),
        (error: unknown) => error instanceof TerminalError && error.code === 'UNKNOWN_WORKTREE',
      )
    })
  })

  describe('重建（非 strict）', () => {
    it('命中時解析為該工作目錄', () => {
      assert.equal(
        pickWorktree(WORKTREES, 'bbbbbbbb', { strict: false }).cwd,
        '/repo/.claude/worktrees/wt-a',
      )
    })

    /**
     * worktree 於應用程式未開啟期間被移除 —— **退回 folder 根且不使重建失敗**。
     * 而對話不會因此丟失：`claude --resume` 的查找是 git repo 關聯的，跨工作目錄仍找得到。
     */
    it('查無對應時退回 folder 根，不拋錯', () => {
      const picked = pickWorktree(WORKTREES, 'dddddddd', { strict: false })

      assert.equal(picked.cwd, undefined)
      assert.deepEqual(picked.worktreeRoots, WORKTREES.map((w) => w.path))
    })

    it('列舉為空時也不拋錯', () => {
      const picked = pickWorktree([], 'aaaaaaaa', { strict: false })

      assert.equal(picked.cwd, undefined)
      assert.deepEqual(picked.worktreeRoots, [])
    })
  })
})

/**
 * `terminal.create` 的解析 —— **含全域 session 那條分支**。
 *
 * 這一段存在的理由是它此前**一行都沒有被測到**：那條分支住在 `ipc/terminal.ts` 的 handler
 * 裡，而該模組於載入時就 `import { ipcMain } from 'electron'`，node:test 進不去。稽核指出
 * 「把 `strict: true` 改成 `false` 不會有任何紅燈」，於是解析被抽成具名函式搬到這裡。
 *
 * 全域 session 不隸屬任何 repo ⇒ 工作目錄集合為**空**。「帶識別碼即拒絕」因此不是一條新的
 * 特例，而是既有的「查無對應即拒絕」在空集合上的自然結果 —— 而**列舉不被呼叫**正是這個
 * 論證在行為上的憑據（單看「拒絕了」分不出是短路還是列舉後沒命中）。
 */
describe('pickCreateWorktree', () => {
  const WORKTREES = [
    { key: 'aaaaaaaa', path: '/repo' },
    { key: 'bbbbbbbb', path: '/repo/.claude/worktrees/wt-a' },
  ]

  /** 記錄有沒有被呼叫 —— 「短路」與「列舉後沒命中」的差別只看得到這個。 */
  function enumerator(): {
    of: (folderId: string) => Promise<typeof WORKTREES>
    calls: () => string[]
  } {
    const calls: string[] = []
    return {
      of: async (folderId) => {
        calls.push(folderId)
        return WORKTREES
      },
      calls: () => calls,
    }
  }

  it('全域 session 帶著工作目錄識別碼時被拒（型別互斥擋不到 IPC 的另一端）', async () => {
    const enumerate = enumerator()

    await assert.rejects(
      () => pickCreateWorktree(enumerate.of, null, 'aaaaaaaa'),
      (error: unknown) => error instanceof TerminalError && error.code === 'UNKNOWN_WORKTREE',
    )
    // 那個識別碼在 `WORKTREES` 裡是**命中的** —— 它之所以被拒，只因為全域的集合是空的。
    assert.deepEqual(enumerate.calls(), [], '全域不得列舉任何 repo 的工作目錄')
  })

  it('全域 session 未帶識別碼時通過，且合法根集合為空', async () => {
    const enumerate = enumerator()
    const picked = await pickCreateWorktree(enumerate.of, null, undefined)

    assert.equal(picked.cwd, undefined)
    assert.deepEqual(picked.worktreeRoots, [])
    assert.deepEqual(enumerate.calls(), [])
  })

  it('隸屬 folder 的 session 照常以該 folder 的列舉解析', async () => {
    const enumerate = enumerator()
    const picked = await pickCreateWorktree(enumerate.of, 'folder-1', 'bbbbbbbb')

    assert.equal(picked.cwd, '/repo/.claude/worktrees/wt-a')
    assert.deepEqual(enumerate.calls(), ['folder-1'])
  })
})
