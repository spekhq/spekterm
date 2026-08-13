## Why

`branch-service` 的第二層 watcher 監看的是 gitdir 底下的 `HEAD`，但它把**folder 根**傳給
`createWatcher` 的 `pollingRoot`。`shouldUsePolling(p)` 判定的是 `p` **所在掛載點**的檔案系統，
於是 worktree／submodule 的 gitdir 落在別的掛載點時（`.git` 是檔案、內容指向他處，路徑是絕對的），
判定套用的是一個與被監看檔案無關的檔案系統。

**失效方向是靜默的**：folder 根在 ext4、gitdir 在 NFS／SMB／FUSE 上 ⇒ `shouldUsePolling` 回
`false` ⇒ 對一個不送 inotify 事件的檔案系統用 native watch ⇒ 該 folder 的分支**永遠停在載入時
的值**。`fs.watch` 只是永遠不觸發，沒有任何錯誤可以 emit —— `watcher-error-reporting` 交付的
錯誤回報**救不到這一類**。而 `repo-branch` 開宗明義就寫著：「一個切完 branch 還顯示舊分支的
rail，比不顯示分支更糟 —— 它看起來像是真的。」

**為什麼是現在**：`watcher-error-reporting` 已把 `pollingRoot` 收斂成建立入口的顯式參數
（那個 change 刻意不修這條，理由見其 design D7：它是行為變更，而該 change 對外宣稱不改變任何
使用者可見的行為）。改的地方因此只剩一處，路是那個 change 鋪好的。

## What Changes

- **`createWatcher` 的 `pollingRoot` 改為可省略，省略時以 `target` 自身判定。** 這是本 change
  的重心 —— **不是改一個呼叫端的參數**。四個建立點裡有三個的正確答案就是它自己的目標，一個必填
  參數把這個比例弄反了：每個呼叫端都得自己想一次，而想錯的失效是靜默的。
- **一對一的建立點一律改為省略** —— 除了 `branch-service` 第二層（本 issue 的對象），還有
  `branch-service` 第一層與 `openspec-service`。後者的註解自己就寫著「這裡是一個 watcher 對一個
  目標」，卻仍顯式傳 `pollingRoot: target`。改完之後**顯式傳入只剩 `watch-service` 一處**，
  那個姿態才等於它宣稱的語意。
- **`watch-service` 保留顯式，並新增一條驗收釘住它。** 它是唯一真正服務多目標的建立點（N 個
  動態增減的子目錄）。**這條驗收是本 change 新增的防線**：一旦它成為唯一還顯式的一處，下一個人
  把它「清理」掉是完全合理的動作，而在此之前沒有任何東西會因此變紅。
- **BREAKING**：無 —— 這些都是主行程內部介面，且行為只在跨掛載點時改變。

**不做**：不改 `shouldUsePolling` 本身（那是 core 的）、不收斂 watcher 數量（issue #9 的方向 3）、
不處理「巢狀掛載點下共同根不成立」（見 design M3，登記為已知缺口）。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `watcher-error-reporting`: 新增一條 requirement，規定**輪詢判定的依據路徑**由建立入口保證與
  監看目標一致，除非呼叫端顯式指定共同根。該 spec 現有三條 requirement 管的是「監看失敗時會
  怎樣」與「缺少錯誤處理表達不出來」；這一條是同一形狀的第三種缺口 —— **一個連錯誤都不會產生
  的失敗**，而它此前不在任何規格的作用域內。該 spec 的 Purpose 也要隨之擴寫（現在它把這條能力
  定義成「監看失敗時會怎樣」，與新 requirement 說法相反）。

`repo-branch` 的「分支變動時 rail 隨之更新」**不需修改** —— 它已經涵蓋這個行為（無條件的
SHALL），缺的是實作兌現它，不是規格漏寫。

## Impact

- `src/main/watcher.ts` —— `CreateWatcherOptions.pollingRoot` 改為 optional，檔頭「兩個路徑參數
  是分開的」那段論證要改寫成「預設一致、顯式才分開」。
- `src/main/branch-service.ts` —— 兩層的呼叫都移除該參數；`#refreshHead` 中指向 issue #16 的那段
  註解隨之作廢。
- `src/main/openspec-service.ts` —— `#watch` 移除該參數。
- `src/main/watch-service.ts` —— 保留，補上「為何顯式」的註解。
- `src/main/watcher.test.ts` 與新增的 `src/main/branch-service.test.ts` —— 驗收。
- `openspec/specs/watcher-error-reporting/spec.md` 的 Purpose。
- **驗收比原先設想的強一級。** 初稿假設「本機造不出跨檔案系統對比，只能驗參數傳對了」，**那是
  事實錯誤**：本機的 `/proc/mounts` 有 FUSE 掛載點，而 core 對 `fuse*` 一律判定需要輪詢，且路徑
  **不需要存在**（`detectMountFsType` 在 `realpath` 失敗時沿用原字串比對）。因此驗收可以直接
  斷言 watcher 實際的 `usePolling`，並重現 issue #16 的失效情境。詳見 design D3。
