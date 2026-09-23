## RENAMED Requirements

- FROM: `### Requirement: 接受一則 intake 於解析出的 folder 建立 agent session`
- TO: `### Requirement: 接受一則 intake 於確認的 folder 建立 agent session`

## ADDED Requirements

### Requirement: 已開好的項目只在它的本文仍需要被看時呈現於收件匣

已接受且已建立 session 的項目 SHALL 呈現於收件匣（連同本文全文、本文長度、它開在哪個 folder），
直到下列任一成立為止：

1. 該 session 的第一則 prompt **已被送出**；
2. 使用者**逐則清除**它；
3. 該 session **已不存在**，或它所在的 folder 已不在 workspace 中；
4. **應用程式重新啟動** —— 預先填入而尚未送出的 prompt 住在 pty 的輸入處，而 pty 不會活過
   應用程式；重新啟動之後被還原的 session 裡已經沒有那一則 prompt 可以送出。

任一成立之後，該項目 SHALL NOT 再呈現於收件匣。第 1、2、4 者 SHALL 落盤並跨應用程式重啟保留。

**第 4 者 SHALL 於啟動時、任何新的 intake 被接受之前判定**：啟動之前接受的項目一律了結，
啟動之後接受的不受影響。少了這一條，重新啟動之後沒有送出的項目只剩手動清除一條出口，
而它們會一次次累積 —— 那正是使用者回報的問題。

**「已被送出」SHALL NOT 由一個無法分辨的狀態推定。** 判定的後果是持久的 —— 對到達即建立
session 的交接，它把本文從唯一的呈現位置移除，而且沒有復原的入口。等待狀態落回「未知」時
SHALL NOT 視為已送出。

一則已了結的項目**再次被接受**時（預填逾時退回待處理之後），其了結標記 SHALL 被清除 ——
否則它一建立 session 就從這一段消失，使用者看不到他正要送出的本文。

**這一段存在的理由是「按下送出之前看得到本文全文」** —— 到達時即被接受的交接只在這裡呈現
本文，而「按下送出」是那條路徑上唯一的閘。離開的條件因此由那個理由推導：送出之後、或 session
已不存在時，那個理由已不成立。**SHALL NOT 以經過的時間為條件** —— 交接到達時使用者可能不在
電腦前，一個時間窗會讓本文在送出之前就從它唯一的呈現位置消失。

呈現的 folder SHALL 為**該 session 所在的 folder**，SHALL NOT 為重新求值的解析結果 ——
接受時使用者確認的 folder 可以與解析結果不同，而規則也可能在接受之後改變。

不再呈現 SHALL NOT 等同刪除：該則 intake 的狀態仍為已接受，去重鍵照常保留。
清除 SHALL NOT 影響該 session。

#### Scenario: 送出之後不再呈現，且跨重啟保持

- **GIVEN** 一則已建立 session 的項目呈現於收件匣
- **WHEN** 使用者於該 session 送出預先填入的 prompt
- **THEN** 該項目不再呈現於收件匣
- **AND** 應用程式重新啟動之後，該項目仍不呈現

#### Scenario: 尚未送出且 session 仍存在時持續呈現

- **GIVEN** 一則已建立 session 的項目，其 prompt 尚未送出
- **WHEN** 使用者打開收件匣
- **THEN** 該項目呈現於收件匣，含其本文全文

#### Scenario: 逐則清除只清掉那一則，且跨重啟保持

- **GIVEN** 兩則已建立 session 的項目呈現於收件匣
- **WHEN** 使用者清除其中一則
- **THEN** 收件匣只呈現另一則
- **AND** 被清除那一則的 session 仍然存在
- **AND** 應用程式重新啟動之後，收件匣仍只呈現另一則

#### Scenario: 應用程式重新啟動後，尚未送出的項目不再呈現

- **GIVEN** 一則已建立 session 的項目呈現於收件匣，其 prompt 尚未送出
- **WHEN** 應用程式重新啟動
- **THEN** 該項目不再呈現於收件匣
- **AND** 它的 session 仍被還原，且該則 intake 的狀態仍為已接受

#### Scenario: session 已不存在時不再呈現

- **GIVEN** 一則已建立 session 的項目呈現於收件匣
- **WHEN** 使用者關閉該 session
- **THEN** 該項目不再呈現於收件匣

#### Scenario: session 所在的 folder 已被移出 workspace 時不再呈現

- **GIVEN** 一則已建立 session 的項目呈現於收件匣
- **WHEN** 使用者把該 session 所在的 folder 移出 workspace
- **THEN** 該項目不再呈現於收件匣

#### Scenario: 呈現的 folder 為 session 所在的 folder

