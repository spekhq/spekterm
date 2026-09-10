## Why

對話 view 與終端 view 的選擇目前是 **per-session** 的，而 dogfood 認定那是錯的：使用者同時開著
數個 agent session，要一個一個切，**而他從來不想讓它們不一樣**。

`agent-conversation-view` 當初把它寫成規格條款，理由是：

> **SHALL NOT 為全域設定** —— 使用者完全可能一邊以對話 view 看 agent、一邊以終端 view 用 shell。

**那個理由不成立。** shell 目標的 session **根本沒有對話 view 可選** —— `sessionViewOf`
（`MainStage.tsx:49`）對非 claude 目標一律回終端，而切換入口本身就以
`focused?.spawnTarget === 'claude'` 為條件（`SessionTabs.tsx:214`），同一份 spec 的另一條
requirement 也明文如此。那句話描述的情境**從來不是由 per-session 儲存所保障的**，
而這個 change 完全不動保障它的那個判定。它實際約束的只有「**兩個 agent session 各自不同**」。

**還有一條更硬的理由，來自另一份 spec。** `session-persistence` 要求持久化的內容
**SHALL 限於重建所必需的事實**，並逐項列舉（歸屬、spawn 目標、名字、順序、工作目錄、pty 標題）
—— **`view` 從來不在那張清單上**。把它寫進 `sessions.json` 當初就與那條有張力，本 change 是在
清償它。（也因此不需要 `session-persistence` 的 delta：移除是往合規的方向走。）

**寫下這一條的價值在於擋住下一次。** 那條 SHALL NOT 是一天前才封存的，理由寫得像是想過了；
沒有這份紀錄，下一個人會照著同一句話再把它改回去。

**這也是「全面改成自己刻的 UI」的前置條件。** 那個方向要求得出「這個 app 現在用哪一種呈現」，
而一個 per-session 的欄位在語彙上表達不了它 —— 沒有一個地方可以指。

## What Changes

- 對話／終端 view 的選擇改為**單一的全域偏好**，落盤於偏好設定檔而非 `sessions.json`。
  切換任何一個 agent session 的 view，**所有 agent session** 一起改變。
  （**「所有 agent session」不是「所有 session」** —— shell 目標仍然沒有對話 view，
  那條判定不動。）
- **切換的入口不動** —— 仍在分頁列上那顆按鈕，只是它的作用域從那一個變成全部。
- 持久化的 `view` 欄位**移除**。既有 `sessions.json` 裡的該欄位於讀取時忽略。
- **不做 per-session 覆寫**（見下方裁決）。
- **終端仍為預設，且仍不可移除。** 這個 change 不動預設值 —— 它讓「日後把預設翻成對話 view」
  這件事**變得表達得出來**，但那是另一個決定。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `agent-conversation-view`：「view 的選擇為 per-session，且跨重啟保留」整條替換為全域偏好，
  含它明寫的那句 SHALL NOT 與兩條 scenario。

## 要裁決的事：逃生口怎麼辦

終端 view 是**逃生口**。而它的用途比「對話 view 壞掉」廣得多 —— `agent-input-bridge` 有**三條**
requirement 把使用者**制度性地**推回終端 view：等待狀態未知時拒絕送出並指出可切到終端；
等待選擇（permission／plan 核准）時**明文 SHALL NOT 在對話 view 內提供作答入口**，只能指向終端；
送出後未確認時同樣指向終端。**也就是說每一次 permission 提示都是一次強制的切換，而它是
per-session 事件。**

全域化之後，為了回答 session A 的一個提示，B、C、D 全部被切走。**這是這個裁決真正的代價，
比「壞掉時多兩下」大。**

> 對**這台機器**衝擊有限：`agent-transcript-view` 的 tasks §11.5(f) 記著 `awaiting-choice`
> 在使用者的 `auto` 模式下日常走不到。但規格不是只為一台機器寫的，這一條要誠實列出來。

四個選項與裁決：

| | 代價 |
|---|---|
| **純全域**（採用） | 每一次 permission 提示、每一次「對話 view 讀不到內容」，都要把**全部** session 切走再切回 |
| 全域預設 ＋ 落盤的 per-session 覆寫 | **覆寫是一份看不見、會黏住、且沒有任何 affordance 可以檢視或清除的狀態** —— 使用者看到一個行為不一樣的 session，畫面上沒有任何東西告訴他為什麼，也沒有地方可以清掉它 |
| 全域 ＋ 不落盤、下次改動全域時自動清除的臨時覆寫 | 保住了逃生口的 per-session 性質，且不會跨重啟黏住。**但它讓「SHALL NOT 屬於個別 session」字面上不成立**，且「什麼時候會被清掉」是一條使用者看不見的規則 —— 換掉一種隱形狀態，得到另一種 |
| 全域 ＋ 壞掉時該 session 自動退回終端 | **這不是第三種模型，它就是 per-session 覆寫，只是寫入者從使用者換成系統** —— 承受上面同樣的批評，而且更糟：覆寫是隱形的。**且它與規格直接衝突**：`agent-transcript-stream` 明文要求讀不到內容時**必須於該 session 的呈現中被說明**，自動退回會把那份說明變成一次無聲的 view 切換，使用者只看到「它有時候自己跳回終端」 |

**採純全域。** 逃生口的性質沒有損失 —— 它仍然隨時按得到、仍然不可移除，只是作用域是全部。
而「兩個 agent session 的 view 會不一樣」這件事**在結構上表達不出來**，那正是 CLAUDE.md 那條
「『不接受某個東西』要由結構保證，不是由『沒有人再送它』保證」。

## Impact

主行程：

- `src/main/preferences-store.ts` —— 新增欄位、其 sanitize、**`parsePreferences` 的解構清單**、
  以及 **`setTerminalFont` 的保留**（後兩者見 design D1，它們是這個 change 最容易漏的兩處）。
- `src/main/session-store.ts` —— 移除 `PersistedSession.view`（型別、讀、寫、註解）。
- `src/main/ipc/settings.ts` —— 新增 `setAgentView` 的 handler。

renderer 與 preload：

- `src/preload/index.ts` —— `settings` namespace 的白名單。
- `src/renderer/src/shell/PreferencesProvider.tsx` —— 寫入方法與衍生值。
- `src/renderer/src/shell/terminal/sessions.tsx` —— 移除 `SessionState.view`、restore 的映射、
  **persist 的映射**、`setView`。
- `src/renderer/src/shell/terminal/SessionTabs.tsx` —— **切換入口本體**（四處讀 `focused.view`）。
- `src/renderer/src/shell/MainStage.tsx` —— `sessionViewOf` 與 `onSetView`。

測試與驗收：

- `src/main/preferences-store.test.ts`、`src/main/session-store.test.ts`。
- `scripts/probe-agent-view.mjs` —— 三條斷言反轉、一條新增、一次多餘的 toggle 移除、
  以及一段狀態還原（見 tasks §4）。
- **`scripts/probe-shell.mjs`** —— preload `settings` namespace 的**硬編白名單**。
  不加它，`probe:shell` 必紅，而 `docs/lessons/probes.md` 記著這件事已經發生過兩次。

**不動**：`session-persistence`（`view` 從來不在它的持久化清單上）、`terminal-preferences`
的設定介面（toggle 不搬進 Settings）、`workspace-app-shell`（其 preload 條款是通則、未列舉）。
