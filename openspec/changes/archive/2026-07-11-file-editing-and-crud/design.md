## Context

Phase 1 與 Phase 2 的 renderer 只能**讀**。它的檔案系統詞彙是 `(folderId, relPath)`，邊界檢查是 `resolveWithinRoot`：先 `realpath` 兩端、再以 `path.relative` 判定包含關係，然後**以解析出的真實路徑開啟**。

Phase 2 `design.md` D10 為這個寫法辯護過一次，論證的核心不是「realpath 很安全」，而是**威脅模型**：這道邊界防的是被入侵或有 bug 的 renderer，不是已經拿到本機寫入權的攻擊者（後者早已贏了 —— 這個 app 的賣點就是在 folder 裡跑一個有完整 shell 權限的 `claude`）。在那個模型下，`readFile` 的 TOCTOU 無法被 renderer 自己觸發，因為**它沒有任何建立檔案或 symlink 的能力**。

D10 的最後一段把話說死：

> **這個論證對 `writeFile` 不成立，Phase 3 不得引用本節。** 寫入的後果是覆寫或損毀邊界外的檔案，且 renderer 屆時**擁有**製造檔案的能力，race 的兩端它都碰得到。

本 change 引入 `writeFile`、`createFile`、`createDirectory`、`deleteEntry`、`rename`。D10 的禁令生效。以下所有結論都來自本機實測（Node v22.22.0 / Linux），而非沿用。

## Goals / Non-Goals

**Goals:**

- 寫入類操作**不可能**把資料寫到 workspace folder 之外，且此性質可由單元測試驅動證明。
- 未存的變更絕不靜默消失 —— 跨換頁、跨切換 folder、直到使用者明確處置為止。
- 存檔不覆蓋他人（agent）在同一份檔案上的改動，除非使用者明確選擇。
- 存檔不觸發「檔案已被外部改動」的假警報。
- 編輯器的語言服務禁令維持不變：仍然只有語法高亮。

**Non-Goals:**

- 防護已取得本機檔案寫入權的攻擊者（見 D3 的威脅模型）。
- dirty buffer 的**持久化**：app 重啟後不還原未存的變更。
- 檔案內容的 diff／merge UI。衝突的處置是三選一，不是三方合併。
- 多檔案同時開啟的 tab 列。版面屬於 terminal（PRD §6.2）。
- 原子存檔（見 D5，這是一個**經過論證的放棄**，不是遺漏）。

## Decisions

### D1：寫入的路徑解析不得重用 `resolveWithinRoot` 的「檢查完再依原路徑開啟」

`resolveWithinRoot` 回傳的是**解析後的真實路徑**，呼叫端拿它去 `open`。讀取時這樣沒問題。寫入時**已實測會逸出邊界**：

```
[A] realpath 檢查通過 → 在窗口內把 leaf 換成指向邊界外的 symlink → open(原路徑, 'w')
    write 成功；邊界外的檔案內容被覆寫   ← 越界
```

問題不在 `realpath` 算錯，而在**檢查與開啟是兩次獨立的路徑查找**。修法有兩層，兩層都要：

1. **一律對 `realpath` 的結果開啟**（而非 renderer 傳來的字面路徑）。`realpath` 的結果依定義不含 symlink，把它交給 `open` 就少了一次符號解析。
2. **`open` 帶 `O_NOFOLLOW`**，關掉最後一段的符號解析。它把「檢查後 leaf 被換成 symlink」這個窗口關死：

```
1. open(symlink, O_NOFOLLOW)   → ELOOP（阻擋）
```

於是「解析」與「開啟」在 leaf 這一段上不可分割。

### D2：`O_NOFOLLOW` 只約束最後一段，而 Node 沒有 `openat()` —— 中間目錄段防不住

實測，同一組 flags：

```
2. open(dirlink/f.txt, O_NOFOLLOW)  → 成功，寫穿了 realdir/f.txt（中間段未受約束）
   fs.openat 存在？ undefined
   FileHandle 的方法：appendFile chmod chown datasync sync read readv readFile
                     readLines stat truncate utimes write writev writeFile …（無 openat 類）
```

正解是以 dirfd 逐段 `openat` 相對開啟，讓每一段的解析都綁在前一段的 fd 上。**Node 的 `fs` 沒有這個 API**，`FileHandle` 上也沒有等價物。可行的替代只有原生模組（N-API 呼叫 `openat`），對一個「側欄檔案檢視器」而言是不成比例的成本。

