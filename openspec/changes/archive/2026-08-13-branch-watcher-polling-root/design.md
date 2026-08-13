## Context

`createWatcher` 有兩個路徑參數：`target`（要監看的路徑）與 `pollingRoot`（判定是否改用輪詢的
依據路徑）。它們分開是對的 —— `watch-service` 讓一個 watcher 服務 N 個動態增減的子目錄，那時
判定該用它們的共同根，而不是「碰巧第一個被訂閱的目錄」。`watcher.ts` 的檔頭已經論證過這件事。

問題出在**預設姿態**：`pollingRoot` 目前是必填，於是每個呼叫端都得自己想一次該傳什麼，而
`branch-service` 的第二層想錯了 —— 它監看 gitdir 底下的 `HEAD`（worktree／submodule 時可能在
另一個掛載點），卻傳 folder 根。

四個建立點（`src/` 產品程式碼中 `createWatcher(` 恰好四處）：

| 建立點 | 現在傳的 `pollingRoot` | 監看什麼 | 一對一？ |
|---|---|---|---|
| `watch-service.ts:239` | folder 根 | N 個動態增減的子目錄 | **否** |
| `openspec-service.ts:868` | target | 該目標自己 | 是 |
| `branch-service.ts:84`（第一層） | folder 根（＝target） | folder 根自己 | 是 |
| `branch-service.ts:123`（第二層） | folder 根 | **gitdir 的 HEAD，可能在別的掛載點** | 是（**傳錯了**） |

**四個裡有三個是一對一，正確答案就是 `target` 自己。必填參數把這個比例弄反了。**

`shouldUsePolling(p)` 的實作（core 1.7.0）走 `detectMountFsType(p)` 讀 `/proc/mounts` —— 判定的
是那條路徑**所在掛載點**的檔案系統，這也是為什麼傳錯路徑的後果是實質的而非理論的。

## Goals / Non-Goals

**Goals:**

- 一對一的建立點一律以自己的監看目標判定輪詢。
- 把「必須動腦」的位置從四處收斂到一處，並**替那一處補上驗收**。
- 驗收具備鑑別力：重現 issue #16 的失效情境，把修正退回時測試必須變紅。
- 把驗得到什麼、驗不到什麼寫進規格，而不是留給下一個人推測。

**Non-Goals:**

- 不改 `shouldUsePolling` 本身（在 `@spekjs/core`）。
- 不驗證「輪詢啟用之後事件真的送達」—— 那需要真的把 repo 放在網路檔案系統上（見 D3）。
- 不解決巢狀掛載點下「共同根」不成立的問題（見 D5，登記為已知缺口）。
- 不收斂 watcher 數量（issue #9 的方向 3）。

## Decisions

### D1: `pollingRoot` 改為可省略，省略時以 `target` 判定

issue #16 建議的修法是「第二層改傳 `target`」。**採用一個更強的版本**：讓 `pollingRoot` 成為
optional，`createWatcher` 內部以 `pollingRoot ?? target` 判定。

**為什麼不只改呼叫端**：那修掉的是這一個實例，不是這一類錯誤。四個建立點裡三個是一對一，讓安全
的那個選擇成為預設，等於把「必須想對」的站點從四個減到一個。

**這不等於「讓錯誤表達不出來」，不要那樣描述它。** 初稿用了那個說法，而它過強：省略之後
一對一的呼叫端安全了，但**多目標**的呼叫端若忘記傳，拿到的預設是 `target` —— 也就是「碰巧第一個
被訂閱的目標」，正是下面否決「一律用 target」時所批判的東西。必填參數至少強迫作者想一次；
optional 之後編譯器不再問。這是一次**實質收斂（四→一）**，不是一個結構性保證。**因此 D4 的
驗收必須連同那唯一一處一起釘住**，否則收斂就只是搬家。

**替代方案：拿掉 `pollingRoot`、一律用 `target`。** 否決 —— `watch-service` 的 watcher 服務多個
目標，`target` 只是它們之中碰巧第一個被訂閱的；以它判定既不正確，也會退化成 `label` 曾經有過的
同一個毛病。且那會讓每次訂閱都多一次 `realpath` + 讀 `/proc/mounts`。

**替代方案：保持必填，靠 code review 或註解。** 否決 —— 現況就是這樣，而它產生了這個 bug。

### D2: 顯式傳入只保留 `watch-service` 一處

