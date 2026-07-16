## MODIFIED Requirements

### Requirement: terminal 的字級納入同一組尺度

terminal 的字級 SHALL 由字級尺度**推導**作為其**預設**，SHALL NOT 是一個與尺度無關的獨立常數。

使用者設定的終端字型大小偏好（見 `terminal-preferences`）SHALL 覆蓋此預設；**未設定偏好時**，terminal 的字級 SHALL 跟隨字級尺度。

terminal 的字級由 xterm 的 `fontSize`（canvas 設定，非 CSS）決定，因此無法直接套用 CSS token —— 那是實作上的接法，不是讓它自成一格的理由。偏好的覆蓋值同樣經由 `fontSize`（數字）套用，因此 SHALL NOT 使「renderer 的字級一律經由字級 token 表達」的守衛失效（該守衛僅約束 CSS／Tailwind 的字級寫法）。

實作上退回預設值的路徑（fallback）SHALL 可被驗收區分於「真的讀到了尺度」—— 否則一次靜默失敗（讀不到尺度而退回一個恰好正確的常數）不會被任何東西抓到。

#### Scenario: 未設偏好時 terminal 字級源自尺度

- **WHEN** 未設定終端字型大小偏好，調整字級尺度
- **THEN** terminal 的字級隨之改變，且改動處僅有尺度本身
- **AND** terminal 的字級不等於實作中的 fallback 常數 —— 讀成它就表示尺度根本沒被解析出來

#### Scenario: 字型大小偏好覆蓋尺度預設

- **WHEN** 使用者設定終端字型大小偏好
- **THEN** terminal 以該大小呈現，不再等於尺度推導的預設值

#### Scenario: 字級變更後 terminal 重新量測

- **WHEN** terminal 的字級改變（無論來自尺度或偏好）
- **THEN** terminal 重新量測其可用的行列數，pty 收到更新後的尺寸 —— 字級變了而未重新量測，終端的內容會與實際視窗錯位