- **GIVEN** 一則 intake 的 routing 解析到 folder A，使用者改選 folder B 並接受
- **WHEN** 已建立 session 的項目呈現於收件匣
- **THEN** 呈現的 folder 名稱為 **B**

#### Scenario: 等待狀態落回未知不視為已送出

- **GIVEN** 一則已建立 session 的項目，其 prompt 已填入而尚未送出
- **WHEN** 該 session 的等待狀態由就緒落回未知
- **THEN** 該項目仍呈現於收件匣

#### Scenario: 清除過而退回待處理的項目再次接受後重新呈現

- **GIVEN** 一則已建立 session 的項目在預填發生之前被使用者清除，其後預填逾時而退回待處理
- **WHEN** 使用者再次接受它
- **THEN** 該項目呈現於已建立 session 的那一段

#### Scenario: 清除之後去重仍然有效

- **GIVEN** 一則已接受的 intake 已被清除
- **WHEN** producer 以同一個識別碼再投遞一次
- **THEN** 該次投遞仍被視為重複而拒絕

### Requirement: 收件匣中的每一則呈現它發生的時間，且依該時間新的在上

收件匣中的待處理項目與已建立 session 的項目 SHALL 各自呈現**它發生的時間**，且兩段 SHALL 各自
依該時間**由新到舊**排列。

**發生的時間**為投遞宣告的發生時間；投遞未宣告時，為它**到達**收件匣的時間。
**投遞宣告的發生時間晚於它到達的時間時，SHALL 以到達的時間為準** —— 一件事不可能在它被收到之後
才發生，而那個欄位是投遞者撰寫的：不設這道上限，任何一份投遞都能宣告一個未來的時刻，把自己
釘在收件匣的最上面。

到達的時間不等於發生的時間：應用程式關閉期間發生的事，於下次啟動時一次回補進來 —— 以到達時間
呈現的話，昨天的事會顯示成「剛剛」，而一整批回補的項目看起來同時發生。

時間 SHALL 以**完整的日期與時刻**呈現，SHALL NOT 以相對時間呈現；SHALL 以使用者選擇的語言
格式化。

#### Scenario: 待處理項目依發生時間新的在上

- **GIVEN** 三則 intake 於同一次回補中到達，各自宣告的發生時間不同
- **WHEN** 使用者打開收件匣
- **THEN** 待處理項目依宣告的發生時間由新到舊呈現

#### Scenario: 每一則呈現發生時間的完整日期與時刻

- **WHEN** 一則宣告了發生時間的項目與一則未宣告的項目呈現於收件匣
- **THEN** 前者呈現其宣告的發生時間、後者呈現其到達時間
- **AND** 兩者皆為完整的日期與時刻，而非相對時間

#### Scenario: 已建立 session 的項目同樣新的在上

- **GIVEN** 兩則已建立 session 的項目發生於不同時間，其 prompt 皆尚未送出
- **WHEN** 使用者打開收件匣
- **THEN** 較晚發生的那一則排在前面

#### Scenario: 宣告的發生時間晚於到達時間時以到達時間為準

- **GIVEN** 一則投遞宣告的發生時間在未來
- **WHEN** 它呈現於收件匣
- **THEN** 它呈現的時間與排序依據皆為它到達的時間

## MODIFIED Requirements

### Requirement: 欄位分為可驗證與第三方撰寫兩類，來源專屬的原始內容既不判斷也不交付

intake 的欄位 SHALL 分為三組：

1. **接收端可驗證的**（adapter、來源種類、來源座標的識別碼、**接收端已解析出的目標 folder**）
   —— 由接收 adapter 從自己已驗證的 metadata 填入。
2. **第三方逐字撰寫的**（標題、本文、發起者、來源座標的標籤、**發生時間**）—— 投遞者完全控制。
3. **來源專屬的原始內容** —— 原封保存，供日後診斷。

**這個區分 SHALL 落在型別上。** 少了它，「以標題判斷要開在哪個 repo」會在介面上看起來與「以來源
channel 判斷」同樣可靠，而前者完全由投遞者決定。

**「接收端已解析出的目標 folder」SHALL 為可不存在的欄位**，且 SHALL NOT 能由投遞內容表達 ——
它由 adapter 以自己的依據解析而得（例如 `agent-handoff-source` 的查表），與 `adapter` 欄位同一個
姿態：**payload 自稱的一律不採信**。若它能被投遞內容表達，則放進共用投遞落點的任何一份檔案都能
繞過 routing 自行選擇 folder，而那道機制存在的理由正是「投遞者不得選擇他落在哪個工作目錄」。

