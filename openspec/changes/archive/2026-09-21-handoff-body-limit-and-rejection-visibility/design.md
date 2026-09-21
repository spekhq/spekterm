## Context

動機見 `proposal.md`。本節只記實作要吃的既有結構，以及**寫 proposal 之後補做的實測**。

**實測一（對照組）：交接的失敗不會發出作業系統通知，而既有的載體是假綠。**

`probe-intake.mjs:1539`「目標查無時發出通知」長期為綠。把它的 `before` 量測往後推 9 秒
（超過 `intake-notify.ts` 的固定合併窗 `WINDOW_MS = 4000`）之後：

```
[對照組] before=1 內容=["New handoff"]
✗ 目標查無時發出通知：前=1 後=1
```

那一則通知來自該段稍早接受的 intake，**與 `miss.json` 無關**。程式碼側可獨立推出同一結論：
`present()` 唯一的呼叫點是 `IntakeNotifier.arrived()`，`arrived` 唯一的來源是 `onArrival`，
而 `#emitArrival` 唯一的觸發點在 `deliver()` 成功新增紀錄之後（`intake-service.ts:257`
的註解自己寫著「六條非成功的返回路徑都不會走到這裡」）。`DeliverOutcome.notify` 是一個
只被寫入、從未被讀取的欄位。

**而 `intake-schema.ts:102` 的型別註解寫著「交接專屬的三種拒絕……因此它們會發通知」——
那句話描述的是一個從未存在的實作。** 假綠的三層：斷言、對照表、以及型別旁的註解。

**實測二：收件匣那一半也不足以讓使用者認出發生了什麼。** 拒絕的呈現只有一行彙整
（`IntakeOverlay.tsx:220-236`）：「N 則投遞被拒絕」＋一顆清除鈕。沒有類別、沒有時刻、
沒有來源、沒有目標。而說明原因的文案（`intake.rejectReason`，11 條，含
`TOO_LONG: 'too long to review'`）**在整個 repo 裡沒有任何消費者** ——
字典有、呈現沒接上，而字典完整性的守衛只驗兩份字典的 key 對齊，不驗 key 有沒有被用到。

⇒ 「交接的失敗對使用者可見」**兩半都不成立**：通知那一半沒有實作，收件匣那一半的內容
不足以識別是哪一件事失敗。使用者實際的回報是「收件匣沒看到剛剛的那份交接資料」。

**實測三：不設上限的下游代價，效能不是其中之一。**

| 情境 | 檔案 | `save()` 同步阻塞 | `project()`＋序列化 |
|---|---|---|---|
| 5,719 字元 × 50 則（真實量級） | 0.45 MB | 1.6 ms | 0.7 ms |
| 250,000 字元 × 10 則（極端） | 3.61 MB | 13.2 ms | 6.8 ms |

`save()` 是 `fs.writeFileSync` 整份重寫、`project()` 每次收件匣事件都把所有本文推過 IPC，
兩者都與累積總量成正比 —— 但在可預見的量級上都無感。**它們不構成訂上限的依據。**

**實測四：真正的約束在接手的 agent 讀不讀得完 —— 而門檻有三個，不是一個。**

預填的 prompt 是 `Read <contextPath>. Its fenced section …`（`agent-protocol-copy.ts:54-59`）。
以真實的 context 檔格式（`buildContext` 的兩道界線）造不同大小的檔案，用 **Claude Code 2.1.278**
的檔案讀取工具實讀：

| 內容 | 檔案 | 結果 |
|---|---|---|
| 20,000 字元 CJK（572 行） | 52 KB | **完整**，收尾界線在脈絡中 |
| 約 93,000 字元 ASCII（3,000 行） | 94 KB | **靜默截斷**於第 1,770 行，收尾界線（第 3,005 行）不在 |
| 100,000 字元 CJK（2,273 行） | 266 KB | **硬失敗**，整個讀取被拒，一個字都拿不到 |

三個獨立的門檻：

1. **檔案大小 256 KB** —— 超過即硬失敗（`File content exceeds maximum allowed size`）。
2. **單次讀取的 token 上限 25,000** —— 超過即截斷，這是**最常先咬到的那一個**：
   94 KB 的 ASCII 檔只讀到 57%。
3. 預設的行數上限 2,000 —— token 上限通常先到。

**第 2 個門檻正是那個失效**：它截斷而不失敗，於是收尾界線不進脈絡，「界線之外的不算數」
靜默失效，接手的 agent 拿到半份工作包 —— **本 change 要消滅的失效形狀換一個位置重現**。

**既有結構的四個約束：**

