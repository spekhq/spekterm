# claude-status-bridge Specification

## Purpose

讓 agent **自己**把它算好的狀態交給我們，並管理「經由 agent 公開的 CLI 旗標注入設定」這個接縫。

**那個接縫只有一個，而現在有不只一個功能在用它**（狀態回報與事件回報）—— 因此本能力除了狀態
回報本身，也規範多個功能如何合成為單一份設定、以及它們的啟用狀態如何彼此獨立。

**注入 SHALL NOT 使使用者原有的設定失效**，這是預設啟用的前提。
## Requirements
### Requirement: 啟用時，agent session 以 CLI 旗標注入狀態回報命令

狀態橋接啟用時，spekterm SHALL 在 spawn agent session 時，以該 agent **公開的 CLI 旗標**注入一個
狀態列命令，使 agent 把它自己已經算好的狀態 payload 寫到 spekterm 指定的位置。

payload 的落點 SHALL 以**環境變數**傳給該命令，per session 各自一個位置；命令本身 SHALL NOT
需要知道自己屬於哪個 session。

spekterm SHALL NOT 為了取得這些資訊而解析 agent 的 transcript 或終端畫面 —— 前者是內部檔案格式
（且實測不含花費、用量上限與 context window 大小），後者正是被終端寬度截斷的那一行。

#### Scenario: 啟用後 agent 的狀態落盤

- **WHEN** 狀態橋接已啟用，且使用者建立一個 agent session
- **THEN** 該 session 的狀態 payload 出現在 spekterm 指定的位置
- **AND** 其內容為 agent 自己回報的狀態（含 context window 大小）

#### Scenario: 未啟用時完全不注入

- **WHEN** 狀態橋接未啟用，且使用者建立一個 agent session
- **THEN** spawn 該 session 時不注入任何狀態列命令
- **AND** 不產生任何 payload 檔案

### Requirement: 注入不得取代使用者原有的狀態列，串不上就不注入

若使用者已自行設定了 agent 的狀態列命令，spekterm 注入的命令 SHALL **串接**該命令並保留其輸出
—— SHALL NOT 使其失效。

**使用者已有自訂狀態列、但 spekterm 無法取得其命令時，SHALL NOT 注入。** 此時注入會讓他失去
自己那條，而不注入只是少一個他尚不知道存在的功能 —— 兩種失敗的代價不對等，取代價小者。

使用者**未**設定狀態列時，SHALL 照常注入：該位置原本就是空的（agent 內建的模式提示行**不是**
狀態列，兩種設定下皆存在），接管它的損失為零。

#### Scenario: 使用者已有自訂狀態列且可串接

- **WHEN** 使用者已為 agent 設定了自己的狀態列命令，且該命令可被取得
- **THEN** 該命令的輸出仍然呈現於 agent 的終端內
- **AND** payload 同時被寫出

#### Scenario: 使用者有自訂狀態列但無法取得其命令

- **WHEN** 使用者已設定狀態列，但 spekterm 無法讀出其命令
- **THEN** spekterm 不注入任何狀態列命令
- **AND** 使用者原有的狀態列照常呈現

### Requirement: 狀態橋接預設啟用且可關閉

狀態橋接 SHALL 預設為**啟用**，並 SHALL 可由使用者於設定中關閉。

預設啟用的前提是上一條的零損失保證。保留關閉的選項，是為了讓不希望 spekterm 改變 agent 呼叫
方式的使用者有退路 —— **這是本能力唯一會改變 spekterm 之外行為的部分。**

切換此偏好 SHALL 只影響其後建立或重建的 session（注入發生在 spawn 當下）；設定介面 SHALL 說明
這個限制，以免使用者誤以為開關無效。

#### Scenario: 關閉後不再注入

- **WHEN** 使用者關閉此偏好並建立一個 agent session
- **THEN** 不注入任何狀態列命令

#### Scenario: 切換後既有 session 不受影響

- **WHEN** 使用者啟用狀態橋接，而某個 agent session 在此之前已經在執行
- **THEN** 該 session 不會開始回報狀態
- **AND** 設定介面已說明此限制

### Requirement: payload 的寫入與讀取不得讓不完整的內容被呈現

payload 的寫入 SHALL 為原子操作（先寫入暫存檔再更名），使監看者 SHALL NOT 讀到只寫了一半的內容。