`pollingRoot` 一旦變成 optional，顯式傳入就從「例行公事」變成一個**帶語意的宣告**：我這個
watcher 服務多個目標，請以共同根判定。**因此三個一對一的建立點全部改為省略** —— 包含
`branch-service` 第一層（它的 `pollingRoot` 與 `target` 恰好相同）與 `openspec-service`
（它的註解自己就寫著「這裡是一個 watcher 對一個目標」）。

留著任何一個一對一的顯式傳入，那條語意就只有一半成立，而規格會在自己封存的當下就被 codebase
違反。

（初稿在這裡主張相反的做法 —— 保留第一層的顯式並補註解。那個版本與 tasks 不一致，且與新
requirement 的措辭衝突，已推翻。）

### D3: 輪詢判定本機驗得到 —— 驗不到的是「事件真的送達」

**初稿在此處有事實錯誤，必須記下來。** 它宣稱「探針一律在 ext4 上跑，tmpfs 不觸發輪詢，因此連
一組人工對比都湊不出來」，並據此把驗收降級為「只驗參數傳對了」。**實測推翻**：

- core 的 `fsTypeNeedsPolling` 對 `fuse` / `fuseblk` / `fuse.*` **一律回 true**
  （`watch-polling.js:35-42`）。
- `detectMountFsType` 在 `realpathSync` 失敗時**沿用原字串**去比對 `/proc/mounts`
  （`watch-polling.js:82-99`）—— 因此**路徑不需要真的存在**。
- 本機 `/proc/mounts` 有多個 FUSE 掛載點（`/run/user/<uid>/doc`、`/run/user/<uid>/gvfs`，
  以及 AppImage 自己的掛載點）。

實測（`node --import tsx`，直接 import `src/main/watcher.ts`）：

```
shouldUsePolling('/run/user/1001/doc/nonexistent/HEAD') → true
shouldUsePolling('/home/me/git/spekterm')           → false
createWatcher({ target: fusePath, pollingRoot: fusePath }) → options.usePolling = true
createWatcher({ target: fusePath, pollingRoot: localPath }) → options.usePolling = false
```

`FSWatcher.options` 是 chokidar 的公開介面（`chokidar/index.d.ts:94`）。**因此驗收的斷言對象是
`options.usePolling`，不是「傳出的參數」** —— 那重現的正是 issue #16 描述的失效：一個 gitdir 位於
需要輪詢的檔案系統上的 folder，修正前 `usePolling=false`（native watch，永遠不觸發），修正後
`true`。

**驗不到的仍然有，界線只是移了位置**：輪詢被啟用之後 chokidar 是否真的送出事件、以及真實
NFS／SMB 的行為，本機不驗證。**規格的免責條款要收窄到這個位置**，不能繼續宣稱「輪詢是否啟用」
也驗不到 —— 把一個其實驗得到的東西登記成已知缺口，下一個人就不會再去驗它。

**環境依賴的處理**：測試 SHALL 從 `/proc/mounts` **探測**一個會觸發輪詢的掛載點，不寫死 uid 或
路徑。探測不到時 skip —— 而 **skip 是靜默綠**，因此 skip 時必須印出來，且**參數層級的斷言要保留
作為基準**（它在任何機器上都跑得動）。

**替代方案：env override（`CHOKIDAR_USEPOLLING`）。** 否決，也記在這裡以免下一個人重走 ——
`parsePollingOverride` 的短路發生在**看路徑之前**（`watch-polling.js:151-157`），對所有路徑一視
同仁，因此不提供任何鑑別力。

### D4: 以建構子注入觀察 `BranchService` 實際建出的 watcher

**驗收必須觀察 `branch-service` 建出來的那個 watcher**，否則沒有鑑別力：一個只測 `createWatcher`
本身的單元測試，在呼叫端把 `pollingRoot: folder.path` 加回去時**不會變紅** —— 它測的是另一個模組。

作法：`BranchService` 的建構子接受一個 optional 的 watcher 工廠，預設為真正的 `createWatcher`；
測試傳入 spy 取得建出的 watcher，斷言其 `options.usePolling`。

**為什麼這不違反「不在產品程式碼裡塞測試分支」**：它是依賴反轉，不是條件分支 —— 產品路徑只有
一條，沒有任何 `if (testing)`。**本 repo 已有一個語意完全同構的先例**：`OpenSpecService` 的建構子
注入 `scan`（`openspec-service.ts:319-322`），其 JSDoc 寫的正是「這件事從外部的回傳值看不出來 ——
不把它顯式化，就只能靠計時之類的脆弱手段去猜」。「傳給 `shouldUsePolling` 的是哪條路徑」是同一種
看不出來。（`WatchService` 的 `debounceMs` 也是接縫，但它的理由是時間，沒有這一個貼切。）