1. `IntakeStore` 的 loader 是 `if (version !== INTAKE_VERSION) return null` ——
   **bump 版本等於清空使用者的收件匣**。
2. **first-party 交接的本文只在一個地方呈現**：`IntakeOverlay.tsx:287-289`，在 `opened`
   清單之內（`:147` 過濾 `state === 'accepted' && sessionId`）。`:345` 的那個節點屬於
   `IntakeCard`，渲染的是**待處理項**，而交接從不停留於待處理。
3. `bodyOf()` 是本文唯一的 accessor，由 `intake-context-source.test.mjs` 與
   `probe-intake.mjs` 的跨行程逐字元斷言共同釘住 —— **但那條斷言讀的是 `IntakeCard` 那一列**
   （`probe-intake.mjs:194-197` 以 `intake.itemLabel` 定位），不是 `opened` 那一段。
4. `MAX_DELIVERY_BYTES = 512KB` 在 `intake-source.ts:49`，判定發生在 `readBounded`
   （`:62-80`），作用於**檔案**、且在 provenance 存在之前 —— 它分不出 first-party 與第三方。

**現況是一個有名字的裁決，不是疏漏。** `handoff-service.test.ts:287` 那條測試叫
「本文超過長度上限的交接被拒絕 —— **不因投遞者是自己的 agent 而放寬**」。本 change 推翻它，
因此論證責任是「為何那個裁決錯了」，不是「補一個遺漏」。

## Goals / Non-Goals

**Goals:**

- 交接的本文不再被一個為別條路徑訂的數字擋下，而換上的上限有第一性依據。
- agent 得知**所有**會導致拒絕的約束 —— 它沒有回饋管道，未被告知的約束就是死路。
- 交接路徑上**重送不會有不同結果**的失敗，使用者看得到**是哪一件、為什麼**，且看得到的
  痕跡活過重啟。
- 上面每一條都有一個跑紅過的對照組。

**Non-Goals:**

- 不為交接建立回饋管道（缺口照舊）。
- 不改第三方撰寫本文的上限與其依據。
- 不實作內容的過期（`expireContent()` 至今沒有 production 呼叫端 —— 既有缺口，
  spec 只承諾「內容 SHALL **可**過期」，本 change 不動它，但在 Risks 記下它與新上限的交互）。
- 不處理 `MISSING_ID` 以外任何既有拒絕代碼的語意。

## Decisions

### D1 上限依 `firstPartyBody` 分流，而 first-party 的依據換成「接手的 agent 讀得完」

`MAX_BODY_LENGTH = 4000` 的依據是收件匣的人類閘門（`intake-schema.ts:36` 的註解）。
`firstPartyBody` 的投遞不經那道閘，於是那個依據在這條路徑上不存在。

**但「因此不設上限」是錯的推論**（實測四）：上限的依據換了，不是消失了。新的依據是
**接手的 agent 必須能一次讀完整份 context 檔，收尾界線才進得了脈絡**。這條依據的性質與
舊的相反 —— 舊的保護的是人的注意力（調大只是讓人累），新的保護的是**協定的完整性**
（調大會讓交付靜默地只到一半）。

**數字由實測得出，所用的版本一併記載**（實測四，Claude Code 2.1.278）。它倚賴 agent 的檔案
讀取行為，而那是 CLI 的行為、不是本應用程式的行為 —— 與 `agent-handoff-source` 對注入機制的
要求同一條紀律。

**取值：20,000 字元。** 它是實測中**完整讀取成功**的那一格，不是某個門檻的換算 ——
三個門檻裡有兩個（token 與位元組）都不以字元計，任何換算都得先假設內容的組成。20,000 字元
在最壞情況（全 CJK）下是 52 KB，離 256 KB 與 25,000 token 兩道門檻都還有餘裕。

對照：今天那則被擋下的交接是 5,719 字元（新上限的 29%）；現行的 `MAX_BODY_LENGTH` 是 4,000
（新上限的 20%）。

> **第一版 design 的推算（「以 2,000 行推算約 108,933 字元」）是錯的** —— 它只看了行數那一個
> 門檻，而那是三個裡最寬的。**「實測，不要從語意推論」這條紀律在本 change 內部又兌現了一次。**

**效能不作為依據**（實測三）。把它寫進來會讓上限看起來可以「等硬體變快再調大」，
而那與真正的失效模式無關。

**其餘 authored 欄位的 `MAX_FIELD_LENGTH = 200` 不分流。** `title` 是清單裡的一行，
那**是**一個呈現預算，對兩條路徑同樣成立。**它同樣會產生 `TOO_LONG`**，因此它也必須
出現在自我介紹裡（見 D5）。