第三組 SHALL NOT 出現在收件匣以內任何模組的型別中，SHALL NOT 被解讀為任何判斷依據，
**且 SHALL NOT 被交付給 agent** —— 交付一份使用者沒有看過的文字，等同讓投遞者在被審閱的內容
之外另開一條通道。

**來源座標 SHALL 為通用的形狀**（種類、識別碼、標籤），SHALL NOT 以任何單一來源的詞彙定義。

**發生時間 SHALL 為可不存在的欄位**，其值 SHALL 為一個可解析的時刻；投遞宣告了它而它不可解析時，
該份投遞 SHALL 以欄位型別不符被拒絕。它是投遞者撰寫的，因此 SHALL NOT 被解讀為任何判斷依據
（routing 不比對它）；它只用於呈現與排序，且其效力受「收件匣中的每一則呈現它發生的時間」的
上限約束。

#### Scenario: 原始內容不出現在收件匣以內的型別中

- **WHEN** 檢視收件匣解析結果所使用的型別
- **THEN** 其中不存在來源專屬原始內容的欄位

#### Scenario: 原始內容不進入交給 agent 的檔案

- **WHEN** 一則 intake 的來源專屬原始內容中含有一段獨特的字串，而該字串不出現在本文中
- **AND** 該則 intake 被接受
- **THEN** 交給 agent 的檔案不含該字串

#### Scenario: 未知的來源種類仍可被處理

- **WHEN** 一則 intake 的來源種類是系統不認得的值，但其餘通用欄位齊備
- **THEN** 該則 intake 正常進入收件匣並可被接受

#### Scenario: 投遞內容無法表達已解析的目標 folder

- **WHEN** 一份放進共用投遞落點的 JSON 中含有指定目標 folder 的欄位
- **THEN** 該欄位被丟棄，該則 intake 的目標仍由 routing 規則決定

#### Scenario: 宣告了不可解析的發生時間的投遞被拒絕

- **WHEN** 一份投遞宣告的發生時間不是可解析的時刻
- **THEN** 該份投遞以欄位型別不符被拒絕，且不進入收件匣

#### Scenario: 未宣告發生時間的投遞照常進入收件匣

- **WHEN** 一份投遞未宣告發生時間，其餘通用欄位齊備
- **THEN** 該則 intake 正常進入收件匣

### Requirement: intake 有生命週期，跨重啟保留，且去重鍵與內容各有其保留期限

一則 intake SHALL 恰處於**待處理**、**已接受**、**已忽略**三種狀態之一，狀態 SHALL 落盤並跨
應用程式重啟保留。忽略一則 intake SHALL NOT 建立任何 session。

**已接受的 intake SHALL 記錄它建立的 session 識別碼**，使「這個 session 從哪來」在該則仍呈現於
收件匣時看得見（呈現的期間見「已開好的項目只在它的本文仍需要被看時呈現於收件匣」）。
該關聯 SHALL 只存在 intake 這一側，SHALL NOT 寫入 session 的持久化紀錄。

**已接受的 intake 另 SHALL 能被標記為「已了結」**（prompt 已送出，或使用者已清除它）。該標記
SHALL NOT 構成第四種狀態 —— 它的狀態仍為已接受 —— 且 SHALL NOT 影響去重。以新的狀態表達它，
會讓不認得該狀態的版本整筆丟棄那些紀錄，連同它們的去重鍵。

**去重鍵與內容的保留期限 SHALL 分開規定**：去重鍵（adapter、識別碼、狀態）SHALL 永久保留 ——
清除它等同放棄對該識別碼的去重；內容（通用欄位、保存的投遞、交給 agent 的檔案）SHALL 可過期。
少了這個區分，狀態檔會單調成長，而它在每次投遞時被整份重寫。

#### Scenario: 已忽略的狀態跨重啟保留

- **WHEN** 使用者忽略一則 intake，應用程式其後重新啟動
- **AND** 投遞落點此時為空
- **THEN** 該則 intake 存在且狀態為已忽略

#### Scenario: 已接受與待處理在同一次重啟後各自保持

- **WHEN** 收件匣中有一則已接受與一則待處理的 intake，應用程式重新啟動
- **THEN** 前者狀態為已接受、後者狀態為待處理

#### Scenario: 忽略不建立 session

- **WHEN** 使用者忽略一則待處理的 intake
- **THEN** 該則 intake 轉為已忽略
- **AND** session 的總數與忽略之前相同

#### Scenario: 內容過期之後去重仍然有效

- **WHEN** 一則已接受的 intake 其內容已被清除
- **AND** producer 以同一個識別碼再投遞一次
- **THEN** 該次投遞仍被視為重複而拒絕