**所以中間目錄段的 TOCTOU 在本 change 中沒有機制性的防護。** 它的可接受性完全由 D3 承擔 —— 而 D3 必須真的成立，不能是願望。

### D3：威脅模型的修復 —— 讓 renderer 拿不到 symlink，race 就沒有第一端

D10 的論證失效，是因為它假設「renderer 一旦能寫，就能製造 race」。**這個假設可以被設計推翻。**

製造上述任何一個 race，都需要**在 folder 內放進一個指向邊界外的 symlink**，或**操縱一個既有的越界 symlink 使其出現在目標路徑上**。因此，只要下列兩件事同時成立，renderer 就無法自行製造 race 的第一端：

1. **白名單不暴露 `symlink()`。** renderer 沒有任何建立符號連結的能力 —— `createFile` 用 `O_CREAT | O_EXCL` 建立普通檔案，`createDirectory` 用 `mkdir`。兩者都造不出 symlink。
2. **寫入類操作一律以 `realpath` 檢查完整路徑（含 leaf），任何解析後越界的目標一律拒絕。** 於是 renderer 無法對「folder 內指向邊界外的 symlink」執行 `rename` 或 `deleteEntry` —— 它碰不到那個 symlink，也就無法把它搬到某個目標路徑的中間段上。

**這正是 leaf 檢查必須用 `realpath` 而不是 `lstat` 的理由。** 用 `lstat`（不跟隨）看起來更「正確」—— 刪除一個 symlink 本來就該刪 link 本身而不是 target。但那會讓 renderer 取得操縱越界 symlink 的能力：它可以把 `evil -> /etc` 改名成 `docs`，接著 `writeFile('docs/passwd')` 的中間段就穿出去了。**我們用一點功能，換掉整個 race 的第一端。**

代價明列於 Risks：使用者無法透過 UI 刪除或改名一個指向 folder 之外的 symlink（樹上它已標示為「超出 workspace 邊界」且無法展開）。

至此，D10 的原始論證以**修復後的形式**重新成立：race 的第一端需要建立或操縱 symlink，而 renderer 兩者都做不到。能做到的角色（本機其他行程、terminal 裡的 agent）已經能直接寫那個檔案。**這個結論依賴上述兩個條件，任何後續 change 若要暴露 `symlink()`、或把寫入的 leaf 檢查改為 `lstat` 語意，本節即失效，必須重新論證。**

### D4：`O_NOFOLLOW` 是 POSIX 的，Windows 沒有

PRD §3.3 要出三平台。Node 文件明載 `O_NOFOLLOW` 在 Windows 上不提供 —— 該平台上 `fs.constants.O_NOFOLLOW` 為 `undefined`，而 `flags | undefined` 求值為 `NaN`，會讓 `open` 直接失敗。

**決定**：以 `const NOFOLLOW = constants.O_NOFOLLOW ?? 0` 取值，並在缺少該 flag 的平台上以「`realpath` 之後、`open` 之前再 `lstat` 確認目標不是 symlink」補足。這**不是**等價的防護（它仍是 check-then-use，窗口只是變窄），但：

- Windows 上建立 symlink 需要管理員權限或開發者模式，race 的前置條件本身就更難成立；
- D3 的主論證（renderer 造不出 symlink）與平台無關，它才是真正承重的那一根。

**本 repo 沒有 Windows 環境，此段為依文件推導而非實測。** 列入 Risks，並記為 Phase 6 打包驗收前必須在真 Windows 上確認的項目。

### D5：原地寫入，不做原子寫入 —— 這是取捨，不是省事

「安全存檔」的常見寫法是 temp file + `rename`。實測它在本專案的語境下有三個代價：

```
4. rename(tmp, symlink)  → 該 symlink 變成普通檔案；原目標的內容不變
```

- **它取代 symlink，而非寫穿它。** 使用者 repo 內一個 `README.md -> docs/README.md`，存檔一次就從連結變成獨立檔案。我們悄悄改動了他的 repo 結構。
- **它換掉 inode。** hard link 被斷開；而且對 watcher 而言，一次存檔會產生 `unlink` + `add` 而不是 `change` —— 檔案樹與檢視器都要處理「這個檔案消失又出現了」的雜訊。
- **它需要複製權限與 ownership**，否則新檔案帶著預設權限落地。