**尺度不變**（正規化之後的 UTF-16 code unit）。分流的是「套哪一個」，不是「怎麼量」。

### D1a 呈現：`opened` 那一段要補，不是要截

**第一版 design 在這裡判讀錯誤**：它以為 `:287` 是清單預覽、`:345` 是全文，於是要「截斷
`:287`、保留 `:345`」。實際相反（Context 第 2 點）——照那個做法，first-party 交接**唯一**
能讀到全文的地方會被截掉，而 `:345` 根本不會顯示交接。

因此：

- **`opened` 那一段不截斷。** 它上方的註解已經寫明理由：「到達即接受的交接沒有經過接受閘
  —— 於是『按下送出』是唯一的閘，而使用者要能讀到他正要送出的是什麼」。
- 長本文以**可捲動的容器**呈現，不以截斷處理。
- `opened` 那一段補上本文長度（`IntakeCard` 有、它沒有）—— 既有條文「呈現 SHALL 附上本文
  的長度」在 first-party 路徑上**目前沒有載體**，而本 change 讓這個訊號變得更重要。
- **`IntakeCard` 那一段一個字不改**（第三方路徑，上限仍是 4000）。

**跨行程的逐字元斷言目前只蓋到 `IntakeCard`。** 要改的是 `opened` 那一段，而它沒有那道
把關 —— 本 change SHALL 為它補一條同形的斷言，否則「交付逐字元等於呈現」在**交接**這條
路徑上從來沒有被驗過。

### D2 拒絕的分流判準改為「重送會不會有不同結果」

現行分流依失敗**發生在哪一層**：`handoff-service` 自己算出來的走 `service.reject()`，
共用的 `deliver()` 之內算出來的走一般拒絕路徑。那條界線與使用者的處境無關。

**`IntakeRejection` 有 11 個值**（`intake-schema.ts:102-120`），逐一分類：

| 判定 | 代碼 |
|---|---|
| **永久**（重送必然同樣失敗） | `TOO_LONG`、`TOO_LARGE`、`INVALID_ID`、`MISSING_ID`、`FIELD_TYPE`、`TARGET_NOT_FOUND`、`TARGET_AMBIGUOUS` |
| **暫時**（狀態改變後可能成功） | `MALFORMED`、`CAPACITY`、`PREFILL_UNAVAILABLE` |
| **看 outcome 而非 code** | `DUPLICATE` |

三個需要論證的邊界：

- **`PREFILL_UNAVAILABLE` 歸暫時。** 它取決於 `agentEventsEnabled()`，那是**使用者可以打開的
  偏好** —— 與 `CAPACITY`（清一清收件匣就過）同類。判準因此收緊為「同一份投遞、
  **在使用者不改變任何設定的情況下**重送」。（既有 spec 把它列在可見失敗之中，
  本 change 的 delta 一併調整並說明。）
- **`DUPLICATE` 是兩種行為共用一個代碼**：同內容靜默（`intake-service.ts:217-219`、`:247-249`），
  不同內容＝識別碼搶佔則是明文的可見拒絕（`:221-224`、`:250-252`）。
  **⇒ 分類函式的定義域 SHALL 是 `DeliverOutcome`（code ＋ 既有的 `notify` 語意），
  不是 `IntakeRejection`。** 以 code 為定義域分辨不出這兩者，而搶佔那一半會落進「不是失敗」。
- **`MISSING_ID` 第一版漏了。** 一張用來論證「exhaustive switch 才擋得住遺漏」的表自己漏了
  一個成員 —— 這正是它要防的事，記在這裡作為它存在理由的證據。

**這個函式決定的是通知與痕跡，SHALL NOT 決定 `consume`。** 既有程式碼有反例：
`handoff-service.ts:105-107` 對放錯位置的檔案回 `MALFORMED` 且 `consume: true`
（否則它每次掃描都再走一趟）。把 `consume` 綁進這個判準會把那條路改壞。

以 **exhaustive switch** 實作（無 `default`），並補一道原始碼守衛擋 `default:`
—— 「臨時加一個列舉值看 typecheck 會不會紅」是一次性驗證，不是常駐載體。

### D3 通知的接線放在**知道 adapter 身分**的位置，不在 `HandoffService`

**第一版 design 把接線放在 `HandoffService.deliverFile()`，那擋不到 `TOO_LARGE`。**
`intake-source.ts:205-213` 在 `readBounded` 超限時直接 `rejectOversize` + `rm` + `return`，
而 `#deliver`（交接注入的 callback）在第 220 行 —— **結構上到不了**。而 delta 有一條
scenario 明文要求「交接因投遞過大而被拒絕 → 發出通知」。

