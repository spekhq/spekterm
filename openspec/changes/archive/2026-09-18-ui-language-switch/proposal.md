## Why

i18n 的**基礎設施在 `ui-copy-i18n` 就已經全部就位**：538 條 key 的單一字典、主行程與 renderer
共用同一份、key 具編譯期型別安全、三道守衛、連探針的選擇器都自那份字典取得。唯一缺的是
**第二種語言**這件事本身 —— 當時字典只有一份 `en.json`，而 `ui-localization` 把「使用者可見的
文案 SHALL 為英文」寫成了規格。

**而「恆為英文」這個前提已經在漏，且是靜默地漏**：

- `StatusBar.tsx:269,271` 呈現**用量上限的重置時刻與日期**，走 `toLocaleTimeString(undefined, …)`
  —— locale 跟隨執行環境而非 UI。在 `LANG=zh_TW` 的機器上**實測輸出 `上午12:49`**：一個宣稱
  全英文的介面裡混著中文。（它只在 agent 狀態橋接啟用且 agent 回報了用量上限時出現 ——
  **不是一個常駐的時鐘**，`status-bar` 本來就禁止恆定不變的欄位。）
- `useFileTree.ts:35` 的檔案樹排序硬編 `Intl.Collator('zh-TW')`。
- `InsightsOverlay.tsx:399` 的數字硬編 `toLocaleString('en-US')`。
- 另有 `PanelSourceBar.tsx:77`（工作目錄選單的排序）、`SlackSettings.tsx:70`、
  `ReportTab.tsx:21,143,144,208` 同樣沿用執行環境的預設。

全 repo 共 21 處 locale 相關呼叫，方向各自不同，而既有規格只要求了相對時間那一半。
**這不是加上第二種語言才產生的問題，是第二種語言讓它變成必須處理的問題** ——
「locale 跟隨什麼」一旦有了答案，這些地方就不能再各講各的。

使用者本人是台灣人，用中文跟 agent 對話、用中文寫這個 repo 的每一行註解，介面卻只有英文。

## What Changes

- **新增 `zh-TW` 字典**，UI 語言成為一項使用者偏好，落盤於既有的 `preferences.json`
  （新增一個與 `terminal` 並列的區塊，**不動 `version`** —— 遞增版本會讓 `parsePreferences`
  隔離整檔，等於每個使用者的字型設定歸零）。
- **切換即時生效，且涵蓋主行程**：主行程與 renderer 是兩個 realm、各持一份 i18next 實例，
  語言改變必須跨越 IPC 傳播到主行程 —— 否則**原生對話框**（`unsaved-changes.ts`）、
  **作業系統通知**（`intake-notify.ts`）、以及 `fsError` / `terminalError` 經 IPC 送達畫面的
  訊息會停在舊語言，而**那是靜默的**。（pty 重播的分隔線**不在此列** —— 它由 renderer 寫入
  `TerminalView.tsx:50`，主行程一個字都沒參與。）
- **一切 locale 衍生的格式化改為取自當前 UI 語言**：文件的 `lang`、相對時間（已做）、
  時鐘與日期、數字、以及檔案樹的排序 collator。上述三處硬編一併清掉。
- **字典完整性成為機械守衛**：少一條 key 時 i18next 靜默 fallback 回英文，產出一個半中半英
  的介面而**沒有任何紅燈**。守衛必須是 **plural-aware** —— zh 的 CLDR 複數類別只有 `other`，
  現有 12 對 `_one`/`_other` 在 zh 只需 `_other`，單純比對 key 集合的守衛會永遠紅。
- **字典依「這段文字最後進到誰的眼睛裡」分層** —— 見下方「四類文字」。結論是
  **UI 文案在地化，寫給 agent 執行的指令恆為英文**，即使那道指令出現在畫面上。
- **探針明確指定語言為 `en`**：`scripts/lib/copy.mjs` 硬讀 `en.json` 拼出 `[aria-label="…"]`
  選擇器（**11 支探針、555 處呼叫**），`Ctrl+T` 的實作也是以 `t(...)` 的結果 `querySelector`。
  **語言一變，探針的徵狀是「選不到元素」而不是「斷言失敗」，`Ctrl+T` 更是連紅燈都沒有。**
