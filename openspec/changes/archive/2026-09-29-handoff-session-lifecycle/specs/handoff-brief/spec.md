## Purpose

由交接建立的 session 攜帶它的交接單（標題、來源、到達時間、本文），讓使用者在交接送出之後的任何時刻
都說得出「這個 session 是在做哪一件事」，而不必回頭問 agent。

## ADDED Requirements

### Requirement: 由交接建立的 session 於建立當下保存它的交接單

由 agent 發起的交接所建立的 session SHALL 於**建立當下**保存一份交接單，含該則交接的標題、本文與
到達時間。交接單的內容 SHALL 取自**攝入時正規化過的那一份**，與收件匣的呈現、交給 agent 的內容是
同一個值。

交接單 SHALL 於 agent 行程啟動**之前**寫入，且 SHALL 由主行程寫入；renderer SHALL NOT 有任何途徑
寫入或改變它。

**交接單的保留期限 SHALL 等於該 session 的存在。** 它 SHALL NOT 因收件匣將該則交接了結、或該則
交接的內容被收件匣移除（保留期限屆滿）而消失；session 不再存在時它 SHALL 隨之移除。**session 已建立
而尚未被納入持久化的 session 清單的期間**，它 SHALL NOT 被當作孤兒清除。

交接單 SHALL 跨應用程式重啟與 renderer 重新載入保留。損毀的交接單 SHALL 被丟棄而 SHALL NOT 使該
session 或它的母子關係消失；本文無法取得時，交接單 SHALL 仍呈現其餘可取得的部分並說明本文無法取得。

使用者接受的第三方 intake 所建立的 session **不在本條範圍內**（它沒有來源 session）。

#### Scenario: 交接建立的 session 帶有交接單

- **WHEN** session P 投遞一則標題為 T 的交接，因而建立 session C
- **THEN** C 的交接單的標題為 T，本文逐字元等於交給 C 的 agent 的 context 檔中界線之內的內容，並帶有該則交接的到達時間

#### Scenario: 收件匣移除內容之後交接單仍在

- **GIVEN** session C 由一則交接建立
- **WHEN** 收件匣移除了該則交接的內容
- **THEN** C 的交接單仍可取得，且內容不變

#### Scenario: 交接單跨重啟保留

- **GIVEN** session C 由一則交接建立
- **WHEN** 應用程式重新啟動
- **THEN** C 被還原，且它的交接單內容不變

#### Scenario: 尚未納入持久化的 session 其交接單不被清除

- **GIVEN** session C 剛由一則交接建立，renderer 尚未把它送來持久化
- **WHEN** 此時 session 清單被另一次持久化改寫
- **THEN** C 的交接單仍可取得

#### Scenario: 損毀的交接單不使 session 消失

- **GIVEN** 落盤中 session C 的交接單格式損毀
- **WHEN** 應用程式啟動
- **THEN** C 仍呈現於 rail，其母子關係照常呈現

#### Scenario: session 關閉之後交接單隨之移除

- **WHEN** 使用者關閉 session C
- **THEN** C 的交接單不再存在於磁碟上

### Requirement: 交接單的本文只經以 session 識別碼查詢的通道送往 renderer

交接單的本文 SHALL NOT 隨 session 清單的還原或任何廣播送往 renderer；renderer SHALL 只能以一個
session 識別碼查詢它，主行程 SHALL 只對存在且帶有交接單的 session 回應本文。該通道 SHALL NOT
接受路徑或任何可解析為檔案位置的參數。

本文最長兩萬字元、且每一個交接 session 都有一份 —— 隨每次還原整批送往 renderer，等於把每個交接的
全文持續放在一個只需要標題的地方。

#### Scenario: 還原的 session 清單不含本文

- **WHEN** renderer 還原 session 清單，其中有一個帶交接單的 session
- **THEN** 還原得到的資料中不含該交接的本文

#### Scenario: 查詢不存在的 session 不回傳本文

- **WHEN** renderer 以一個不存在的 session 識別碼查詢交接單
- **THEN** 查詢結果不含任何本文

### Requirement: 由交接建立的 session 其標籤預設為交接的標題

帶有交接單的 session，其標籤 SHALL 預設為交接單的標題（取用順序見 `terminal-sessions`）。
使用者指定的名稱 SHALL 優先於它；使用者清空名稱 SHALL 使標籤回到交接的標題。

**交接的標題為空或只含空白時 SHALL NOT 參與取用順序**，標籤依序退回下一個來源。

提供給 agent 的關係中該 session 的標籤、以及交接攝入時記下的來源標籤快照，SHALL 採用同一個取用順序。

#### Scenario: 交接建立的 session 以交接標題為標籤

- **WHEN** 一則標題為 T 的交接建立了 session C
- **THEN** C 於分頁與 rail 子列的標籤皆為 T

#### Scenario: 使用者改名後清空回到交接標題

- **WHEN** 使用者把 C 重新命名為 N，再把名稱清空
- **THEN** C 的標籤回到 T

#### Scenario: 空白的交接標題不使標籤變成空白

- **WHEN** 一則標題為空的交接建立了 session C，C 的 pty 宣告了終端標題 X
- **THEN** C 的標籤為 X

#### Scenario: agent 從關係中看到的子 session 標籤是交接標題

- **WHEN** C 的母 session P 查詢自己的關係
- **THEN** 結果中 C 的標籤為 T

#### Scenario: 子 session 再交接時記下的來源標籤是交接標題

- **WHEN** C 投遞一則交接，因而建立 session D，其後使用者關閉 C
- **THEN** D 的來源標示呈現 T

### Requirement: 使用者可隨時打開一個 session 的交接單

帶有交接單的 session SHALL 提供一個可見的入口，觸發它 SHALL 呈現交接單：標題、來源（沿用來源標示
的文字與跳轉）、到達時間、本文全文，以及該 session 的**最新結果**與其時間（若有，見
`handoff-completion`）。

本文與結果 SHALL 以純文字呈現，與收件匣呈現本文的方式相同。入口 SHALL 同時存在於 rail 的
session 子列與主舞台的 session 分頁（右鍵選單）上，且 SHALL 可全鍵盤操作。觸發入口 SHALL NOT
同時觸發它所在那一列的選取或聚焦。

呈現交接單的介面 SHALL 為一個對話框（遵守 `[role="dialog"]` 的慣例，於是快捷鍵抑制規則自動適用）。

#### Scenario: 送出之後仍打得開交接單

- **GIVEN** 一則交接建立了 session C，且第一則 prompt 已被送出
- **WHEN** 使用者觸發 C 的交接單入口
- **THEN** 呈現的對話框含該則交接的標題、來源、到達時間與本文全文

#### Scenario: 本文以純文字呈現

- **WHEN** 交接的本文含 markdown 語法與 HTML 標籤
- **THEN** 交接單中它們以原文字元呈現，未被轉譯為格式或元素

#### Scenario: 觸發入口不改變選取

- **GIVEN** rail 上選中的是另一個 folder
- **WHEN** 使用者自 rail 觸發 C 的交接單入口
- **THEN** 交接單對話框呈現，且 rail 上選中的項目與 focused session 未改變

#### Scenario: 沒有交接單的 session 沒有入口

- **WHEN** 使用者自己建立的 session 呈現於 rail
- **THEN** 該 session 沒有交接單的入口