接線因此放在 `IntakeSource`：它持有 `#adapter`，判得出這是不是 `HANDOFF_ADAPTER`，
且**兩條拒絕路徑都經過它**。

**不能把所有拒絕接上通知**：`agent-intake` 有「被拒絕的投遞 SHALL NOT 發出作業系統通知」，
交接是它**明文的例外**。把接線放在共用路徑而不看 adapter，Slack 的每一則格式錯誤都會跳通知。

**通知的內文與既有 requirement 衝突，必須一併解決。** `agent-intake` 明文：通知內文
「SHALL 只由系統文案與來源標籤、發起者、intake 的標題構成」「SHALL NOT 含任何路徑、
folder 名稱或識別碼」，且三者取自**已正規化**的值。而一則失敗**沒有 `Intake`**
（`parseIntake` 失敗或根本沒跑），三個欄位不存在；`buildPayload` 的型別就是 `IntakeRecord[]`。
處置：**失敗的通知內文只由系統文案與拒絕的類別構成**（`intake.rejectReason` 那 11 條已經
寫好且不含第三方內容），**不含目標原字串** —— 那是一個 folder 名稱，正落在禁止之列。
使用者要知道是哪一件事，去收件匣看痕跡（D4）。

**合併通知的目的地也要處理。** 目的地由 `keys` 決定（`index.ts:385-395`：
`keys.length === 1 && state === 'accepted' ⇒ focusSession`，其餘 `openInbox`）。
失敗沒有 `(adapter, id)` 主鍵（D4 刻意不做成 record）⇒ 一則失敗與一則成功交接落在同一個窗時
會變成 `keys.length === 1` ⇒ **聚焦 session，失敗再度不可見**。
處置：批次中含有任何**失敗**時，效果 SHALL 為打開收件匣 —— 與既有「含待處理項時打開收件匣」
同一條理由。`index.ts:380-384` 的註解（「失敗的項目（那些仍是待處理）」）同時要改，
它的前提被 D4 拿掉了。

### D4 痕跡落在 `#notices`，不落成一則 `IntakeRecord`

**否決「永久性拒絕成為 `state: 'failed'` 的 record」**：`IntakeRecord` 帶著待處理的語意 ——
進 `pendingCount()`、進保留期、進去重。一則使用者**無法處理**的失敗放進那條管線，
等於在收件匣裡放一件永遠做不完的事。

痕跡要擴三個欄位：**發生時刻**、**來源 session 的標籤**、**投遞者寫下的目標原字串**。

**第三個欄位在失敗發生的位置拿不到，這要一併解決。** `deliver()` 只拿得到 `provenance`
（origin kind/id/label ＋**已解析的** `targetFolderId`），沒有原始目標字串；而對 `TOO_LONG`
（本 change 的起因）而言尤其如此。處置：由 **adapter** 在呼叫端把它交進來（交接算得出它，
它就在 `parseHandoffPayload` 的結果裡），**不讓共用的攝入路徑去讀 `raw.target`** ——
那會破壞「payload 自稱的一律不採信」的姿態。

**該欄位是未正規化的第三方字串。** `parseHandoffPayload` 不呼叫 `normalizeAuthored`，
而今天它只躺在 `notice.key` 裡從未被渲染。本 change 讓它被渲染、被落盤 ⇒
**它 SHALL 在進入痕跡時正規化，與 authored 欄位同一個位置、同一套白名單**。
（它不進通知 —— 見 D3。）

**合併規則要補兩件事**（`intake-service.ts:139-153` 目前同 `key + code` 只 `count += 1`）：
加上時刻之後**保留最後一次**（使用者要知道「還在發生」），溢位桶的 key 是字面的 `'…'`
—— 落盤＋呈現之後它會變成畫面上的一個字，要換成一個可翻譯的呈現。

**落盤不得 bump `INTAKE_VERSION`** —— loader 是 `version !== INTAKE_VERSION ⇒ return null`，
bump 會把收件匣全部丟掉。新區段以 optional 欄位加入。已驗證回滾安全：舊版讀到多一個區段時
走逐欄位白名單（`intake-store.ts:113-131`）原樣丟棄，`entries` 一則不少。

**作用域比 proposal 原本描述的大**：`#notices` 住在 `IntakeService`，**所有 producer 共用**。
Slack 與共用落點的永久性拒絕也會跨重啟保留。這是對的（同一條理由），但因此
**Slack 的高頻格式錯誤可能把 `MAX_NOTICES = 20` 吃光、把交接的失敗擠進「其餘」那一桶** ——
那會讓本 change 的主目的在真實使用中失效。處置：痕跡的保留 SHALL 以 adapter 分配額度，
或對交接的失敗給予不被擠出的位置。

