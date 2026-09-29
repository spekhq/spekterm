## RENAMED Requirements

- FROM: `### Requirement: 第一則 prompt 預先填入而不送出，且不早於 agent 就緒`
- TO: `### Requirement: 第一則 prompt 不早於 agent 就緒寫入，第三方本文不代為送出`

## MODIFIED Requirements

### Requirement: 第一則 prompt 不早於 agent 就緒寫入，第三方本文不代為送出

系統 SHALL 將第一則 prompt 寫入該 session 的 agent 輸入處。**是否代為送出由本文的來源決定**：

- **本文為第三方撰寫**（例如 Slack）：系統 SHALL NOT 代為送出 —— **送出由使用者為之**，那是這條
  管線唯一的人類閘門。
- **本文非第三方撰寫**（agent 發起的交接）：系統 SHALL 於寫入的同時送出。本文是使用者自己的 session
  中的 agent 撰寫的，那道閘沒有可以擋下的東西。

判定 SHALL 依**本文的來源**，SHALL NOT 依「是誰觸發了建立」—— 一則交接因預填逾時退回待處理、
由使用者再次接受而**建立了新的 session** 時，它仍然被送出。

**代為送出之後，若在一段有上限的時間內未見 agent 開始工作（等待狀態成為忙碌或等待選擇），系統
SHALL 視該 prompt 為尚未送出**，呈現「待送出」的標示（見「待送出的 prompt 在輸入處不可見時仍須可見」），
且 SHALL NOT 自動再送出一次。送出字元偶爾不被 agent 當成送出（實測），而那段時間使用者可能已經在該
session 裡輸入了東西。

**寫入的對象是沿用的既有 session 時，SHALL 只填入而不送出，不論本文的來源。** 逾時之後使用者面對的
是一個空的 session，他可能已經在裡面輸入了東西；代為送出會把 prompt 連同他打到一半的內容一起送出，
而他在那之前沒有機會看見。

寫入 SHALL NOT 早於該 session 的等待狀態**首次成為就緒**。在此之前寫入，內容會落進 agent 的
啟動畫面而非輸入處，**而畫面上不會有任何錯誤**。判定 SHALL 依 `agent-event-bridge` 的等待狀態，
SHALL NOT 以固定延遲、重試次數或終端畫面的內容為依據。

**送出字元 SHALL 與文字分開寫入，且兩者之間 SHALL 相隔一段足以讓 agent 把文字當成輸入而非貼上的
間隔。** 實測一段長文字與送出字元一次抵達時，agent 把它當成貼上，送出字元被併進去成為換行 ——
文字停在輸入處、沒有送出，而畫面上沒有任何錯誤。

**寫入 SHALL 由主行程執行。** prompt 含一個檔案系統位置，把它交給 renderer 再寫回去，等同把該
位置送過 IPC —— 那是本能力明文避免的事。

**單行 SHALL 為編碼路徑的性質，而非呼叫端的義務**：不附送出的編碼 SHALL 一併濾除換行。

**寫入在一段有上限的時間內未能發生時，系統 SHALL 可見地說明，且該則 intake SHALL 回到可重新
處理的狀態。** 本條 SHALL 以**狀態**為判準而非以成因為判準 —— 等待狀態始終不到的成因不只一種
（事件回報未啟用、注入失敗、agent 啟動失敗、agent 版本改變）。已知可事先偵測的成因（例如事件
回報偏好已關閉）SHALL 於**建立 session 之前**告知並 SHALL NOT 建立 session，那是本條的快速
路徑，不是它的全部。

**該告知的時機寫成「建立 session 之前」而非「接受之前」**：到達時即被接受的項目沒有「接受之前」
這個時刻，而它同樣不該建立一個註定收不到 prompt 的 session。

**一則回到可重新處理狀態的 intake SHALL 保留它已經建立的 session 的關聯。其再次處理時，若使用者
確認的 folder 即該 session 所在的 folder，SHALL NOT 建立第二個 session**，SHALL 改為對既有的那
一個重新嘗試寫入。

少了這一條，一次逾時會留下一個空的 session 在清單上，而再次處理又建一個 —— 每處理一次多一個，
**沒有上界**，且每一個看起來都正常。

