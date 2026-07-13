## MODIFIED Requirements

### Requirement: rail 呈現每個 folder 的名稱與身分

workspace rail SHALL 為每個已加入的 folder 呈現一列，顯示其**名稱**與其 **git 分支**。

名稱 SHALL 是該列視覺權重最高的元素 —— 它是使用者用來辨識 repo 的東西，SHALL NOT 被同列的
其他文字在視覺上壓過或平分。

rail SHALL 只在 folder 處於**異常狀態**時發聲：不含 `openspec/`、或路徑失效。**含有
`openspec/` 是常態，rail SHALL NOT 為它呈現任何持續性的標示** —— 每一列都喊一次的訊息不傳達
任何資訊，只是噪音。

OpenSpec 身分入口的可用性由 `Requirement: OpenSpec 為條件式身分，Files 恆可用` 承擔（該入口
位於主舞台的 side panel 身分切換）。rail SHALL NOT 重複呈現一個入口。

rail SHALL NOT 呈現不可操作的控制項 —— 一個長得像按鈕、按下去卻什麼都不發生的元素，會反覆
消耗使用者的注意力去確認它是不是壞了。指示性的資訊 SHALL 以非互動的形式呈現。

rail 底部 SHALL 提供加入 folder 的入口。

#### Scenario: 含 openspec 的 folder

- **WHEN** rail 呈現一個含有 `openspec/` 的 folder
- **THEN** 該列**不因此**呈現任何標示（常態不發聲）

#### Scenario: 不含 openspec 的 folder

- **WHEN** rail 呈現一個不含 `openspec/` 的 folder
- **THEN** 該列以弱化的樣式標示此事 —— 使用者應在點擊之前就知道該 repo 只能以 Files 身分使用

#### Scenario: 路徑失效的 folder

- **WHEN** rail 呈現一個路徑已失效的 folder
- **THEN** 該列明確標示此事

#### Scenario: folder 的分支

- **WHEN** rail 呈現一個位於某 git 分支上的 folder
- **THEN** 該列呈現其分支名稱，且其視覺權重低於 folder 名稱

#### Scenario: rail 不呈現不可操作的控制項

- **WHEN** 檢視 rail 上的每一個可聚焦／可點擊的元素
- **THEN** 每一個都有實際作用 —— 不存在按下去無任何效果的控制項

#### Scenario: 自 rail 加入 folder

- **WHEN** 使用者觸發 rail 底部的加入入口
- **THEN** 開啟原生目錄選擇對話框