**決定：原地寫入。** 對 `realpath` 的結果開啟 `O_WRONLY | O_TRUNC | O_NOFOLLOW`。symlink 被寫穿（保留連結）、inode 不變、hard link 不斷、權限不動、watcher 只看到一則 `change`。

放棄的是**原子性**：寫入途中行程崩潰會留下截斷的檔案。可接受，理由是本 app 的檔案幾乎都在 git 之下，而截斷是**可見的**失敗；相對地，「symlink 悄悄變成普通檔案」是**不可見的**失敗，使用者要到很久以後才發現。**在兩種失敗之間，我們選可見的那一種。**

### D6：`createFile` 用 `O_CREAT | O_EXCL`，它同時是防重複與防 symlink

實測：

```
3. open(symlink, O_CREAT | O_EXCL)  → EEXIST（阻擋）
```

`O_EXCL` 的語意是「目標必須不存在」，而它對 symlink 的判定是**看 link 本身**而非其目標。於是同一個 flag 一次解決兩件事：不覆蓋既有檔案、不寫穿一個既存的 symlink。`createFile` 一律建立空檔案，內容由後續的 `writeFile` 寫入。

### D7：`deleteEntry` 的邊界與遞迴語意

- **邊界**：依 D3，以 `realpath` 檢查完整路徑。
- **遞迴刪除是安全的**，已實測 —— `fs.rm(dir, { recursive: true })` **不跟隨 symlink**：

```
victim/ 內含 link-to-keep -> keep/（目錄 symlink）與 link-to-file -> keep/important.txt
rm(victim, {recursive:true}) 之後：keep/ 仍存在，內容 ["important.txt"]  → 未跟隨
```

因此允許刪除非空目錄，不必退守成「只能刪空目錄」。UI 的確認對話必須標明將刪除的項目數。

- **不可逆**：不做「復原」。確認對話是唯一的閘門，因此它必須是明確的確認，而非可略過的 toast。

### D8：`rename` 的兩端都要檢查，且必須先擋下無聲覆蓋

實測，Node 的 `rename` 對已存在的目標**無聲覆蓋**：

```
rename(a, b) 其中 b 已存在 → b 的內容變成 a 的內容（b 原本的內容消失）
```

因此 `rename` 需要三道檢查：來源在邊界內、目標**的父目錄**在邊界內、目標**不存在**。

目標的存在性檢查與 `rename` 之間仍有 race（Linux 的 `renameat2(RENAME_NOREPLACE)` 能一步完成，Node 沒有）。**這個 race 的後果是覆蓋，不是越界** —— 它落在 D3 的威脅模型之外（要贏得這個 race，得先能在 folder 內寫檔）。明文記錄，不假裝防住了。

### D9：dirty buffer 屬於 workspace，不屬於 `FilesPanel`

目前 `FilesPanel` 由呼叫端以 `folder.id` 為 key 掛載 —— 切 folder 即重新掛載，狀態歸零；`FileViewer` 又以 `openPath` 為 key，換檔案即重新掛載。這兩個 key 是 Phase 2 刻意的設計（「換 folder 時展開狀態與開啟的檔案隨重新掛載自然歸零，不需要 effect 去清」）。

未存的變更必須活過這兩次卸載，因此 buffer **不能**待在它們裡面。提升到一個 workspace 層級的 store：

```
key   = `${folderId}:${relPath}`
value = { text: string, baseMtimeMs: number }   // baseMtimeMs = 開檔時磁碟的 mtime
```

`baseMtimeMs` 隨 buffer 一起存活，它是 D11 樂觀鎖的基準。

### D10：dirty 必須在檔案樹上可見，且 header 要有總數

side panel 沒有 tab 列。使用者編輯了 `a.md`、返回樹、去看 `b.ts`、切到另一個 repo —— 若不標記，他沒有任何線索知道 `a.md` 還有未存的變更。

- 樹上每一列：dirty 的檔案顯示 `●`。
- 面板 header：顯示**當前 folder 的 dirty 總數**。這條不是裝飾 —— dirty 的檔案可能位於一個尚未展開的目錄裡，樹上的標記那時看不到。

### D11：存檔以 mtime 樂觀鎖偵測衝突，衝突時拒絕而非覆蓋

