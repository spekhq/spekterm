## ADDED Requirements

### Requirement: 以鍵盤關閉當前 session

系統 SHALL 提供快捷鍵 `Ctrl+Shift+W`，關閉當前 focused 的 session。當前沒有選中的 repo、或該
repo 沒有任何 session 時，`Ctrl+Shift+W` SHALL 為無操作，且 SHALL NOT 產生錯誤。

**鍵位選 `Ctrl+Shift+W` 而非 `Ctrl+W`**：後者在 zsh 是 `backward-kill-word`、bash 是
`unix-word-rubout`（終端裡的高頻刪字鍵，實測），攔截它即從 pty 內的程式手上沒收該鍵；而它沒有
`Ctrl+T` 的「GNOME Terminal 早已把它拿去開新分頁」豁免。`Ctrl+Shift+<字母>` 在終端協定裡編碼
不出來，pty 內收不到，代價為零（同複製貼上用 `Ctrl+Shift+C/V` 的理由，見 design D1）。

攔截於 window 的 capture 階段（同既有快捷鍵，早於 xterm 與 Monaco），被攔下的 `Ctrl+Shift+W`
SHALL NOT 抵達 pty。對話框或 overlay 開啟時 SHALL 不生效 —— 沿用 `[role="dialog"]` 的存在判定
（未存變更對話框開著時按它，不該把 session 關掉）。

#### Scenario: 以 Ctrl+Shift+W 關閉當前 session

- **WHEN** 當前有 focused 的 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 該 session 被關閉，且該按鍵不抵達 pty

#### Scenario: 終端持有焦點時仍能關閉 session

- **WHEN** 終端持有焦點，使用者按下 `Ctrl+Shift+W`
- **THEN** 當前 session 被關閉，且該按鍵不抵達 pty

#### Scenario: 沒有 session 時為無操作

- **WHEN** 當前沒有選中的 repo，或該 repo 沒有任何 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 不關閉任何東西，且應用程式不產生錯誤

#### Scenario: 對話框開啟時不生效

- **WHEN** 一個對話框（例如未存變更確認）開啟時，使用者按下 `Ctrl+Shift+W`
- **THEN** 不關閉任何 session
