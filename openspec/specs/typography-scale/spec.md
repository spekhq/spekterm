# typography-scale Specification

## Purpose

renderer 的字級是**一個旋鈕**，不是散落在各元件中的數十個常數。

這條能力的存在，是因為它的反面已經發生過：收斂前有 **70 處**寫死的 `text-[Npx]` 散在 15 個檔案，
於是 `@theme` 裡的字級 token 調了也沒用 —— 想把字放大一點，得逐一去改那 70 個地方。字級因此
必須經由 token 表達，而尺度只定義於單一處。

字級同時是**版面的輸入**，不是裝飾：它沿著 min-content 把壓力傳到每一個 flex 容器上（旋鈕從 15px
轉到 17px，rail 就縮不到它宣告的最小寬度了）。

## Requirements

### Requirement: renderer 的字級一律經由字級 token 表達

renderer 的所有文字 SHALL 以 Tailwind 的字級 token（`text-xs` / `text-sm` / …）表達其字級，
SHALL NOT 寫死 arbitrary 字級值（`text-[13px]` 這類）。

字級的尺度 SHALL 定義於單一處（`index.css` 的 `@theme`）。調整該處的 token 值 SHALL 使全 app
的對應字級整體生效 —— 字級必須是**一個旋鈕**，而不是散落在各元件中的數十個常數。

本能力約束的是**字級**。其他 arbitrary 值（間距、寬度、顏色等）不在此限。

#### Scenario: 產品原始碼不得出現寫死的字級

- **WHEN** 對 renderer 的產品原始碼執行字級守衛
- **THEN** 找不到任何寫死的 arbitrary 字級值（`text-[<數字>px]` / `text-[<數字>rem]`）
- **AND** 守衛的對照組（一段刻意寫死字級的樣本）必須被它抓到 —— 否則守衛本身失效而不自知

#### Scenario: 調整 token 即整體生效

- **WHEN** 修改 `@theme` 中某個字級 token 的值
- **THEN** 全 app 中使用該 token 的文字其字級隨之改變，無需改動任何元件

### Requirement: 字級尺度涵蓋 renderer 既有的所有級距

字級尺度 SHALL 提供足夠的級距，使既有介面的每一處文字都能對應到一個 token，SHALL NOT 因為
「尺度裡沒有這一級」而迫使任何元件退回寫死字級。

尺度中相鄰級距 SHALL 有可辨識的差異 —— 若兩個 token 解析為相同的值，其中一個 SHALL 被移除，
不得以同義的 token 製造「看起來有分級、實際上沒有」的假象。

#### Scenario: 既有介面完全被尺度涵蓋

- **WHEN** 檢視收斂後的 renderer
- **THEN** 每一處文字的字級皆由某個字級 token 決定

#### Scenario: 尺度中不存在分不出來的級差

- **WHEN** 求值尺度中的每一級
- **THEN** 各級的實際字級互不相同

### Requirement: terminal 的字級納入同一組尺度

terminal 的字級 SHALL 由字級尺度**推導**而來，SHALL NOT 是一個與尺度無關的獨立常數。

terminal 的字級由 xterm 的 `fontSize`（canvas 設定，非 CSS）決定，因此無法直接套用 CSS token
—— 但那是實作上的接法，不是讓它自成一格的理由。

實作上退回預設值的路徑（fallback）SHALL 可被驗收區分於「真的讀到了尺度」—— 否則一次靜默失敗
（讀不到尺度而退回一個恰好正確的常數）不會被任何東西抓到。

#### Scenario: terminal 字級源自尺度

- **WHEN** 調整字級尺度
- **THEN** terminal 的字級隨之改變，且改動處僅有尺度本身
- **AND** terminal 的字級不等於實作中的 fallback 常數 —— 讀成它就表示尺度根本沒被解析出來

#### Scenario: 字級變更後 terminal 重新量測

- **WHEN** terminal 的字級改變
- **THEN** terminal 重新量測其可用的行列數，pty 收到更新後的尺寸 —— 字級變了而未重新量測，
  終端的內容會與實際視窗錯位