`writeFile(folderId, relPath, text, baseMtimeMs)`。主行程在開啟前 `stat`，若磁碟的 `mtimeMs !== baseMtimeMs`，回傳 `{ ok: false, code: 'CONFLICT', detail: { diskMtimeMs } }`，**不寫入**。

renderer 呈現三選一：**以我的內容覆寫** / **捨棄我的變更並重載磁碟** / **取消**。選擇覆寫時以 `baseMtimeMs: null` 重送，主行程略過比對。

不做三方合併 —— 那需要 diff UI，屬於另一個 change。

Phase 2 的「檢視中的檔案於磁碟被改動時提示重載」在唯讀前提下是完備的（沒有東西可失去）。有了 buffer 之後，**「重載」變成一個破壞性動作**，requirement 必須改寫。

### D12：watcher 的自我事件在主行程抑制，不推給 renderer

我們寫檔，chokidar 就推一則 `change`，而 `FileViewer` 收到 `change` 就顯示「檔案已在磁碟上變更」。不處理的話，**每一次存檔都會警告使用者磁碟被外部改動了**。

抑制放在主行程，而不是讓 renderer 過濾自己造成的事件 —— 後者是實作洩漏：renderer 不該需要知道哪些事件源自它自己的呼叫。

機制：`writeFile` 成功後 `fstat` 取得新的 `mtimeMs`，將 `(folderId, relPath, mtimeMs)` 記入一個帶 TTL 的自寫集合。`WatchService` 以 `alwaysStat: true` 取得事件的 `stats.mtimeMs`，若命中集合則丟棄該事件並移除該筆。

**待實作期確認**：一次 `O_TRUNC` + `write` 在各平台上會產生幾則 `change` 事件（截斷與寫入可能各觸發一次 mtime 更新）。抑制條件因此定為「relPath 相符**且**事件 mtime 不新於記錄值」，並以 TTL 兜底。這一點必須由單元測試釘住，不能靠肉眼觀察。

### D13：編輯器 wrapper 的介面不得洩漏 monaco 型別

`workspace-app-shell` 有一條 requirement「編輯器透過 wrapper 介面存取」，正是它讓 Phase 2 的接線侷限在 `src/renderer/src/editor/`。`CodeViewer` 成為 `CodeEditor`，新增 `onChange(text)` 與 `onSave()` 兩個 prop，`readOnly` 降為選項。

`Cmd/Ctrl+S` 在編輯器內由 monaco 的命令機制註冊（它會吃掉該按鍵，全域 `keydown` 攔不到）；焦點不在編輯器時（例如 markdown 預覽模式）由面板層的 `keydown` 處理。兩條路徑呼叫同一個存檔函式。**`monaco.KeyMod` 不得出現在 wrapper 之外。**

### D14：「唯讀檢視不引入任何語言服務 worker」——約束不變，理由要換

該 requirement 的名稱與理由都建立在唯讀之上（「使用者無法於此處修正編輯器回報的任何診斷」）。可編輯之後這個理由不再成立，但**結論仍然成立**，只是根據不同：PRD §6.2 明訂「深度改檔仍走 agent 或使用者自己的 IDE」，編輯器在此承擔的是語法高亮，不是 IDE。

`ts.worker` 單獨即 12.65 MB（Phase 0 實測），而 `npm run measure:bundle` 會在產物出現任何語言服務 worker 時以非零碼結束。這道閘門原封不動。

### D15：視窗關閉的攔截 —— renderer 主動推送 dirty 狀態，主行程同步判斷

`window.on('close')` 的 handler 是**同步**的：要 `preventDefault()` 就得當下決定，不能等一次 IPC 往返。若在此時才去問 renderer，renderer 沒回應（掛了、正在長任務）就等於靜默丟棄變更 —— 正是要防的事。

**決定**：renderer 在 dirty 集合變動時，經白名單推送一份快照給主行程（`app.setDirtyState(entries)`）。`close` 事件同步讀取該快照：

- 快照為空 → 放行。
- 非空 → `preventDefault()`，以 **原生** `dialog.showMessageBox` 呈現「儲存全部 / 不儲存並關閉 / 取消」。

用原生對話框而非 renderer 的 modal：此刻要呈現的內容（檔案路徑）來自使用者的 repo，而 renderer 正處在「即將關閉」的狀態。原生對話框不受頁面狀態影響。

