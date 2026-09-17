import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { introText, writeIntroFile } from './handoff-intro'

const folders = [
  { name: 'spekterm', path: '/home/u/git/spekterm' },
  { name: 'billservice', path: '/home/u/git/billservice' },
  { name: 'journal', path: '/home/u/work/journal' },
]

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-intro-')), 'intro.json')
}

test('每一個 folder 的名稱與絕對路徑都在文字裡', () => {
  const text = introText({ folders, outbox: '/data/handoff/s1' })
  for (const folder of folders) {
    assert.ok(text.includes(folder.name), `缺 ${folder.name}`)
    assert.ok(text.includes(folder.path), `缺 ${folder.path}`)
  }
})

test('投遞落點的位置在文字裡', () => {
  assert.ok(introText({ folders, outbox: '/data/handoff/s1' }).includes('/data/handoff/s1'))
})

test('告訴 agent 目標可以用絕對路徑 —— 那是同名歧義唯一的脫困路徑', () => {
  const text = introText({ folders, outbox: '/x' })
  assert.match(text, /absolute path/)
  assert.match(text, /Names are not unique/)
})

test('告訴 agent 它收不到投遞的結果 —— 否則它會回報一件沒有發生的事', () => {
  assert.match(introText({ folders, outbox: '/x' }), /NOT be told whether a handoff succeeded/)
})

test('零 folder 的 workspace 不產生一份謊稱有對象的清單', () => {
  const text = introText({ folders: [], outbox: '/x' })
  assert.ok(text.includes('(none)'))
})

test('文字全為 ASCII —— 它會原樣進入 agent 的脈絡', () => {
  // 實測：格式壞掉的 JSON 也會原樣進脈絡，於是這份內容沒有「格式不對就被丟掉」的保護。
  assert.ok(/^[\x20-\x7e\n]*$/.test(introText({ folders, outbox: '/x' })))
})

test('落盤的是完整的 SessionStart hook 輸出，additionalContext 即那段文字', () => {
  const file = tmpFile()
  assert.equal(writeIntroFile(file, { folders, outbox: '/data/handoff/s1' }), file)
  const written = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(written.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(
    written.hookSpecificOutput.additionalContext,
    introText({ folders, outbox: '/data/handoff/s1' }),
  )
})

test('不留下暫存檔 —— hook 可能正在讀它', () => {
  const file = tmpFile()
  writeIntroFile(file, { folders, outbox: '/x' })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [path.basename(file)])
})

test('寫不出來時回 null，呼叫端據此降級為沒有自我介紹', () => {
  // 讓父層是一個**檔案** ⇒ `mkdir` 立刻 `ENOTDIR`。
  //
  // **不要用 `/proc/<不存在>` 當作「寫不進去的位置」** —— 實測（2026-09-17、Node 22.22.0）
  // `fs.mkdirSync('/proc/x', { recursive: true })` 在這台機器上**不拋錯，它直接卡住**，
  // 於是整個測試檔連一條斷言都印不出來，看起來像測試框架壞了。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-intro-'))
  const blocker = path.join(base, 'blocker')
  fs.writeFileSync(blocker, 'not a directory')
  assert.equal(writeIntroFile(path.join(blocker, 'intro.json'), { folders, outbox: '/x' }), null)
})