#### Scenario: 已了結的項目狀態仍為已接受

- **WHEN** 一則已接受的 intake 被標記為已了結，應用程式其後重新啟動
- **THEN** 該則 intake 存在且狀態為已接受

### Requirement: 接受一則 intake 於確認的 folder 建立 agent session

**建立一個由 intake 觸發的 session 時**（使用者接受一則待處理的 intake，或一則到達時即被接受的
項目），系統 SHALL 於該則 intake 的**目標 folder** 建立一個 **agent 目標**的 session。目標 folder
為：使用者接受時**確認的** folder（見 `intake-routing`「接受時由使用者確認目標 folder，系統不替他
補預設值」）；到達時即被接受的項目為**接收端解析出的** folder。

session SHALL 經與使用者手動建立時**相同的路徑**建立 —— 於是它一樣進入 session 清單、一樣被
持久化、一樣可被關閉與重建。系統 SHALL NOT 以繞過該路徑的方式建立 pty，亦 SHALL NOT 為此擴充
該路徑所接受的參數。

**本條的作用域以「session 由 intake 觸發」為準，不以「使用者按下接受」為準** —— 否則一條到達時
即接受的路徑會在字面上不受本條約束，而它建立 pty 的方式正是本條要管的事。

**系統 SHALL NOT 代使用者指定該 session 的名稱** —— 指定名稱在既有能力中被定義為「使用者永久
接管命名權」，此後 agent 依任務產生的終端標題將被靜默地不予呈現。由系統代為指定，等於替使用者
按下一個只有他能按的開關，而他不會知道要如何還原。

**由 intake 建立的 session，其啟動參數 SHALL 與同一個 folder 手動建立者等價**：除了對話識別碼
與系統注入設定的位置之外**逐項相同**，且參數的**個數相同**。系統注入的 agent 設定，其頂層欄位
**SHALL 恰為**既有注入所定義的那一組。

**兩處都刻意寫成等價／白名單而非「不得含某些值」**：後者是黑名單，只擋得住列舉得出來的東西，
而它在今日恆真（啟動路徑根本沒有能加旗標的參數）——**一條恆真的斷言撐不住任何東西**。

**本能力 SHALL NOT 宣稱它保證了 agent 的許可姿態。** 那由使用者自己的設定與**目標 repo 自己的
設定**決定，而目標 repo 是由 routing 或使用者選出的 —— 本能力保證的是「不降低它」，不是「它夠緊」。

#### Scenario: 於解析出的 folder 建立，而不是於選中的或第一個 folder

- **WHEN** workspace 中有三個 folder，rail 上選中的是第三個，routing 規則解析到第二個，使用者
  未改選即接受
- **THEN** 新的 agent session 建立於**第二個** folder，且出現在該 folder 的 session 清單中

#### Scenario: 由 intake 建立的 session 與手動建立者一同被重建

- **WHEN** 同一個 folder 中有一個由 intake 建立與一個手動建立的 agent session，應用程式重新啟動
- **THEN** 兩者都被重建

#### Scenario: session 的名稱未被系統指定

- **WHEN** 一則 intake 被接受並建立 session，其後 agent 宣告一個終端標題
- **THEN** 該標題最終呈現於該 session 的標籤上

#### Scenario: 啟動參數與手動建立者等價

- **WHEN** 於同一個 folder 各建立一個由 intake 觸發與一個手動觸發的 agent session
- **THEN** 兩者的啟動參數在去除對話識別碼與注入設定位置之後完全相同
- **AND** 兩者的參數個數相同

#### Scenario: 注入設定的頂層欄位未因本能力而增加

- **WHEN** 一則 intake 被接受並建立 session
- **THEN** 系統注入的 agent 設定，其頂層欄位集合與手動建立時相同

#### Scenario: 到達時即接受者其啟動參數同樣等價

- **WHEN** 一則到達時即被接受的交接建立了 session，同一個 folder 另有一個手動建立的 agent session
- **THEN** 兩者的啟動參數在去除對話識別碼與注入設定位置之後完全相同

### Requirement: 第一則 prompt 預先填入而不送出，且不早於 agent 就緒

系統 SHALL 將第一則 prompt 填入該 session 的 agent 輸入處，且 SHALL NOT 代為送出 ——
**送出由使用者為之**，那是這條管線唯一的人類閘門。

填入 SHALL NOT 早於該 session 的等待狀態**首次成為就緒**。在此之前寫入，內容會落進 agent 的
啟動畫面而非輸入處，**而畫面上不會有任何錯誤**。判定 SHALL 依 `agent-event-bridge` 的等待狀態，
SHALL NOT 以固定延遲、重試次數或終端畫面的內容為依據。