**使用者確認的 folder 與該 session 所在的 folder 不同時，系統 SHALL 於確認的 folder 建立新的
session**，SHALL NOT 把 prompt 寫入原 folder 的那一個 —— 那等於把本文送進使用者剛剛明確改掉的
repo。原 session SHALL NOT 被系統關閉：使用者可能已經在裡面輸入過東西，而關閉 pty 無法還原。
每一次這樣的再次處理都出自使用者的明確改選，因此上一段的「沒有上界」不因此重新成立。

#### Scenario: 就緒之後填入且未送出

- **WHEN** 一則本文為第三方撰寫的 intake 被接受，其 session 的等待狀態成為就緒
- **THEN** 送往該 session 的內容含該 prompt
- **AND** 該 prompt 之後不含任何送出字元或換行

#### Scenario: 非第三方本文於就緒時填入並送出

- **WHEN** 一則本文非第三方撰寫的 intake 建立了 session，其等待狀態成為就緒
- **THEN** 送往該 session 的內容含該 prompt，其後以另一次寫入、隔開一段間隔送出字元
- **AND** 該 prompt 出現於 agent 的紀錄中

#### Scenario: 非第三方本文退回待處理後於新的 session 接受仍送出

- **GIVEN** 一則本文非第三方撰寫的 intake 已於 folder A 建立 session 但寫入逾時，因而回到待處理
- **WHEN** 使用者改選 folder B 接受它，B 中新建的 session 其等待狀態成為就緒
- **THEN** 送往該新 session 的 prompt 其後以另一次寫入、隔開一段間隔送出字元

#### Scenario: 代為送出後未見開始工作即呈現待送出

- **WHEN** 一則本文非第三方撰寫的 intake 的 prompt 已被代為送出，而其 session 在上限時間內始終未成為忙碌或等待選擇
- **THEN** 該 session 呈現「有一則尚未送出的 prompt」的標示
- **AND** 送往該 session 的內容中送出字元只出現一次

#### Scenario: 沿用既有 session 時只填入不送出

- **GIVEN** 一則本文非第三方撰寫的 intake 已於 folder A 建立 session 但寫入逾時，因而回到待處理
- **WHEN** 使用者未改選 folder 即再次接受它，且該 session 的等待狀態為就緒
- **THEN** 送往該 session 的 prompt 之後不含任何送出字元或換行

#### Scenario: 就緒之前不寫入

- **WHEN** 一則 intake 被接受，其 session 的 pty 已存在
- **AND** 該 session 的等待狀態尚未成為就緒
- **THEN** 在就緒發生之前的**整段期間**，送往該 session 的內容為空

#### Scenario: 就緒之後只填入一次

- **WHEN** 該 session 的等待狀態在就緒之後再次成為就緒
- **THEN** 該 prompt 未被再次填入

#### Scenario: 使用者送出後 agent 才收到

- **WHEN** 本文為第三方撰寫，使用者於輸入處送出
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

**「已被送出」SHALL NOT 由一個無法分辨的狀態推定。** 判定的後果是持久的 —— 它把本文從收件匣
移除，而且沒有復原的入口。等待狀態落回「未知」時 SHALL NOT 視為已送出。

一則已了結的項目**再次被接受**時（預填逾時退回待處理之後），其了結標記 SHALL 被清除 ——
否則它一建立 session 就從這一段消失，使用者看不到他正要送出的本文。

**這一段存在的理由是「按下送出之前看得到本文全文」**，而那只對**由使用者送出**的項目成立。
離開的條件因此由那個理由推導：送出之後、或 session 已不存在時，那個理由已不成立。**SHALL NOT
以經過的時間為條件** —— 項目被接受時使用者可能不在電腦前，一個時間窗會讓本文在送出之前就從它的
呈現位置消失。

**由 agent 發起的交接會被代為送出**（見「第一則 prompt 不早於 agent 就緒寫入，第三方本文不代為
送出」），於是它們依第 1 者很快離開這一段。**它們的本文的呈現位置是 session 的交接單**
（`handoff-brief`），不是這一段。

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

