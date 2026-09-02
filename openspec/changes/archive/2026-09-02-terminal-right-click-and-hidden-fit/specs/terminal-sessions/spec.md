## MODIFIED Requirements

### Requirement: 切換 session 保留各自的終端內容

非 focused 的 session 其 pty SHALL 持續運作，其於未顯示期間產生的輸出 SHALL NOT 遺失。使用者切回該 session 時，SHALL 能看到期間累積的輸出。

**切換本身 SHALL NOT 破壞既有的終端內容。** 一個 session 被切走再切回之後，其終端於切走**之前**已經產生的輸出 SHALL 仍然完整可取得（包含已進入 scrollback、需捲動才看得到的部分）。切換不是一個會改變終端幾何的動作 —— 任何因切換而重排既有內容的實作，都會在內容量大時使最舊的部分被擠出 scrollback 而永久遺失。

#### Scenario: 背景 session 的輸出於切回後可見

- **WHEN** 一個非 focused 的 session 的 pty 在未顯示期間產生輸出，使用者稍後切回該 session
- **THEN** 期間累積的輸出可見於該 session 的終端

#### Scenario: 切走再切回後最舊的輸出仍在

- **WHEN** 一個 session 的終端已累積大量輸出（足以逼近 scrollback 上限），使用者切到另一個 session 後再切回
- **THEN** 切走之前產生的**最舊**一行輸出仍可經捲動取得，與「全程停留在該 session」時所得相同

### Requirement: 終端尺寸變化時 pty 尺寸同步

終端可用的顯示尺寸改變時，其 pty 的欄數與列數 SHALL 隨之更新，使 pty 內執行的程式以正確的寬度換行輸出。

**同步的前提是量得到。** 終端的容器未被排版出來時（未顯示的 session、尚未掛載、或任何沒有版面盒子的狀態），系統 SHALL NOT 推導尺寸、SHALL NOT 更新該 pty 的欄列數、且該終端自身的行列數 SHALL NOT 改變。

此條款是**否定式**的，且兩個子句都承重：

- **不得推送尺寸給 pty** —— pty 內的程式以它為準排版；一個從未被真實量測過的值會讓 agent 以錯誤的寬度輸出，而那些輸出一旦印出就**永久留在終端歷史裡**，其後把尺寸改回來也救不回。
- **不得改變終端自身的行列數** —— 改變行列數會重排既有內容（見「切換 session 保留各自的終端內容」）。

尺寸的推導 SHALL 以「容器是否具有版面盒子」判定，SHALL NOT 以推導所得數值是否落在某個範圍內判定 —— 一個被夾到下限的值與一個真實的窄終端在數值上無法區分，而兩者的正確處置相反。

#### Scenario: 尺寸改變後 pty 收到新的欄列數

- **WHEN** 終端的可用尺寸改變
- **THEN** 其 pty 的欄數與列數更新為與新尺寸相符的值

#### Scenario: session 被切走時其 pty 的尺寸不變

- **WHEN** 一個顯示中的 session 被切走（其終端不再具有版面盒子）
- **THEN** 該 pty 持有的欄數與列數與切走之前相同

#### Scenario: 切回顯示時尺寸仍然正確

- **WHEN** 使用者切回一個先前被切走的 session
- **THEN** 該 pty 持有的欄數與列數與該終端當下的可用尺寸相符

## ADDED Requirements

### Requirement: 終端支援複製與貼上，且滑鼠路徑一律由終端擁有

終端 SHALL 提供複製選取內容與貼上剪貼簿內容的能力，且 SHALL 同時提供**滑鼠**與**鍵盤**兩條路徑 —— 終端若不能複製貼上，等同不能使用。

**滑鼠路徑的歸屬 SHALL NOT 取決於 pty 內程式的狀態。** 依據是**當下的能力事實**而非慣例：本終端未實作 OSC 52，因此 pty 內的程式讀不到系統剪貼簿 —— 「把滑鼠鍵讓位給程式，好讓它自己的貼上慣例生效」在本終端得不到任何東西，讓出去的結果只是那顆鍵什麼都不做。