**填入 SHALL 由主行程執行。** prompt 含一個檔案系統位置，把它交給 renderer 再寫回去，等同把該
位置送過 IPC —— 那是本能力明文避免的事。

**單行 SHALL 為編碼路徑的性質，而非呼叫端的義務**：不附送出的編碼 SHALL 一併濾除換行。

**預填在一段有上限的時間內未能發生時，系統 SHALL 可見地說明，且該則 intake SHALL 回到可重新
處理的狀態。** 本條 SHALL 以**狀態**為判準而非以成因為判準 —— 等待狀態始終不到的成因不只一種
（事件回報未啟用、注入失敗、agent 啟動失敗、agent 版本改變）。已知可事先偵測的成因（例如事件
回報偏好已關閉）SHALL 於**建立 session 之前**告知並 SHALL NOT 建立 session，那是本條的快速
路徑，不是它的全部。

**該告知的時機寫成「建立 session 之前」而非「接受之前」**：到達時即被接受的項目沒有「接受之前」
這個時刻，而它同樣不該建立一個註定收不到 prompt 的 session。

**一則回到可重新處理狀態的 intake SHALL 保留它已經建立的 session 的關聯。其再次處理時，若使用者
確認的 folder 即該 session 所在的 folder，SHALL NOT 建立第二個 session**，SHALL 改為對既有的那
一個重新嘗試預填。

少了這一條，一次逾時會留下一個空的 session 在清單上，而再次處理又建一個 —— 每處理一次多一個，
**沒有上界**，且每一個看起來都正常。

**使用者確認的 folder 與該 session 所在的 folder 不同時，系統 SHALL 於確認的 folder 建立新的
session**，SHALL NOT 把 prompt 填入原 folder 的那一個 —— 那等於把本文送進使用者剛剛明確改掉的
repo。原 session SHALL NOT 被系統關閉：使用者可能已經在裡面輸入過東西，而關閉 pty 無法還原。
每一次這樣的再次處理都出自使用者的明確改選，因此上一段的「沒有上界」不因此重新成立。

#### Scenario: 就緒之後填入且未送出

- **WHEN** 一則 intake 被接受，其 session 的等待狀態成為就緒
- **THEN** 送往該 session 的內容含該 prompt
- **AND** 該 prompt 之後不含任何送出字元或換行

#### Scenario: 就緒之前不寫入

- **WHEN** 一則 intake 被接受，其 session 的 pty 已存在
- **AND** 該 session 的等待狀態尚未成為就緒
- **THEN** 在就緒發生之前的**整段期間**，送往該 session 的內容為空

#### Scenario: 就緒之後只填入一次

- **WHEN** 該 session 的等待狀態在就緒之後再次成為就緒
- **THEN** 該 prompt 未被再次填入

#### Scenario: 使用者送出後 agent 才收到

- **WHEN** 使用者於輸入處送出
- **THEN** 送往該 session 的內容出現送出字元
- **AND** 該 prompt 出現於 agent 的紀錄中

#### Scenario: 預填未能發生時說明並回到可重新處理

- **WHEN** 一則 intake 被接受，而其 session 的等待狀態在上限時間內未成為就緒
- **THEN** 系統可見地說明預填未能發生
- **AND** 該則 intake 回到待處理

#### Scenario: 事件回報已關閉時於接受之前告知

- **WHEN** 事件回報偏好已被關閉，使用者嘗試接受一則 intake
- **THEN** 系統於建立 session 之前告知預填不會發生
- **AND** session 的總數與嘗試之前相同，且該則 intake 仍為待處理

#### Scenario: 事件回報已關閉時到達的項目不建立 session

- **WHEN** 事件回報偏好已被關閉，一則本會於到達時即被接受的項目到達
- **THEN** session 的總數與到達之前相同
- **AND** 系統可見地說明預填不會發生

#### Scenario: 逾時之後再次處理不建立第二個 session

- **GIVEN** 一則 intake 已建立 session 但預填逾時，因而回到待處理
- **WHEN** 使用者未改選 folder 即再次處理它
- **THEN** session 的總數與再次處理之前相同

#### Scenario: 逾時之後改選別的 folder 再次處理

- **GIVEN** 一則 intake 已於 folder A 建立 session 但預填逾時，因而回到待處理
- **WHEN** 使用者改選 folder B 並再次處理它
- **THEN** 新的 agent session 建立於 **B**，且該 prompt 填入該新 session
- **AND** A 的那個 session 仍然存在，且送往它的內容不含該 prompt