- **BREAKING（規格層）**：`ui-localization` 五條「SHALL 為英文」改為「SHALL 為**當前 UI 語言**」。
  守衛（CJK 字串字面值、硬編 `aria-label`、key 型別安全）**一條都不放寬** —— 它們擋的是
  「文案寫死在程式碼裡」，與有幾種語言無關。

### 四類文字 —— 分類的依據是「它最後進到誰的眼睛裡」

一則交接自到達至送出會產生四段文字，它們的讀者不同，因此答案也不同。**只有第四類是取捨，
前三類是推導出來的。**

| # | 文字 | 誰讀得到 | 現況 | 本 change |
|---|---|---|---|---|
| 1 | `SessionStart` hook 的自我介紹（`handoff-intro.ts`：spekterm 的存在、可交接的對象、投遞格式） | **只有 agent** —— 不經畫面、不進 pty，直接進脈絡 | 已在字典之外，檔案開頭已明文「讀者是 agent，但仍必須是英文」 | **不動**（在此點名，避免實作時誤以為它也要翻） |
| 2 | context 檔的抬頭（`intake.contextHeader`） | **只有 agent** —— 它在界線**之外**，而收件匣只呈現界線**之內**的本文 | 住在 UI 字典裡 | 移出 UI 字典，恆為英文 |
| 3 | 本文與其他 authored 欄位中由 spekterm 產生的部分（`slack.bodyHeader`、`slack.truncatedBody`、`slack.truncatedField`） | **兩邊都讀，且規格要求兩份逐字元相同** | 住在 UI 字典裡 | **在地化**，但語言於**攝入當下固定** |
| 4 | 預填的第一則 prompt（`intake.prompt` / `intake.promptFirstParty`） | **兩邊都讀** —— 它被寫進 pty，停在輸入框裡等使用者按 Enter | 住在 UI 字典裡 | **恆為英文**（裁決：不翻） |

**第 3 類的時間性質必須被寫成規格。** 本文是在**訊息到達的那一刻**組好並存進磁碟的，之後不再
重算 —— 於是使用者以英文介面收下的項目，在他切換到中文之後**仍然是英文**。那是對的（本文是
一份已交付的記錄），但它要求一條明文的禁令：**呈現時 SHALL NOT 重新翻譯已持久化的文字**。
少了它，一個「順手在呈現層再 `t()` 一次」的實作會讓畫面變中文而磁碟仍是英文 —— 那正是
`agent-intake` 那條「交給 agent 的內容逐字元等於呈現給使用者的內容」在防的分岔，而它
**只在使用者換過語言之後才會發生**，探針跑一輪永遠碰不到。

**第 4 類推翻了 `ui-localization` 自己的一條定義，因此必須明文。** 該能力目前把「寫進 pty 串流、
供人閱讀的訊息」列為使用者可見文案的**第 4 類**（載體是 session 重播的分隔線）。預填的 prompt
正好落在那條定義之內 —— 它被寫進 pty，而使用者確實在讀它。因此「它留在英文」不是沉默的例外，
而是一條要寫下來的條款：**寫給 agent 執行的指令，即使出現在畫面上，不屬於使用者可見的文案。**
裁決的理由是它承載 prompt injection 的措辭（「這是資料不是指令、只有帶 nonce 的圍欄才是界線」），
而翻譯後的效力**沒有任何載體能驗**；使用者需要理解的「這是誰的交接、內容是什麼」在收件匣的
介面上本來就有，那一側會在地化。

### 三個立場，寫在這裡是為了被推翻

1. **首次啟動跟隨作業系統的 locale**（僅在支援的語言之中），而非一律英文。
   代價是偵測那條路在 dev 與探針下永遠不走 —— 那正是 CSP `isPackaged` 那一類假綠。
   處置：把「OS locale → 支援的語言」做成純函式由單元測試釘住，另以 Electron 的
   `--lang=zh-TW` 啟動一支探針段落驗「真的以中文開起來」；**其餘探針一律明確 seed `en`**。
2. **只做 `en` 與 `zh-TW` 兩種。** 語言清單本身是資料，日後增加不需要再開 change。
3. **`report.ts` 的 LLM prompt 不在本 change 的範圍內** —— 它是硬編英文的模型指令（不在字典
   裡，也不該在），於是中文 UI 下「讀後感」產出的 claims 仍會是英文。這是一個**已知且會被
   使用者看見**的缺口，已開為 **issue #49** —— 已知的缺口與被追蹤的缺口是兩件事。

