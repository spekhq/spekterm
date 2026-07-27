## MODIFIED Requirements

### Requirement: OpenSpec 與 Files 兩個身分共用同一個側欄來源

side panel 的 OpenSpec 與 Files 兩個身分 SHALL 共用同一個側欄來源。切換身分 SHALL NOT 改變側欄
來源所指的 repo。

Files 身分的檔案樹是單一 repo 的階層結構，本就一次只能呈現一個來源 —— 這也是側欄採「選一個
repo」而非「聚合多個 repo」的決定性理由：若 OpenSpec 聚合而 Files 只能選一個，兩個身分的來源
語意就會分裂。

**本要求的作用域為 repo 維度。** 側欄來源另有一個工作目錄維度（見 `side-panel-worktree`），
而該維度**不受本要求約束** —— OpenSpec 身分聚合該 repo 的全部工作目錄，Files 身分則選定其中
一個。上述「分裂」的論證在該維度不適用，因為兩件事的價值恰好相反：

- 聚合多個 **repo** 的 change 沒有意義（那是不同的專案）；聚合同一個 repo **各工作目錄**的
  change 有意義，且那正是 `worktree-aggregation` 的價值主張（一次看見全部進行中的 change）。
- 反過來，聚合同一組檔案的多個版本毫無意義 —— 那是同一棵樹疊在一起。

於是工作目錄維度的分裂是**既存事實而非新引入**：`worktree-aggregation` 之後，現況已是
「OpenSpec 聚合、Files 恆為 folder 自身」，`side-panel-worktree` 只是把 Files 那一側的「選哪
一個」由寫死改為使用者可控，分裂的程度並未改變。

#### Scenario: 切換身分不改變側欄來源

- **WHEN** 側欄來源指向 repoB，使用者於 OpenSpec 與 Files 身分之間切換
- **THEN** 兩個身分皆呈現 repoB 的內容

#### Scenario: 切換身分不改變已選定的工作目錄

- **WHEN** Files 身分選定了某個 worktree，使用者切至 OpenSpec 身分後再切回
- **THEN** Files 身分仍以該 worktree 為樹根

#### Scenario: OpenSpec 身分不因 Files 選定工作目錄而收窄

- **WHEN** Files 身分選定了某個 worktree，使用者切至 OpenSpec 身分
- **THEN** OpenSpec 身分仍聚合呈現該 repo 全部工作目錄的 change，而非僅該 worktree 的