### D4a 呈現要能識別是哪一件事失敗

現況只有「N 則投遞被拒絕」＋清除鈕。痕跡有了欄位之後，呈現 SHALL 逐則說明
**類別、時刻、來源、目標原字串**。`intake.rejectReason` 那 11 條文案已經寫好，接上即可。

**清除鈕目前是一次清光全部**（`clearNotices()`）。逐則之後 SHALL 得逐則清除 ——
否則使用者為了清掉一則 Slack 的格式錯誤，會順手清掉他還沒處理的交接失敗。

### D5 自我介紹的約束從常數推導，不手寫

自我介紹漏掉長度上限，與一份「憑印象填的對照表」是同一個形狀：**一份手寫的、宣稱自己完整的
清單**。對策不是「這次記得寫全」，而是讓它沒有機會分岔 —— `introText()` 從實際生效的常數
推導那幾行字，**而不是把數字寫進字串**。

**第一版 design 在這裡重演了它自己診斷的錯誤**：它列了「兩塊」要新增的內容，而漏了
`MAX_FIELD_LENGTH = 200` 對 `title` 的上限（D1 明文決定它不分流，且它同樣產生 `TOO_LONG`）。
現在的清單是三塊：

- 本文的長度上限（first-party 的那個值，由常數推導）。
- `title` 的長度上限（由常數推導）。
- 投遞的大小上限（`MAX_DELIVERY_BYTES`，在 **`intake-source.ts`**，不在 `intake-schema`）。
- 一則交接**可能失敗**、投遞者不會被告知、該次失敗呈現於收件匣。

**載體不是「改動常數後看輸出變不變」**（`export const` 在測試裡改不了）。載體是兩條：
輸出含由常數推導出的值，**加上一道原始碼守衛**擋那些數字以字面值出現在 `handoff-intro.ts`。

自我介紹仍是英文、不進字典、受 CJK 守衛約束。

### D6 probe 的鑑別力：`before` 必須量在靜止點

假綠的一般形式：**任何「事件數增加了」的斷言，其 `before` 必須量在一個靜止點**，
而固定合併窗（`WINDOW_MS = 4000`）讓「靜止」不是自動成立的。

修法不是插一個固定等待（原始碼守衛擋的正是那個），而是**先等到通知數穩定**再量 `before`，
並讓斷言比對**通知的內容**而不只是數量 —— `["New handoff"]` 這個對照組輸出本身就說明了：
數量是一個方便取得的量，內容才是規格在乎的。

這條要寫進 `docs/lessons/probes.md`，它不限於交接。

## Risks / Trade-offs

- **新上限的依據倚賴 agent CLI 的行為，而那會變。** → 實測結論與版本一併記載（D1），
  並在 `docs/lessons/handoff.md` 標明重測的時機。這與整個交接能力押在「注入的內容確實進入
  脈絡」上是同一類依賴，已有先例可循。
- **本文放寬後，`expireContent()` 沒有呼叫端這個既有缺口的後果變大**（本文永久累積）。
  → 量測顯示在可預見的量級上無感（實測三）；不在本 change 處理，但記為缺口。
- **痕跡落盤後會累積。** → 沿用 `MAX_NOTICES` 合併與溢位桶，並加上 adapter 額度（D4）。
- **失敗的通知不含目標原字串**（受既有 requirement 約束）⇒ 使用者從通知本身看不出是哪一件。
  → 通知的效果是打開收件匣（D3），痕跡在那裡逐則可讀（D4a）。
- **D2 的 exhaustive switch 會在下一次新增拒絕代碼時擋住編譯。** → 那是它的目的。

## Migration Plan

1. 無資料遷移：上限放寬是單向的，既有已落盤的 intake 不受影響。
2. `intake.json` 以 optional 區段加入痕跡，**不 bump 版本**（D4），並以一條「不含該區段的
   既有檔案載入後 entries 一則不少」的測試釘住。
3. 回滾即還原程式碼：舊版讀到帶新區段的 `intake.json` 時走逐欄位白名單丟棄，
   **回滾不會清空收件匣**（已於 `intake-store.ts:113-131` 驗證）。
4. `handoff-service.test.ts:287` 那條測試（「不因投遞者是自己的 agent 而放寬」）
   在 D1 落地的同一個 commit 反轉，否則 `npm test` 當場紅。
