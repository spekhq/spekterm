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
 * ## 載體有兩種，而指名錯的代價是一個紅不起來的對照組
 *
 * `command: 'test'` 的 mutation 走 `npm test`，其餘走 `npm run probe:intake`。
 * **只跑 probe 的執行器會把每一個單元測試級的 mutation 判成「沒有變紅」** —— 於是那些對照組
 * 看起來有人管，實際上從來沒有證明過任何事。
 *
 * 用法：`node scripts/intake-control-groups.mjs [名稱…]`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 每一條都指名**哪一條斷言必須變紅**。
 *
 * 沒有指名的話，一個「因為別的理由紅了」的 mutation 會被當成通過 —— 而那正是這支腳本要防的。
 */
export const MUTATIONS = [
  {
    name: 'count-only-when-open',
    file: 'src/renderer/src/shell/intake/intake-state.tsx',
    from: `    const unsubscribe = window.workspace.intake.onChanged(refresh)
    refresh()
    return unsubscribe`,
    to: `    const unsubscribe = window.workspace.intake.onChanged(refresh)
    return unsubscribe`,
    expectRed: '從未打開過收件匣時仍呈現計數',
    why: '**退回現況：只在收件匣被打開時才拉一次清單。**\n'
      + '> 主行程的收件者集合是在 renderer 第一次呼叫 `list()` 時才註冊的，於是一個從來沒有被\n'
      + '> 打開過的收件匣，其變化不會推給任何人。\n'
      + '> **不要用「把 `list()` 整個拿掉」當 mutation** —— 那會讓這一段的每一條都變紅，\n'
      + '> 證明的只是「provider 有在拉資料」，不是那個既有缺陷。',
  },
  {
    name: 'focus-follows-rerender',
    file: 'src/renderer/src/shell/intake/IntakeOverlay.tsx',
    from: `  useEffect(() => {
    closeRef.current?.focus()
  }, [])`,
    to: `  useEffect(() => {
    closeRef.current?.focus()
  }, [snapshot])`,
    expectRed: '收件匣變動不把焦點搶回關閉鈕',
    why: '**把一次性的初始聚焦綁到一個會變的值上。**\n'
      + '> 「掛載」不是「改變」—— 收件匣每更新一次，焦點就被搶回關閉鈕，而使用者可能正在\n'
      + '> 編輯 routing 規則。\n'
      + '> **第一版的 mutation 是把依賴改回 `close`，而它紅不起來** —— 因為修法有兩處（overlay 的\n'
      + '> 依賴陣列、以及父層把回呼改成穩定的 identity），任一處單獨還原都不足以重現。\n'
      + '> 對照組於是抓到一個不是假綠、但也證明不了東西的 mutation：**一個跨兩個檔案的缺陷，\n'
      + '> 單點替換表達不出來**。改成這個等價而單點的形狀。',
  },
  {
    name: 'badge-label-merged',
    file: 'src/renderer/src/shell/ActivityBar.tsx',
    from: `              aria-label={label}`,
    to: `              aria-label={item.id === 'handoffs' && pendingCount > 0 ? label + ' (' + pendingCount + ')' : label}`,
    expectRed: '從未打開過收件匣時仍呈現計數',
    why: '**把計數併進入口的無障礙標籤。** 在本 repo 中那個標籤同時是驗收定位元素的手段 ——\n'
      + '> 徵狀不是斷言失敗，是**選不到元素**（求值得空值）。這個 mutation 會讓整段的定位\n'
      + '> 一起失效，而那正是它要示範的代價。',
  },
  {
    name: 'merge-debounce',
    command: 'test',
    file: 'src/main/intake-notify.ts',
    from: `    if (this.#cancel !== null) return
    this.#cancel = this.#clock.after(this.#windowMs, () => this.#flush())`,
    to: `    if (this.#cancel !== null) this.#cancel()
    this.#cancel = this.#clock.after(this.#windowMs, () => this.#flush())`,
    expectRed: '**持續到達時通知不被無限延後**',
    why: '**固定窗口換成 debounce**（每次到達都把計時器往後推）。\n'
      + '> 兩種實作在「單則到達」與「一次批次」下的結果**完全相同** —— 只有持續到達時才分岔，\n'
      + '> 而那時 debounce 的計時器永遠不會到期。這個對照組是那條 requirement 唯一的鑑別力來源。',
  },
  {
    name: 'burst-unbounded',
    command: 'test',
    file: 'src/main/intake-notify.ts',
    from: `    if (this.#presented.length >= this.#burstMax) return`,
    to: `    if (false && this.#presented.length >= this.#burstMax) return`,
    expectRed: '**逾越上界之後不再各自發出，打開收件匣即重置**',
    why: '**拿掉窗與窗之間的上界。** 合併只防批次、不防節奏 —— 每個窗恰好一則時合併完全不介入。',
  },
  {
    name: 'title-carries-authored',
    command: 'test',
    file: 'src/main/intake-notify.ts',
    // **錨點帶下一行** —— `title: t('intake.notify.title')` 自本 change 起在這個檔案裡
    // 出現兩次（到達的那一則與失敗的那一則），單獨用它會命中兩處而讓對照組失效。
    from: `    title: t('intake.notify.title'),\n    body: actor`,
    to: `    title: \`${'${'}t('intake.notify.title')} — ${'${'}title}\`,\n    body: actor`,
    expectRed: '**標題不含投遞提供的任何值**',
    why: '**讓投遞者的標題進到通知的標題。** 桌面上於是出現一則與本應用程式自己發出的別無二致'
      + '的訊息，而使用者沒有任何線索分辨。',
  },
  {
    name: 'reduce-truncate-only',
    command: 'test',
    file: 'src/main/intake-notify.ts',
    from: `  const withoutUrls = value.replace(URL_SHAPE, t('intake.notify.link'))
  const withoutMarkup = withoutUrls.replace(/[<>&]/g, '')`,
    to: `  const withoutMarkup = value`,
    expectRed: '**會被詮釋為標記的字元被移除**',
    why: '**縮減只做截短。** 第三方於是取得桌面上的排版控制權，而 URL 會被通知服務變成可點的'
      + '連結（點在那一塊上還不會觸發「打開收件匣」）。',
  },
  {
    name: 'arrival-from-state',
    command: 'test',
    file: 'src/main/intake-service.ts',
    from: `    this.#maxPending = maxPending`,
    to: `    this.#maxPending = maxPending
    queueMicrotask(() => {
      for (const record of store.list()) if (record.state === 'pending') this.#emitArrival(record)
    })`,
    expectRed: '**以已有待處理項目的狀態檔建構，不發出任何到達**',
    why: '**把觸發從「到達」改寫成「存在待處理項目」。** 那個改寫在程式碼上更短、看起來像簡化，'
      + '而它會讓每一次開機把收件匣裡積著的東西重新通知一遍。',
  },
  {
    name: 'arrival-on-notice',
    command: 'test',
    file: 'src/main/intake-service.ts',
    from: `  #emit(): void {
    for (const listener of this.#listeners) listener()
  }`,
    to: `  #emit(): void {
    for (const listener of this.#listeners) listener()
    for (const listener of this.#arrivals) listener(undefined as never)
  }`,
    expectRed: '**識別碼不合法（INVALID_ID）不發出到達**',
    why: '**把到達接到「有東西變了」那個既有通道上。**\n'
      + '> 這同時就是「接到 `DeliverOutcome.notify`」那個 mutation —— 兩者在程式碼上是同一件事：\n'
      + '> `#emit()` 恰好只在四條拒絕路徑上被呼叫，而那四條**正是** `notify: true` 的那四條\n'
      + '> （`MALFORMED` 與內容相同的重複兩條直接 return，不經 `#emit()`）。\n'
      + '> 所以這個 mutation 讓四條變紅，不是六條 —— 而那四條就是使用者會看到桌面跳通知的那些。',
  },
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
    from: `      await window.workspace.intake.attach(item.id, item.adapter, sessionId)`,
    to: `      sessions.rename(sessionId, item.title)\n`
      + `      await window.workspace.intake.attach(item.id, item.adapter, sessionId)`,
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
  {
    name: 'handoff-hooks-overwrite',
    file: 'src/main/agent-injection.ts',
    from: `      const entry = (hooks[event] ??= [{ matcher: '', hooks: [] }])`,
    to: `      const entry = (hooks[event] = [{ matcher: '', hooks: [] }])`,
    expectRed: 'SessionStart 上兩條注入的命令都被執行',
    why: '**hooks 的合成改回逐鍵覆蓋。** 事件橋接與自我介紹都貢獻 `SessionStart`，覆蓋之下只剩\n'
      + '> 最後註冊的那一個 —— 而兩個功能仍然都會回報自己已啟用。\n'
      + '> **註冊順序是這個對照組鑑別力的前提**（`terminal.ts` 有註解釘住它）。',
  },
  {
    name: 'handoff-target-prefix',
    file: 'src/main/handoff-target.ts',
    from: `  const byName = candidates.filter((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase())`,
    to: `  const byName = candidates.filter((candidate) => candidate.name.toLowerCase().startsWith(wanted.toLowerCase()))`,
    expectRed: '前綴不算命中（模糊比對的實作會在這裡開出一個 session）',
    why: '**完整相等換成前綴比對。** 這條路徑上沒有使用者在看 —— 一個「猜得很有把握」的結果會讓\n'
      + '> session 開在他沒有指名的 repo 裡，而他不會知道。',
  },
  {
    name: 'handoff-payload-target',
    command: 'test',
    file: 'src/main/intake-schema.ts',
    from: `        ...(provenance ? { targetFolderId: provenance.targetFolderId } : {}),`,
    to: `        ...(typeof (source as { targetFolderId?: unknown }).targetFolderId === 'string'
          ? { targetFolderId: String((source as { targetFolderId: string }).targetFolderId) }
          : provenance
            ? { targetFolderId: provenance.targetFolderId }
            : {}),`,
    expectRed: '投遞內容自稱的目標不被採信 —— 目標只由查表決定',
    why: '**讓 payload 的 `targetFolderId` 被採信。** 共用投遞落點明文是給應用程式之外的 producer\n'
      + '> 用的 —— 這個欄位一旦讀得到，**任何**放進落點的檔案都能繞過 routing 自選 folder。',
  },
  {
    name: 'handoff-stays-pending',
    file: 'src/main/handoff-service.ts',
    from: `    if (this.#throttle.take()) {`,
    to: `    if (false && this.#throttle.take()) {`,
    expectRed: '交接於到達時直接建立 session（使用者未執行任何接受動作）',
    why: '**拿掉自動接受。** 交接退回成一則普通的待處理項目 —— 使用者剛親口交辦的事，他得再同意一次。',
  },
  {
    name: 'handoff-steals-focus',
    file: 'src/renderer/src/shell/intake/IntakeAutoAccept.tsx',
    from: `          if (outcome.status !== 'created') return`,
    to: `          if (outcome.status !== 'created') return
          latest.current.onReveal(folderId)`,
    expectRed: 'rail 上選中的項目未因交接而改變',
    why: '**建立之後把焦點切過去。** 這條 requirement **零實作即綠**（不寫任何焦點程式碼，焦點自然\n'
      + '> 不動），它的鑑別力**完全**來自這個對照組。',
  },
  // ── handoff-body-limit-and-rejection-visibility ─────────────────────────
  {
    name: 'handoff-failures-not-notified',
    file: 'src/main/handoff-service.ts',
    section: 'runHandoffFailure',
    from: `      notifyFailures: true,`,
    to: `      notifyFailures: false,`,
    expectRed: '目標查無時發出通知（這條路徑上沒有人在等著按接受）',
    why: '**失敗只寫進收件匣，不發通知。** 接受那個環節已經沒有人在看 —— 使用者不會無緣無故\n'
      + '> 去打開收件匣，於是一次失敗的交接與「什麼都沒發生」在畫面上完全相同。\n'
      + '> 這正是本 change 的起點：那條斷言曾經是綠的，而通知從未被發出過。',
  },
  {
    name: 'too-long-treated-as-transient',
    file: 'src/main/intake-rejection.ts',
    section: 'runHandoffFailure',
    from: `export function isPermanentRejection({ code, notify }: RejectionOutcome): boolean {\n  switch (code) {`,
    to: `export function isPermanentRejection({ code, notify }: RejectionOutcome): boolean {\n  if (code === 'TOO_LONG') return false\n  switch (code) {`,
    expectRed: 'TOO_LONG：共用攝入路徑上的永久性失敗同樣發出通知',
    why: '**把「本文過長」判成暫時性。** 它於是不通知、不落盤 —— 而重送同一份投遞必然同樣失敗，\n'
      + '> 使用者永遠等不到那個「狀態改變之後就會成功」的時刻。',
  },
  {
    name: 'oversize-not-reported',
    file: 'src/main/intake-source.ts',
    section: 'runHandoffFailure',
    from: `        this.#reportIfPermanent(\n          this.#service.rejectOversize(path.basename(file), { adapter: this.#adapter }),\n        )`,
    to: `        this.#service.rejectOversize(path.basename(file), { adapter: this.#adapter })`,
    expectRed: 'TOO_LARGE：共用攝入路徑上的永久性失敗同樣發出通知',
    why: '**把通知接回 adapter 的 `deliver`。** 超過檔案大小上限的投遞在 `readBounded` 就被擋下\n'
      + '> 並消費掉，它**永遠不會走到** `deliver` —— 於是 `TOO_LARGE` 結構上通知不出來，\n'
      + '> 而那個缺口不會有任何東西變紅。',
  },
  {
    name: 'notices-not-persisted',
    file: 'src/main/intake-service.ts',
    section: 'runHandoffFailure',
    from: `  #persistNotices(): void {\n    this.#store.setNotices(this.#notices)\n  }`,
    to: `  #persistNotices(): void {\n    void this.#store\n  }`,
    expectRed: '失敗的呈現活過重新啟動',
    why: '**痕跡只活在行程記憶體裡。** 一則失敗的可見性於是取決於使用者在關掉應用程式之前剛好\n'
      + '> 打開過收件匣 —— 而促使他去打開收件匣的那個訊號（通知）正是同一條路徑上的東西。\n'
      + '> 兩者同時只在一次執行之內有效時，「可見」在實際使用中等於「不可見」。',
  },
  {
    name: 'handoff-notify-always-inbox',
    file: 'src/main/index.ts',
    from: `    if (sessionId) focusSession?.(sessionId)`,
    to: `    if (false && sessionId) focusSession?.(sessionId)`,
    expectRed: '觸發交接的通知不打開收件匣',
    why: '**通知的效果不再分流。** 一則已接受的交接在收件匣裡沒有任何待辦動作 —— 把使用者送去那裡，\n'
      + '> 等於要他再點一次才到得了他真正要去的地方。',
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
      // **有些 mutation 的載體是單元測試而不是 probe**，而那不是瑕疵：一條「決策層在什麼
      // 時候做了什麼」的性質，在 probe 的一次操作裡表達不出來（畫面上看不到那個決策）。
      // 指名錯載體的代價是一個**紅不起來的對照組** —— 那比沒有對照組更糟，因為它看起來有人管。
      const command = mutation.command === 'test' ? ['test'] : ['run', 'probe:intake']
      /**
       * **`section` 讓對照組只跑那一段。**
       *
       * 跑全套是八倍的時間，而鑑別力一分不差 —— 只要那條 `expectRed` 的斷言確實住在該段。
       * 指名錯段落的代價與指名錯載體相同：一個紅不起來的對照組。
       */
      output = execFileSync('npm', command, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 15 * 60_000,
        ...(mutation.section ? { env: { ...process.env, PROBE_ONLY: mutation.section } } : {}),
      })
    } catch (error) {
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    } finally {
      writeFileSync(full, original)
    }

    // probe 的紅是 `✗ <斷言>`，node:test 的紅是 `not ok N - <測試名>` —— 兩種格式都認。
    // **node:test 的紅燈必須整行比對。** 它的 TAP 對每一個子測試都印出名稱 ——
    // 通過的是 `    ok N - <名稱>`、失敗的是 `    not ok N - <名稱>`，而且**是縮排的**。
    // 因此 `includes(expectRed)` 會對「那條測試通過、但檔案裡別的測試失敗」一併成立，
    // 而 `/^not ok/m` 只匹配得到最外層那一行（它是**檔案**層級的，不帶測試名）。
    // 兩者相乘的結果是：只要檔案裡有任何一條紅，指名任何一條測試都會被判成「如預期變紅」。
    const notOkLine = new RegExp(
      `^\\s*not ok \\d+ - ${mutation.expectRed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
      'm',
    )
    const wentRed =
      output.includes(`✗ ${mutation.expectRed}`) ||
      (mutation.command === 'test' && notOkLine.test(output))
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

// **只有被直接執行時才跑。** 守衛（`control-groups-source.test.mjs`）要 import `MUTATIONS`，
// 而一個在 import 時就開跑的模組會讓 `npm test` 變成十幾分鐘的完整對照組。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
}