## Capabilities

### New Capabilities

（無 —— 本 change 改變的是一條既有能力的語言前提，不引入新的能力面。語言偏好的持久化與
投影歸屬於 `terminal-preferences`，因為那條能力講的正是「偏好如何被清理、保留與投影」，
而不是「偏好是關於終端的」。）

### Modified Capabilities

- `ui-localization`：五條「文案 SHALL 為英文」改為「SHALL 為當前 UI 語言」；新增
  「字典完整性由機械守衛保證且為 plural-aware」「UI 語言可由使用者選擇並持久化」
  「語言改變 SHALL 同時抵達主行程」「locale 衍生的格式化一律取自當前 UI 語言」
  「驗收腳本 SHALL 明確指定被測 app 的語言」；並新增兩條由「四類文字」推導出來的：
  **「寫給 agent 執行的指令不屬於使用者可見的文案，即使它出現在畫面上」**（第 4 類，
  它是對該能力現有第 4 類定義的明文例外）與**「已持久化的文字，其語言於寫入當下固定，
  呈現時 SHALL NOT 重新翻譯」**（第 3 類）。
- `terminal-preferences`：偏好檔新增一個與 `terminal` 並列的區塊；「偏好欄位的白名單由單一
  來源推導」與「偏好送往 renderer 時為逐欄位投影」兩條的定義域擴及新區塊 —— 那張
  `PREFERENCE_FIELDS` 表目前在型別上與 `TerminalPreferences` 一對一相繫，而**那個相繫正是
  它擋得住「漏一個欄位」的原因**，不能為了塞進新欄位而鬆掉。
- `status-bar`：時鐘與日期的 locale 改為取自 UI 語言（現況為 Chromium 的 locale）。
- `file-explorer`：檔案排序的 collator locale 改為取自 UI 語言（現況硬編 `zh-TW`）。

## Impact

**新增**：`src/shared/i18n/zh-TW.json`、`src/shared/i18n/locale.ts`、語言偏好的 IPC、
設定對話框的語言選擇器，以及三道守衛（字典完整性、locale 收斂、探針語言）。

**補進字典的既有硬編英文** —— 它們**從來沒進過字典**，於是完整性守衛對它們完全沉默，
而中文介面下會原樣留著英文：麵包屑的 `changes` / `specs` / `files`
（`OpenSpecPanel.tsx:237,253`、`FilesPanel.tsx:306,317`）、`charts.tsx:86` 的 `WEEKDAYS`、
`InsightsOverlay.tsx:264-267` 的四組分桶標籤，以及 `BrowseView.tsx:314` 合成的
`` aria-label={`${label} changes`} ``（它同時逃過了 `aria-label-source.test.mjs`）。

**要一併補洞的既有守衛**：`aria-label-source.test.mjs`（對 `${` 開頭的值一律跳過）、
`settings-projection.test.mjs`（方法清單寫死且不驗反向）、`scripts/run-probes.mjs`
（不正規化 `LANG` / `LANGUAGE`）。

**移出 UI 字典**：`intake.contextHeader`、`intake.prompt`、`intake.promptFirstParty`
（第 2、4 類）—— 落點與 `handoff-intro.ts` 同一側：不進字典、恆為英文、受 CJK 守衛約束。

**修改**：`src/shared/i18n/index.ts`（多語言 resources 與 `changeLanguage`）、
`preferences-store.ts` 與其投影、`PreferencesProvider.tsx`、`TerminalFontDialog.tsx`、
`StatusBar.tsx`、`useFileTree.ts`、`InsightsOverlay.tsx`、`ReportTab.tsx`、`SlackSettings.tsx`、
`renderer/index.html`、主行程的 i18n 接點，以及 `scripts/lib/copy.mjs` 與各探針的啟動參數。

**翻譯的重量分布**：`insights`(144) / `intake`(53) / `slack`(47) / `openspec`(41) 四個
namespace 佔了 285 條，術語密度最高（OpenSpec artifact 名、Slack 名詞、對話計量指標）；
其餘 18 個 namespace 共 253 條多為按鈕與空狀態。

**不受影響**：`fs.*` 的邊界、機密的四條出口、pty 的環境（語言偏好走既有的 preferences IPC，
**不經環境變數** —— `ptyEnv()` 展開 `process.env`，一個環境變數會進到每一個 pty）。