**替代方案：`mock.module`。** 否決 —— 需要為整個測試指令加 `--experimental-test-module-mocks`，
而它與 `tsx` 的互動未經本 repo 驗證。為了一條斷言把所有測試放上實驗性旗標，代價不對等。

**替代方案：原始碼守衛（AST 斷言呼叫不含 `pollingRoot`）。** 否決作為**主要**驗收 —— 它驗的是
原始碼長相而非實際建出的 watcher，且會在無害的重構下誤報。

**`WatchService` 也需要同一個接縫，但它的斷言只到參數為止**（實作階段才發現，值得記下來）：
要讓它的共同根與其目標得到不同的輪詢判定，目標必須位於與 folder 根不同的掛載點上 —— 而它的
target 一律經 `resolveWithinRoot()` 並在 realpath 後檢查邊界，symlink 指向他處會被判越界，
真正做得到的只有在 folder 內掛一個 bind mount（需 root 權限，測試環境造不出）。

**這正是 D5 那個已知缺口本身** —— 它既是規格宣告不支援的組態，也因此是驗收無從造出的組態。
一個規格宣告不支援的情形，驗收自然造不出來；所以這裡驗到「傳出的依據路徑是 folder 根」為止，
是這個站點能達到的上限，不是偷懶。spec 為此帶了一條限於此情形的例外。

### D5: 「共同根」只在同一掛載點內成立 —— 登記為已知缺口

`watch-service` 的 target 來自 `resolveWithinRoot(folder.path, relPath)`，保證的是**路徑包含**，
不是**同一個掛載點**。repo 裡掛一個 NFS 資料目錄、`node_modules` 掛在別的檔案系統、bind mount、
docker volume —— 這些都會讓「在 folder 之內」與「同一個檔案系統」分家，那時 `watch-service` 會
發生與 issue #16 **完全同一種**的靜默失效，只是換一個站點。

**本 change 不修它**：chokidar 的 `usePolling` 是建構時決定的，一個 watcher 服務跨掛載點的多個
目標在結構上就無解，要修得改成「每個掛載點一個 watcher」，那是另一個 change 的規模。

**但規格不能把共同根寫成無保留的正確答案** —— 那會留下一個偽不變式給下一個人採信。spec 要帶一句
限定。

## Risks / Trade-offs

- **[唯一還顯式的那一處會被合理地「清理」掉]** → `watch-service` 成為孤例之後，刪掉它的
  `pollingRoot` 是一個看起來很合理的整理動作，而型別、`npm test`、探針**全部不會變紅**，只有
  跨掛載點的使用者靜默受害。**這是 D1 收斂之後新增的風險，緩解就是 D4 那條驗收必須涵蓋它**
  （不只驗 `branch-service`）。

- **[預設值救得了「忘記想」，救不了「想錯」]** → 一個新的多目標 watcher 若顯式傳了錯的共同根，
  這個 change 幫不上忙。緩解僅止於註解與型別說明。誠實地說：這個 change 把四分之三的情形變成
  安全預設，沒有把剩下四分之一變成不可能。

- **[驗收依賴本機存在 FUSE 掛載點]** → 探測不到就 skip，而 skip 是靜默綠。緩解：skip 時印出，
  且保留參數層級的斷言作為在任何機器上都成立的基準。

- **[驗收與真實失效之間仍有距離]** → 驗的是「輪詢被啟用」，使用者遇到的是「分支不更新」。中間
  隔著「chokidar 的輪詢確實運作」與「真實網路檔案系統的行為」兩個未驗證的環節。緩解：D3 把這段
  距離寫進 spec，讓它是**被記載的缺口**而不是**被以為已覆蓋的缺口**。

- **[行為變更無回歸基準]** → 這是 `watcher-error-reporting` 刻意把它分出來的理由之一。同掛載點下
  `pollingRoot ?? target` 得到相同答案，因此本機既有行為不變。`probe:workspace` 的 `repo-branch`
  段落是回歸基準。

## Open Questions

無。（初稿的 OQ1「第一層要不要也改成省略」已由 D2 裁決：改。）
