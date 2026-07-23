import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type OpenSpecTarget, targetOfPath } from './nav'

/**
 * `targetOfPath` 的判準測試。
 *
 * **這一組的價值在反面案例，而反面案例很容易沒有鑑別力** —— 一個「看起來像壞情況」的路徑，
 * 對正確實作與錯誤實作可能同樣回 `null`，於是那條測試永遠是綠的，什麼也沒擋住。本檔案的每個
 * 反面案例都標註了它擋的是**哪一種**錯誤實作（見下方兩張表與 `design.md` D7 的鑑別力矩陣）。
 */

/** folder 自身。既有的 `openspec/…` 佈局。 */
const SELF_ONLY = ['']

/** folder 自身 + 一個邊界內的 worktree。使用者的標準工作流。 */
const WITH_WORKTREE = ['', '.claude/worktrees/wt-a']

const change = (slug: string): OpenSpecTarget => ({ kind: 'change', slug })
const spec = (topic: string): OpenSpecTarget => ({ kind: 'spec', topic })

describe('targetOfPath', () => {
  describe('folder 自身（既有行為，不得改變）', () => {
    const cases: Array<[string, OpenSpecTarget | null]> = [
      ['openspec/specs/auth/spec.md', spec('auth')],
      ['openspec/changes/my-change/proposal.md', change('my-change')],
      ['openspec/changes/my-change/specs/auth/spec.md', change('my-change')],
      ['openspec/changes/archive/old-change/proposal.md', change('old-change')],
      // 結構不完整 —— 不足以指向任何實體
      ['openspec/specs', null],
      ['openspec/changes', null],
      ['openspec/changes/archive', null],
      ['openspec/README.md', null],
      ['src/main/index.ts', null],
    ]

    for (const [relPath, expected] of cases) {
      it(`${relPath} → ${expected ? JSON.stringify(expected) : 'null'}`, () => {
        assert.deepEqual(targetOfPath(relPath, SELF_ONLY), expected)
      })
    }

    /**
     * 第三段是**檔案**時，既有實作照樣把它當 topic／slug —— 它只數分段，不看磁碟。
     * 這是既有行為，本 change 不改（範圍是「哪些路徑進得了判定」，不是「判定本身多嚴格」）；
     * 寫成測試是為了讓它**被記錄而非被誤以為是新引入的**，日後真要收緊時這裡會紅。
     */
    it('既有的寬鬆之處：第三段是檔案時仍當成 topic', () => {
      assert.deepEqual(targetOfPath('openspec/specs/spec.md', SELF_ONLY), spec('spec.md'))
    })
  })

  describe('邊界內的 worktree（本 change 的目的）', () => {
    it('worktree 裡的 change 檔案', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/changes/wip/proposal.md', WITH_WORKTREE),
        change('wip'),
      )
    })

    it('worktree 裡的 delta spec 仍歸屬於那個 change', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/changes/wip/specs/auth/spec.md', WITH_WORKTREE),
        change('wip'),
      )
    })

    it('worktree 裡的 spec 檔案給 topic（design D3 —— 導覽的目標是 topic，不是檔案）', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/specs/auth/spec.md', WITH_WORKTREE),
        spec('auth'),
      )
    })

    it('worktree 裡已封存的 change', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/changes/archive/done/proposal.md', WITH_WORKTREE),
        change('done'),
      )
    })

    it('清單中沒有那個 worktree 時不命中 —— 判準是查清單，不是猜路徑形狀', () => {
      assert.equal(
        targetOfPath('.claude/worktrees/wt-a/openspec/changes/wip/proposal.md', SELF_ONLY),
        null,
      )
    })

    /**
     * 判準**不驗 topic 是否真的存在**（design D5：這個 target 是 UI 自己的座標，不會被拿去
     * 拼接檔案路徑 —— 主行程那層的白名單查表不變）。於是某個 worktree 裡新增的 capability
     * 照樣得到入口，而點下去會是誠實的「找不到」（那一半由 `openspec-service.test.ts` 承擔）。
     */
    it('worktree 裡尚未納入 specs 的 topic 照樣給 target（判準不驗存在性）', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/specs/new-capability/spec.md', WITH_WORKTREE),
        spec('new-capability'),
      )
    })
  })

  /**
   * | 反面案例 | 正確版 | **鬆綁版**（找第一個 `openspec` 分段） |
   * |---|---|---|
   * | `docs/openspec/changes/foo/proposal.md` | `null` | `change:foo` ← 抓得到 |
   * | `docs/openspec/notes.md` | `null` | `null` ← **沒有鑑別力，不可用** |
   *
   * 反面案例**必須帶 `changes/` 或 `specs/` 那一層**。少了它，`openspec` 之後只剩一段，
   * 既非 `specs` 亦非 `changes`，於是鬆綁版也回 `null` —— 那條測試對它宣稱要擋的東西全綠。
   */
  describe('不得鬆綁為「路徑中任一段是 openspec」', () => {
    it('docs 底下、結構完全相同的檔案（change）', () => {
      assert.equal(targetOfPath('docs/openspec/changes/foo/proposal.md', SELF_ONLY), null)
    })

    it('docs 底下、結構完全相同的檔案（spec）', () => {
      assert.equal(targetOfPath('docs/openspec/specs/auth/spec.md', SELF_ONLY), null)
    })

    it('worktree 裡的 docs 底下、結構完全相同的檔案', () => {
      assert.equal(
        targetOfPath('.claude/worktrees/wt-a/docs/openspec/changes/foo/proposal.md', WITH_WORKTREE),
        null,
      )
    })

    it('根前綴相同但不是工作目錄的路徑', () => {
      // 這條擋的是**鬆綁版**（它會命中 change:x），不是 startsWith 版 —— 後者對它與正確版
      // 同解（剝出的首段是 `-suffix` 而非 `openspec`，兩者都回 null）。標對它在測什麼。
      assert.equal(
        targetOfPath('.claude/worktrees/wt-a-suffix/openspec/changes/x/proposal.md', WITH_WORKTREE),
        null,
      )
    })
  })

  /**
   * | 案例 | 正確版 | **`startsWith` 版**（取第一個命中） |
   * |---|---|---|
   * | 兩個根互為前綴，開較長者底下的檔案 | `change:x` | `null` ← 抓得到 |
   *
   * **這是唯一擋得住 `startsWith` 的案例**，因此它是一條**正面**斷言。
   */
  describe('工作目錄根的比對逐段進行，不是字串前綴', () => {
    const PREFIX_PAIR = ['', '.claude/worktrees/wt', '.claude/worktrees/wt-a']

    it('兩個根互為字串前綴時，命中較長的那個', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt-a/openspec/changes/x/proposal.md', PREFIX_PAIR),
        change('x'),
      )
    })

    it('較短的那個根自己底下的檔案照樣命中', () => {
      assert.deepEqual(
        targetOfPath('.claude/worktrees/wt/openspec/changes/y/proposal.md', PREFIX_PAIR),
        change('y'),
      )
    })
  })

  describe('巢狀工作目錄 —— 逐一嘗試，不是挑最長的就放棄', () => {
    // 病態但合法：worktree 開在另一個工作目錄的 `openspec/` 底下。
    const NESTED = ['', 'openspec/wt']

    it('內層工作目錄裡的 change', () => {
      assert.deepEqual(
        targetOfPath('openspec/wt/openspec/changes/inner/proposal.md', NESTED),
        change('inner'),
      )
    })

    it('外層工作目錄裡的 change —— 較長的根不成立時仍會試較短的', () => {
      assert.deepEqual(
        targetOfPath('openspec/changes/outer/proposal.md', NESTED),
        change('outer'),
      )
    })
  })

  describe('退化的輸入', () => {
    it('清單為空 —— 連 folder 自身都沒有時不命中任何東西', () => {
      assert.equal(targetOfPath('openspec/changes/x/proposal.md', []), null)
    })

    it('空的 relPath', () => {
      assert.equal(targetOfPath('', SELF_ONLY), null)
    })

    it('前後多餘的斜線不影響判定', () => {
      assert.deepEqual(targetOfPath('/openspec/changes/x/proposal.md', SELF_ONLY), change('x'))
    })
  })
})
