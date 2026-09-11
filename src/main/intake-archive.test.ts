import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { resolveNewWithin } from './fs-boundary'
import { forgetDelivery, readDelivery, saveDelivery } from './intake-archive'

const bases: string[] = []

/** 回傳 `<base>/intake`，並記下 `<base>` 供收尾刪除。 */
function tempRoot(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-archive-'))
  bases.push(base)
  const root = path.join(base, 'intake')
  fs.mkdirSync(root)
  return root
}

after(() => {
  for (const base of bases) fs.rmSync(base, { recursive: true, force: true })
})

describe('保存以寫入已驗證的位元組達成', () => {
  it('寫得進去、讀得回來', async () => {
    const root = tempRoot()
    await saveDelivery(root, 'slack-C1.1', '{"raw":1}')
    assert.equal(await readDelivery(root, 'slack-C1.1'), '{"raw":1}')
  })

  it('內容過期後保存檔消失，而識別碼仍可再次保存', async () => {
    const root = tempRoot()
    await saveDelivery(root, 'a1', 'first')
    await forgetDelivery(root, 'a1')
    assert.equal(await readDelivery(root, 'a1'), null)
    await saveDelivery(root, 'a1', 'second')
    assert.equal(await readDelivery(root, 'a1'), 'second')
  })

  it('非法識別碼不會產生任何檔案', async () => {
    const root = tempRoot()
    await assert.rejects(() => saveDelivery(root, '..', 'x'))
    assert.deepEqual(fs.readdirSync(root), [])
  })
})

describe('保存處的 symlink 不被寫穿', () => {
  it('leaf 是 symlink 時目標未被寫入，而沒有 symlink 時確實產生保存檔', async () => {
    const root = tempRoot()
    const outside = path.join(path.dirname(root), 'outside.txt')
    fs.writeFileSync(outside, 'untouched')
    const stem = Buffer.from('victim', 'utf8').toString('hex')
    fs.symlinkSync(outside, path.join(root, `${stem}.json`))

    await assert.rejects(() => saveDelivery(root, 'victim', 'payload'))
    assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched')

    // **正面的錨**：同一份投遞在沒有 symlink 時確實寫得出來 ——
    // 否則「目標未被寫入」對一個什麼都沒做的實作也成立。
    const clean = tempRoot()
    await saveDelivery(clean, 'victim', 'payload')
    assert.equal(await readDelivery(clean, 'victim'), 'payload')
  })

  /**
   * **中間目錄那一半，從投遞路徑到不了 —— 而知道這件事本身是承重的。**
   *
   * 保存處是**扁平**的（`<root>/<hex>.json`），而識別碼的字元集不含路徑分隔字元，
   * 於是「相對路徑的中間一層」這個概念在這條路徑上根本產生不出來：唯一的中間段是 root，
   * 而 root 是我們自己的。
   *
   * 那道解析仍然留著（`resolveNewWithin`），理由是**字元集日後若放寬**（例如為了容納某個
   * 來源的識別碼），中間段立刻變成投遞者可控，而那時不會有任何東西提醒你。
   * 因此這條在**解析器本身**上驗，並在此註明它為何不能在投遞路徑上驗。
   */
  it('解析器拒絕中間一層是 symlink 的相對路徑', async () => {
    const root = tempRoot()
    const escape = path.join(path.dirname(root), 'escape')
    fs.mkdirSync(escape)
    fs.symlinkSync(escape, path.join(root, 'nested'))

    await assert.rejects(() => resolveNewWithin(root, 'nested/whatever.json'))
    assert.deepEqual(fs.readdirSync(escape), [])

    // 對照：同一個解析器對不經 symlink 的相對路徑是通的。
    assert.ok(await resolveNewWithin(root, 'plain.json'))
  })
})
