## MODIFIED Requirements

### Requirement: 本 change 視圖以分頁呈現該 change 的每一個 artifact

**本 change** 視圖 SHALL 為錨定 change 的**每一個 artifact**（proposal、design、tasks、specs
以及該 schema 定義的任何其他 artifact）各提供一個分頁，一次 SHALL 只顯示一個。

分頁的順序 SHALL 由**資料來源所提供的排序規則**決定，並以該 change 的 schema 所宣告的順序作為它的
輸入。**本應用程式 SHALL NOT 另行實作該規則** —— 一份自己的實作會在規則演進時與來源靜默分歧，而
分歧的徵狀只是「順序看起來怪怪的」，沒有任何東西會紅。

該規則所產生的行為，以下三條 SHALL 成立：

- schema 宣告的順序可用時，分頁依該順序排列。
- **該順序不可用時，分頁 SHALL 依敘事順序（proposal → design → specs → tasks）排列，SHALL NOT
  沿用資料來源交付 artifact 時的順序** —— 後者以修改時間為基礎，對一個正常寫下來的 change 恰好是
  敘事順序的反序。「不可用」涵蓋且不限於：該 change 已封存、解析該順序所需的外部程式不可解析、
  以及該解析逾時。
- 該順序只涵蓋部分 artifact 時，被涵蓋者依其排在前，未被涵蓋者接在其後。

artifact **SHALL NOT** 被省略 —— 使用者要讀的正是「這個 change 為什麼存在、打算怎麼做」。

視圖 SHALL 呈現 change 的識別（slug）與狀態（active／archived）。change 若有 tasks，其**完成數／
總數與進度條 SHALL 恆常可見**，SHALL NOT 只出現在 tasks 那一個分頁裡 —— 它是這個 change 的狀態
摘要，不論使用者正在讀哪個 artifact 都應看得到。

#### Scenario: 每個 artifact 各有一個分頁

- **WHEN** 錨定的 change 有 proposal、design、tasks 與 spec deltas
- **THEN** 本 change 視圖為每一個各提供一個分頁，且一次只顯示一個

#### Scenario: 進度不隨分頁切換而消失

- **WHEN** 使用者自 tasks 分頁切換到 proposal 分頁
- **THEN** 該 change 的 tasks 完成數與進度條仍然可見

#### Scenario: 分頁順序依 schema

- **WHEN** 該 change 的 schema 宣告了 artifact 的順序，且該順序可用
- **THEN** 分頁依該順序排列

#### Scenario: 取不到 schema 順序時仍依敘事順序

- **WHEN** 錨定的 change 無法取得其 schema 所宣告的 artifact 順序，且資料來源交付的順序中 tasks 在
  proposal 之前
- **THEN** 分頁依 proposal、design、specs、tasks 的順序排列

#### Scenario: 已封存的 change 亦依敘事順序

- **WHEN** 使用者錨定一個已封存的 change
- **THEN** 分頁依 proposal、design、specs、tasks 的順序排列

## ADDED Requirements

### Requirement: 退路頂替權威順序時，視圖說明原因

分頁順序來自敘事順序（而非該 change 的 schema 所宣告的順序）時，本 change 視圖 SHALL 於分頁附近
呈現一句說明。

**沒有這句話，使用者無從分辨眼前的順序是權威的還是推測的** —— 而兩者在 spec-driven 之下恰好相同，
於是「看起來正確」不構成任何證據。**已封存的 change 永遠取不到權威順序**（該順序只對進行中的 change
查詢），所以這不是偶發狀態而是常態。

說明 SHALL 區分兩種情形：**已封存**（該順序本就不為封存的 change 追蹤），以及**其餘任何原因**。

**其餘那句 SHALL NOT 指出單一成因。** 進行中的 change 取不到該順序有多種可能（解析所需的外部程式
不可解析、逾時、非零結束、其輸出不含可對應的項目），而視圖手上沒有足以分辨的資訊 —— 指定一個成因
會是編造。

權威順序可用時 SHALL NOT 呈現這句說明。一句恆常顯示的說明等於沒有說明。

**這一條的驗收 SHALL 以「決定是否呈現」的判斷為對象，SHALL NOT 倚賴端對端執行中該順序是否恰好
可得。** 該順序由外部程式取得，而資料來源對其結果（**包含取不到**）設有數十秒的快取 —— 一次暫時性
的失敗會讓同一個來源在該窗口內持續回報取不到。實測同一份程式碼於兩種啟動模式下一紅一綠，差別只在
啟動時序落在快取窗口的哪一邊。**一條會間歇通過的驗收比沒有驗收更糟**：它下次失敗時，沒有人知道
該不該相信它。

#### Scenario: 已封存的 change 說明順序未被追蹤

- **WHEN** 使用者錨定一個已封存的 change
- **THEN** 視圖說明該順序不為已封存的 change 追蹤，且分頁依敘事順序排列

#### Scenario: 進行中的 change 取不到順序時說明退路

- **WHEN** 錨定一個進行中的 change，而其 schema 宣告的順序不可用
- **THEN** 視圖說明該順序不可得、目前呈現的是預設順序

#### Scenario: 權威順序可用時不呈現說明

- **WHEN** 錨定的 change 取得了其 schema 所宣告的順序
- **THEN** 視圖不呈現任何關於退路的說明