spekterm 讀取 payload 失敗（不存在、非合法 JSON、欄位缺漏）時 SHALL 靜默退回「無 agent 狀態」，
SHALL NOT 中斷狀態列的其餘欄位，亦 SHALL NOT 向使用者呈現解析錯誤。

session 結束時，其 payload SHALL 被清除。

#### Scenario: 損毀的 payload 不影響其餘欄位

- **WHEN** 某個 session 的 payload 檔內容不是合法的 JSON
- **THEN** 狀態列照常呈現第一手欄位
- **AND** 不呈現任何錯誤訊息

#### Scenario: session 結束後不留下 payload

- **WHEN** 一個曾回報過狀態的 session 被關閉
- **THEN** 其 payload 不再存在

### Requirement: 經同一注入接縫的多個功能彼此獨立且合成

不只一個功能經由同一個 CLI 旗標接縫向 agent 注入設定時，系統 SHALL 把它們**合成為單一份設定**
一次注入，SHALL NOT 各自注入而使後者取代前者。

**多個功能對同一個設定項的貢獻 SHALL 被合併，SHALL NOT 後者取代前者。** 合成為單一份設定只解決
了「各自注入」那一半；當兩個功能各自貢獻**同一個設定項**（例如同一組 hook 事件）時，逐項覆蓋的
合成會把先貢獻者的內容整份丟掉 —— **而兩個功能仍然都會回報自己已啟用**，症狀與「各自注入」
完全相同。

**該合併 SHALL 由結構保證，SHALL NOT 由「不同貢獻者不得使用同一個設定項」這條紀律保證。**
**已知會被多個功能貢獻的設定項**（hook 事件）SHALL 與只能由單一功能持有的設定項**在型別上
分開**，使「後者蓋掉前者」對前者表達不出來。一條寫在註解裡的紀律擋不住一個順手的實作，
而它的失效沒有任何徵狀。

**其餘設定項的重複貢獻 SHALL 為一個明確的失敗，SHALL NOT 為靜默覆蓋。** 型別上的分開只涵蓋
已知的那一項；日後某個尚未存在的設定項若也成為多人貢獻的對象，分類上它仍在「單一功能持有」
那一邊，而覆蓋會再次靜默發生。合成時偵測到同一個設定項被貢獻兩次即視為不變式違反 ——
**那是一個當場看得見的失敗，代價遠低於一個安靜失效的功能。**

各功能的**啟用狀態 SHALL 彼此獨立**：關閉其中一個 SHALL NOT 使另一個失效，其中一個因故不注入
（例如無法與使用者原有的設定並存）SHALL NOT 使另一個一併不注入。

**理由**：接縫只有一個，而合成的結果只有一份 —— 一個「各自寫一次」的實作，其失效是後寫的把
先寫的蓋掉，而**兩個功能都會回報自己已啟用**。症狀是其中一個安靜地失去作用，沒有任何錯誤。

#### Scenario: 兩個功能同時啟用時皆生效

- **WHEN** 狀態橋接與事件橋接皆為啟用，使用者建立一個 agent session
- **THEN** 該 session 的狀態 payload 被寫出
- **AND** 該 session 的事件亦被寫出

#### Scenario: 關閉其中一個不影響另一個

- **WHEN** 使用者關閉狀態橋接、保持事件橋接啟用，並建立一個 agent session
- **THEN** 不產生狀態 payload
- **AND** 該 session 的事件照常被寫出

#### Scenario: 其中一個因故不注入時另一個仍注入

- **WHEN** 事件橋接因無法與使用者原有的設定並存而不注入，且狀態橋接可正常注入
- **THEN** 該 session 的狀態 payload 照常被寫出

#### Scenario: 兩個功能貢獻同一組 hook 事件時皆被執行

- **WHEN** 兩個功能各自對**同一個** hook 事件貢獻一條命令，使用者建立一個 agent session
- **AND** 該 hook 事件發生
- **THEN** 兩條命令皆被執行

#### Scenario: 兩個功能貢獻同一個非 hook 設定項時為明確的失敗

- **WHEN** 兩個功能各自貢獻同一個非 hook 的設定項
- **THEN** 合成以一個明確的失敗結束
- **AND** 該失敗不是「其中一份被靜默採用」