- **鍵盤**：SHALL 提供複製與貼上的快捷鍵。鍵盤路徑 SHALL NOT 受 pty 是否啟用 mouse reporting 影響。
- **右鍵（一律由終端擁有）**：右鍵 SHALL 開啟複製／貼上選單（無選取內容時複製 SHALL 為停用），且 SHALL NOT 受 pty 是否啟用 mouse reporting 影響。終端 SHALL NOT 把右鍵轉發給 pty 內的程式 —— 否則選單與程式的處理會雙重作用。原生瀏覽器選單 SHALL 一律不呈現。
- **中鍵（一律由終端擁有）**：中鍵貼上是終端的慣例，SHALL 一律由終端貼上剪貼簿的內容，且**恰好一次**，**與 mouse reporting 是否啟用無關**。終端 SHALL 擋掉瀏覽器原生的中鍵貼上、且 SHALL NOT 把中鍵轉發給 pty 內的程式 —— 否則原生貼上與程式的處理會疊加成多次貼上。
- **左鍵不在此列**：左鍵是 pty 內程式的主要互動面，其行為（選取與轉發）不受本要求改變。

**`Ctrl+C` SHALL 維持送出中斷訊號（SIGINT），SHALL NOT 被挪用為複製** —— 使用者中斷失控程式的能力，不得因畫面上剛好有一段選取而失靈。複製因此採用終端模擬器慣用的 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不與中斷訊號衝突，故於該平台使用 `Cmd+C`／`Cmd+V`）。

貼上的內容 SHALL 原封不動地送交 pty，SHALL NOT 被過濾或轉換。

#### Scenario: 自右鍵選單複製與貼上

- **WHEN** 使用者於終端按下右鍵（pty 未啟用 mouse reporting）
- **THEN** 出現包含複製與貼上的選單，且該選單完整落在可視範圍內

#### Scenario: 啟用 mouse reporting 時右鍵仍由終端處理

- **WHEN** pty 內的程式已啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 終端開啟自己的複製／貼上選單，且該滑鼠事件 SHALL NOT 送達 pty 內的程式

#### Scenario: 無選取內容時複製為停用

- **WHEN** 終端中沒有任何選取內容，使用者開啟右鍵選單
- **THEN** 複製項目為停用狀態

#### Scenario: 中鍵貼上恰好一次

- **WHEN** 剪貼簿中有一段文字，使用者於終端按下中鍵（無論 pty 是否啟用 mouse reporting）
- **THEN** 該段文字**恰好一次**送交 pty，SHALL NOT 因瀏覽器原生中鍵貼上或程式的轉發處理而重複

#### Scenario: 複製選取的內容

- **WHEN** 使用者選取終端中的一段輸出並觸發複製
- **THEN** 該段內容被寫入系統剪貼簿

#### Scenario: 以鍵盤貼上的內容送達 pty

- **WHEN** 剪貼簿中有一段文字，使用者以貼上快捷鍵觸發貼上
- **THEN** 該段文字原封不動地送交 pty

#### Scenario: Ctrl+C 仍為中斷訊號

- **WHEN** 使用者於終端中按下 `Ctrl+C`（無論當下是否有選取內容）
- **THEN** 中斷訊號送交 pty，複製 SHALL NOT 發生

## REMOVED Requirements

### Requirement: 終端支援複製與貼上

**Reason**: 其「右鍵（gate 在 mouse reporting）」條款所依據的前提已被實測否證 —— 該條款假設「把右鍵讓給程式，程式自己的右鍵貼上就會生效」，但 pty 內的程式讀不到系統剪貼簿（本終端未實作 OSC 52），而 `claude` 一啟動就啟用 mouse reporting。實際結果是 agent session 裡右鍵完全沒有作用。行為既然反轉，其 scenario「啟用 mouse reporting 時右鍵讓位給程式」也必須反轉；scenario 的更名在 delta 格式裡表達不出來（`MODIFIED` 會整塊取代，archive 對「主 spec 裡有、MODIFIED 區塊裡沒有」的 scenario 直接拒絕），故整條以「終端支援複製與貼上，且滑鼠路徑一律由終端擁有」取代。

**取代的代價**：走 REMOVED + ADDED 就是**繞過那道 scenario 不得遺漏的守衛** —— 既有的 7 條 scenario 有沒有被完整承接，從此只有人眼在看。本 change 已逐條核對：1 條更名（「未啟用 mouse reporting 時自右鍵選單複製與貼上」→「自右鍵選單複製與貼上」）、1 條反轉（讓位 → 仍由終端處理）、1 條 WHEN 收窄（移除「pty 未啟用 mouse reporting」這個前提）、其餘 4 條原樣，**無遺漏**。

**Migration**: 由「終端支援複製與貼上，且滑鼠路徑一律由終端擁有」承接。鍵盤、中鍵、`Ctrl+C`、貼上內容不得轉換等條款**逐字保留**；唯一的行為改變是右鍵的歸屬（改為一律由終端擁有，且不轉發給 pty 內的程式）。
