## MODIFIED Requirements

### Requirement: 終端支援複製與貼上

終端 SHALL 提供複製選取內容與貼上剪貼簿內容的能力，且 SHALL 同時提供**滑鼠**與**鍵盤**兩條路徑 —— 終端若不能複製貼上，等同不能使用。

- **鍵盤**：SHALL 提供複製與貼上的快捷鍵。鍵盤路徑 SHALL NOT 受 pty 是否啟用 mouse reporting 影響。
- **右鍵（gate 在 mouse reporting）**：pty 內的程式**未啟用** mouse reporting 時，右鍵 SHALL 開啟複製／貼上選單（無選取內容時複製 SHALL 為停用）；程式**已啟用** mouse reporting（例如 claude 接管滑鼠）時，右鍵 SHALL 交由該程式處理（由 xterm 轉發），終端 SHALL NOT 開啟自己的選單 —— 否則會與程式自身的右鍵慣例（如右鍵貼上）雙重作用。當下的 mouse reporting 狀態 SHALL 於事件發生時判定（程式會在執行期間動態開關）。原生瀏覽器選單 SHALL 一律不呈現。
- **中鍵（一律由終端擁有）**：中鍵貼上是終端的慣例，SHALL 一律由終端貼上剪貼簿的內容，且**恰好一次**，**與 mouse reporting 是否啟用無關**。終端 SHALL 擋掉瀏覽器原生的中鍵貼上、且 SHALL NOT 把中鍵轉發給 pty 內的程式 —— 否則原生貼上與程式的處理會疊加成多次貼上。

**`Ctrl+C` SHALL 維持送出中斷訊號（SIGINT），SHALL NOT 被挪用為複製** —— 使用者中斷失控程式的能力，不得因畫面上剛好有一段選取而失靈。複製因此採用終端模擬器慣用的 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不與中斷訊號衝突，故於該平台使用 `Cmd+C`／`Cmd+V`）。

貼上的內容 SHALL 原封不動地送交 pty，SHALL NOT 被過濾或轉換。

#### Scenario: 未啟用 mouse reporting 時自右鍵選單複製與貼上

- **WHEN** pty 內的程式未啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 出現包含複製與貼上的選單，且該選單完整落在可視範圍內

#### Scenario: 無選取內容時複製為停用

- **WHEN** pty 未啟用 mouse reporting、終端中沒有任何選取內容，使用者開啟右鍵選單
- **THEN** 複製項目為停用狀態

#### Scenario: 啟用 mouse reporting 時右鍵讓位給程式

- **WHEN** pty 內的程式已啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 終端 SHALL NOT 開啟自己的選單，該滑鼠事件交由 pty 內的程式處理

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

<!--
  「終端的字格渲染獨立於字型的 glyph 幾何」（GPU renderer）原擬於此新增，**已移除**：GPU renderer
  延後到下一個 change（理由與完整調查見本 change 的 design D2 —— canvas addon 對 xterm 6 已死、
  webgl 會使 `.xterm-rows` 消失而廢掉 probe:terminal 的 14 個觀測點）。沒交付的東西不寫進 spec。

  本 change 對「表格破版」的實際貢獻是行高（1.3 → 1.0 且可設定，見 `terminal-preferences`），它修掉
  框線的靜態縫，但不是完整修復。
-->
