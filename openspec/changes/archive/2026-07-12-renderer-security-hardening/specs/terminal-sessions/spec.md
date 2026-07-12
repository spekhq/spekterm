## ADDED Requirements

### Requirement: 終端內的連結一律經受控接縫開啟

終端內被觸發的連結，無論其為輸出中的純文字 URL 或 OSC 8 escape-sequence 超連結，SHALL 一律交由
主行程驗證協定後以系統的預設瀏覽器開啟。終端呈現的內容是不受信任的 —— pty 的輸出中，使用者 repo
裡的任何東西都可能印出一個 URL。

終端內的連結 SHALL NOT 落入終端模擬器的內建預設連結處理器 —— 該預設會彈出一個其文字由不受信任
輸出所控制的確認對話框，並嘗試自行開啟視窗。僅協定屬於 `http` 或 `https` 的連結 SHALL 被開啟，
其餘協定 SHALL 被拒絕；此協定驗證 SHALL 在主行程執行。

#### Scenario: 終端輸出中的 OSC 8 超連結被觸發

- **WHEN** pty 輸出一個 OSC 8 超連結，且使用者觸發它
- **THEN** 該連結經主行程的協定驗證後交由系統瀏覽器開啟，且不彈出終端模擬器內建的確認對話框

#### Scenario: 終端連結的非安全協定被拒絕

- **WHEN** 終端內一個協定不屬於 `http` 或 `https` 的連結被交付至主行程
- **THEN** 主行程拒絕開啟它

### Requirement: 主行程的剪貼簿寫入對畸形輸入防禦

主行程接收 renderer 剪貼簿寫入請求的進入點 SHALL 對輸入型別防禦：收到非字串的輸入時 SHALL 丟棄
該請求，且 SHALL NOT 因此產生未捕捉的例外。

renderer 端的型別標註屬編譯期，不構成執行期防護 —— 一個被入侵或有 bug 的 renderer 可送出任意
型別的值。此防護 SHALL 在主行程這一側執行。

#### Scenario: renderer 送出非字串的剪貼簿寫入

- **WHEN** renderer 對剪貼簿寫入進入點送出一個非字串的值
- **THEN** 該請求被丟棄，主行程不產生未捕捉的例外並繼續正常運作

#### Scenario: 正常的字串寫入不受影響

- **WHEN** renderer 送出一個字串以寫入系統剪貼簿
- **THEN** 該文字被寫入系統剪貼簿