#### Scenario: 代為送出的交接離開這一段

- **GIVEN** 一則交接到達並建立了 session
- **WHEN** 其第一則 prompt 被代為送出，且 agent 開始工作
- **THEN** 該項目不再呈現於收件匣

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

### Requirement: prompt 完全由系統組成，且指出界線之內的內容即是要執行的工作

prompt SHALL 完全由系統組成，SHALL NOT 含 intake 任何欄位的原文（系統自己產生的 nonce 不在此限）。

投遞者撰寫的文字若進入 agent 的輸入緩衝區，某些起始字元會使該輸入切換成別的模式（記憶、命令、
選單），**而它後面緊接著的就是送出** —— 使用者按下的，或（非第三方本文時）系統代為送出的。

prompt SHALL 指出**界線之內的內容就是那件要做的事**，SHALL NOT 要求 agent 先逐字照抄其中的
祈使句、亦 SHALL NOT 要求它先不要動手。**人類閘門在別處**：第三方的本文，使用者在接受之前看得到全文，
而 prompt 是填好而不送出的 —— 送出是他的動作，且他在那之前又讀了一次。非第三方的本文（agent 發起的
交接）**沒有這道閘**：它由使用者自己的 session 中的 agent 撰寫，於是被代為送出（見「第一則 prompt
不早於 agent 就緒寫入，第三方本文不代為送出」）。

**本文為第三方逐字撰寫時，prompt SHALL 另外聲明兩件事**：該內容來自他人，以及**第一回合不得
取得任何外部資源**（檔案中的連結一律不跟隨）。後者擋的是一條規格自己點名的逃逸路徑 ——
本文可以只放一個連結，把真正的內容移到本能力所有機制的作用域之外。**本文非第三方撰寫時不適用**：
它是使用者自己交辦的工作，而工作本來就可能要求去看某個東西。

**「本文是否為第三方撰寫」SHALL 是接收端可驗證的欄位，SHALL NOT 能由投遞內容表達** ——
否則任何放進共用投遞落點的檔案都能為自己要到比較寬鬆的那一種措辭。

**界線與 nonce 在兩種情形下都保留。** 非第三方的本文仍可能被來源 agent 讀過的東西塑形，
標示不會因此失去意義；被換掉的只有「要不要動手」。

**本能力 SHALL NOT 宣稱 prompt 阻止了任何事。** 它不約束模型的行為，也不及於使用者送出之後的
回合。**對第三方的本文，唯一真正的人類閘門是「使用者讀過本文之後按下送出」** —— 那條由
「接受之前看得到本文全文」與「第一則 prompt 不早於 agent 就緒寫入，第三方本文不代為送出」兩條共同
構成，而這一條不是它們的替代品。

**系統 SHALL NOT 以任何方式使 agent 存取該檔案時的許可提示更不顯眼。** 該提示與注入內容要突破
的是同一個提示；讓它看起來理所當然，等同訓練使用者對它放行。需要降低摩擦時，作法是讓它**更
可辨識**（固定且使用者認得的位置），不是讓它更不引人注意。

#### Scenario: prompt 不含 intake 的欄位原文

- **WHEN** 一則標題與本文皆含特殊起始字元的 intake 被接受
- **THEN** 填入輸入處的 prompt 不含該標題與本文的任何片段

#### Scenario: prompt 指出那就是要做的事

- **WHEN** 一則 intake 被接受
- **THEN** 填入的 prompt 指出界線之內的內容即是要執行的工作
- **AND** 該 prompt 不要求 agent 先逐字照抄其中的祈使句

#### Scenario: 第三方的本文另外聲明來源與不取得外部資源

- **WHEN** 一則本文為第三方逐字撰寫的 intake 被接受
- **THEN** 填入的 prompt 聲明該內容來自他人
- **AND** 該 prompt 明示第一回合不得取得任何外部資源

#### Scenario: 投遞內容無法為自己要到比較寬鬆的措辭

- **WHEN** 一份放進共用投遞落點的 JSON 中含有宣稱本文非第三方撰寫的欄位
- **THEN** 該欄位被丟棄，該則 intake 仍得到第三方的那一種 prompt