「儲存全部」需要 renderer 動作，因此走一次 IPC 往返，renderer 存畢回報後主行程再關閉；往返設逾時，逾時則退回對話框。

### D16：CRUD 的操作入口由本 change 定義 —— mockup 對此沉默

`docs/workspace-mockup.html` 的 `.file-row` 設為 `cursor: default`，樹是靜態的，**它沒有畫任何檔案操作的入口**。CLAUDE.md 訂明衝突時以 mockup 為準，但 mockup 在此處沉默，因此這是一個必須新做的設計決定（與 Phase 2 D1 處理「開檔如何呈現」的情況相同）。

**決定**：樹上的右鍵選單（新增檔案／新增資料夾／重新命名／刪除），加上面板 header 的「新增」入口（供空目錄與根目錄使用 —— 空目錄沒有可以右鍵的列）。

**名稱驗證在建立之前於主行程執行**，且採三平台的交集規則：不得為空、不得為 `.` 或 `..`、不得含 `/`、`\` 或 NUL、不得以空白或 `.` 結尾、不得為 Windows 保留名稱（`CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`）。在 Linux 上放行一個 Windows 開不了的檔名，等於製造一個只在某些機器上壞掉的 repo。

## Risks / Trade-offs

| 風險 | 緩解／取捨 |
|---|---|
| **中間目錄段的 TOCTOU 無機制性防護**（Node 無 `openat`） | 由 D3 承擔：renderer 造不出、也操縱不到 symlink。**此結論有前提**，見 D3 末段。 |
| **`O_NOFOLLOW` 在 Windows 不存在**，且本 repo 無 Windows 環境實測 | 退為 `realpath` + `lstat` 二次確認（窗口變窄，非等價）。列為 Phase 6 打包驗收前必須在真 Windows 上確認的項目。 |
| **原地寫入非原子**：寫入途中崩潰會留下截斷的檔案 | D5 的明確取捨。截斷是可見的失敗；temp+rename 造成的「symlink 悄悄變普通檔案」是不可見的失敗。 |
| **無法刪除或改名指向 folder 之外的 symlink** | D3 換來的代價。該 symlink 在樹上已標示為超出邊界且無法展開、無法讀取。 |
| **無法刪除 broken symlink**（`realpath` 失敗 → `NOT_FOUND`） | 已知缺陷，列入 Open Questions。 |
| **`rename` 目標存在性檢查與 `rename` 之間的 race** | 後果是覆蓋而非越界，落在威脅模型之外（見 D8）。 |
| **`writeFile` 的 `stat` 與 `open` 之間的 race** | 同上：後果是覆蓋掉他人剛寫的內容，不是越界。樂觀鎖只保證「偵測到絕大多數衝突」，不保證線性化。 |
| **dirty buffer 不持久化**：app 崩潰即失去未存的變更 | 明列於 Non-Goals。持久化需要一個磁碟上的暫存區，而它自身又帶來一組邊界問題。 |
| **自寫事件抑制若失準** | 過度抑制 → 漏報真實的外部變更（使用者看到過期內容）；抑制不足 → 每次存檔都假警報。以單元測試釘住 chokidar 的實際事件序列（D12）。 |

## Open Questions

- **broken symlink 的刪除**：`realpath` 對它必然失敗，於是 D3 的檢查會把它判為 `NOT_FOUND`。要不要為「leaf 是 symlink 且其 target 不存在」開一個特例（以父目錄的 `realpath` + `lstat` 確認 leaf）？該特例不會給 renderer 操縱越界 symlink 的能力（target 不存在，無法被搬到任何路徑的中間段），但它是 D3「一律 realpath」這條乾淨規則上的第一個缺口。傾向**先不開**，待有人真的被擋住再說。
- **`deleteEntry` 對非空目錄的確認**：要在對話中列出將被刪除的項目數，就得先遞迴數一次。大目錄（`node_modules`）上這是一次昂貴的走訪。是否設一個上限（「超過 1000 個項目」）而不給精確數字？
- **dirty buffer 的上限**：使用者可以編輯任意多個檔案而不存檔，buffer 全數留在記憶體。是否需要一個總量上限？（`readFile` 已有 2 MiB 的單檔上限，因此單一 buffer 有界，但數量無界。）
