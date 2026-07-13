## 1. 狀態層：命名權永久接管（`sessions.tsx`）

- [x] 1.1 `SessionState` 移除 `pendingTitle` 欄位；`title` 的 docstring 改寫為「pty 宣告的標題**恆被記錄**，
      是否呈現由標籤的優先序決定」（design D3）
- [x] 1.2 `setTitle()`：`customTitle` 存在時**不再設 pendingTitle**，改為照常更新 `title`（靜默記錄、不呈現、
      不觸發任何裁決）。保留 `target.title === next` 的短路 —— agent 會反覆送同一個標題，那條防的是無謂的
      整棵樹重繪
- [x] 1.3 `customTitle` 的 docstring 改寫：命名 ＝ **永久**接管命名權，pty 其後的標題不再需要確認；交還的
      唯一路徑是清空名稱
- [x] 1.4 移除 `acceptPendingTitle()` 與 `keepCustomTitle()`，並自 `SessionsApi` 介面收窄
- [x] 1.5 `rename()` 移除清空 `pendingTitle` 的動作（該欄位已不存在）
- [x] 1.6 移除 `SessionsProvider` 中查找待裁決 session 的邏輯（`sessions.tsx:354` 一帶的 `pendingSession`）

## 2. 移除確認對話框

- [x] 2.1 刪除 `src/renderer/src/shell/terminal/TitleConflictDialog.tsx`
- [x] 2.2 `MainStage.tsx` 移除該 import、掛載點與 `onAccept` / `onKeep` 接線
- [x] 2.3 清理 `session-badge.tsx` 中提及「待裁決 / 確認」的註解，使其反映新規則

## 3. 驗收：`probe:terminal` 改為驗新行為（design D5）

- [x] 3.1 移除舊的標題衝突斷言（`scripts/probe-terminal.mjs:1325` 一帶：對話框出現 / 保留我的名字 /
      採用它的名稱 / 對話框開啟時快捷鍵不生效）
- [x] 3.2 新增：`claude` session（由既有的 stub `claude` 驅動）先宣告標題 `a` → 使用者改名為 `b` →
      **stub 再宣告 `a`（同一個）與 `c`（不同的）** → 斷言全程不出現任何 `[role="dialog"]`，且標籤恆為 `b`
- [x] 3.3 新增**對照組**（否定斷言的必要配套）：清空名稱 → 斷言標籤**立即**變為 `c`。標籤變成 `c` 即證明
      那些 OSC 標題**真的抵達了** `setTitle()`；少了這條，3.2 的「沒有對話框」在 stub 根本沒送出標題時
      也會通過（假綠）

## 4. 驗收：把消失的第三種對話框載體換成 `VizOverlay`（design D4）

- [x] 4.1 `scripts/probe-openspec.mjs` 新增：Graph（或 Timeline）overlay 開啟中按下 `Ctrl+↓` →
      斷言選中的 folder 不變、overlay 維持開啟
- [x] 4.2 該斷言需要一個**有第二個 folder** 的前提才有意義（否則「folder 不變」恆真、是一條假綠）——
      確認 probe 的 fixture 已有多個 folder，若無則補上

## 5. 文件

- [x] 5.1 `CLAUDE.md`：改寫「session 的命名權可以被使用者接管」那段（現記著三層裁決與確認對話框），
      改為「命名 ＝ 永久接管、pty 標題靜默記錄不呈現、清空即交還」
- [x] 5.2 `CLAUDE.md`：更新「probe:keyboard 與 probe:terminal 對三種對話框各驗一次抑制」那句 ——
      第三種已換成 Graph／Timeline overlay，且承載它的是 `probe:openspec`
- [x] 5.3 `docs/PRD.md`：查核後未提及該確認流程 —— 無須同步（no-op）

## 6. 回歸

- [x] 6.1 `npm run typecheck`（移除 `pendingTitle` 與兩個 API 會把所有引用點逼出來）
- [x] 6.2 `npm test`
- [x] 6.3 `npm run probe:terminal`（改動的主場）
- [x] 6.4 `npm run probe:openspec`（新增 4.1 的斷言）
- [x] 6.5 `npm run probe:keyboard`（`MainStage` 的對話框掛載點動過，且它是快捷鍵抑制的另外兩種載體）
