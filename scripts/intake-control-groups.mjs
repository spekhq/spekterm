/**
 * 對照組 —— 把修正退回，確認那條斷言真的變紅。
 *
 * **這是唯一擋得住假綠的東西。** 這個 repo 每一條重要的守衛都這樣驗過，而幾次沒這樣驗的，
 * 全部是假綠。
 *
 * ## 腳本自己先證明 mutation 生效了
 *
 * 一個**沒有改到任何東西**的 mutation 與一個有效的 mutation，在輸出上長得一模一樣（都是綠的）。
 * 因此每一次替換之後先斷言檔案內容確實不同 —— 否則這支腳本自己就是一盞永遠亮綠的燈。
 *
 * ## 還原之後要重建
 *
 * 探針跑的是 `out/` 的產物。`PROBE_SKIP_BUILD=1` 之下還原原始碼**不等於**還原產物 ——
 * 這支腳本不跳過建置，於是每一輪都是被出貨的那份程式碼。
 *
 * 用法：`node scripts/intake-control-groups.mjs [名稱…]`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 每一條都指名**哪一條斷言必須變紅**。
 *
 * 沒有指名的話，一個「因為別的理由紅了」的 mutation 會被當成通過 —— 而那正是這支腳本要防的。
 */
const MUTATIONS = [
  {
    name: 'prefill-no-wait',
    file: 'src/main/intake-prefill.ts',
    from: `  const timer = setTimeout(() => finish(false), PREFILL_TIMEOUT_MS)`,
    to: `  fill()\n  const timer = setTimeout(() => finish(false), PREFILL_TIMEOUT_MS)`,
    expectRed: '就緒之前的整段期間未向該 session 寫入任何內容',
    why: '**pty 建立完成之後、不等待就緒即寫入。** 不可用「建立後立即寫入」當 mutation —— '
      + '那時 pty 可能還不存在、寫入會被丟棄，mutant 什麼都沒做而對照組保持綠。\n'
      + '> **這條曾經「紅不起來」，而那是替身壞掉的產物，不是這條斷言的性質。** 替身當時把'
      + '讀取迴圈放在背景並在一次空讀後就退出，於是提早寫入的位元組沒有人讀 —— 收據照樣是空的。'
      + '把讀取迴圈搬回前景（阻塞，它本來就是替身活著的理由）之後，這條就抓得到了。'
      + '**差點據此把一條有效的斷言降級成「留著當回歸」。**',
  },
  {
    name: 'transform-at-presentation',
    file: 'src/renderer/src/shell/intake/IntakeOverlay.tsx',
    from: `      <p className="mt-2 whitespace-pre-wrap break-words text-2xs text-ink-muted">{item.body}</p>`,
    to: `      <p className="mt-2 whitespace-pre-wrap break-words text-2xs text-ink-muted">`
      + `{item.body.replace(/\\s+/g, ' ')}</p>`,
    expectRed: '交給 agent 的內容逐字元等於呈現給使用者的本文',
    why: '**呈現層多做了一次交付層沒做的轉換**（收斂空白）—— 於是使用者看到的與 agent 讀到的'
      + '差在一組看不見的字元上。\n'
      + '第一版的 mutation 是「把攝入的正規化整個拿掉」，而那**不會變紅** —— 兩端都用原字串，'
      + '它們仍然相同。要模擬的是分岔，不是「都不做」。',
  },
  {
    name: 'system-names-session',
    file: 'src/renderer/src/shell/intake/IntakeOverlay.tsx',
    from: `      await window.workspace.intake.attach(item.id, item.adapter, outcome.sessionId)`,
    to: `      sessions.rename(outcome.sessionId, item.title)\n`
      + `      await window.workspace.intake.attach(item.id, item.adapter, outcome.sessionId)`,
    expectRed: 'session 的名稱未被系統指定（agent 宣告的標題呈現得出來）',
    why: '系統代為命名＝使用者永久接管命名權，此後 agent 宣告的標題被靜默地不予呈現。',
  },
  {
    name: 'routing-uses-fallback',
    file: 'src/main/intake-routing.ts',
    from: `  for (const rule of config.rules) {`,
    to: `  for (const rule of [] as RoutingRule[]) {`,
    expectRed: '接受之前看得到將開在哪個 folder（第二個，不是選中的或第一個）',
    why: '規則不生效即落到 fallback（第一個 folder）。fixture 的形狀'
      + '（三個 folder、選第三、規則指第二、fallback 指第一）正是為了讓這種錯誤實作紅。',
  },
]

function run(names) {
  const selected = names.length > 0 ? MUTATIONS.filter((m) => names.includes(m.name)) : MUTATIONS
  if (selected.length === 0) {
    console.error(`不認得的名稱。可用：${MUTATIONS.map((m) => m.name).join(', ')}`)
    process.exit(1)
  }

  const failures = []
  for (const mutation of selected) {
    const full = join(repoRoot, mutation.file)
    const original = readFileSync(full, 'utf8')
    if (!original.includes(mutation.from)) {
      failures.push(`${mutation.name}：找不到要替換的片段（原始碼已經變了？）`)
      continue
    }
    const mutated = original.replace(mutation.from, mutation.to)
    // **先證明 mutation 真的改到了東西。**
    if (mutated === original) {
      failures.push(`${mutation.name}：替換之後內容沒有改變 —— 這個對照組本身是假的`)
      continue
    }

    console.log(`\n── ${mutation.name} ──\n${mutation.why}\n預期變紅：${mutation.expectRed}`)
    writeFileSync(full, mutated)
    let output
    try {
      output = execFileSync('npm', ['run', 'probe:intake'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15 * 60_000,
      })
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    } finally {
      writeFileSync(full, original)
    }

    const wentRed = output.includes(`✗ ${mutation.expectRed}`)
    console.log(wentRed ? `  ✓ 如預期變紅` : `  ✗ **沒有變紅** —— 那條斷言沒有鑑別力`)
    if (!wentRed) failures.push(`${mutation.name}：${mutation.expectRed} 沒有變紅`)
  }

  // 還原之後重建一次，讓 `out/` 回到未被 mutate 的狀態。
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' })

  if (failures.length > 0) {
    console.error(`\n${failures.length} 個對照組未通過：`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log(`\n${selected.length} 個對照組全部如預期變紅。`)
}

run(process.argv.slice(2))
