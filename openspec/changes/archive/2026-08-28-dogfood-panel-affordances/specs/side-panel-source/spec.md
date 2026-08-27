## ADDED Requirements

### Requirement: 來源指示器的候選依 folder 名稱排序

來源指示器的下拉 SHALL 依 folder 名稱以不分大小寫的字母序（a–z）呈現候選，SHALL NOT 沿用 rail 上的順序。

兩份順序服務兩件不同的事：rail 的順序由使用者拖曳而來，表達的是「哪些常用、放在上面」；下拉是一份**查找**用的清單，使用者心裡已經有一個名字。以 rail 的順序呈現，等於要求他在二十幾個 repo 中線性掃描一份只有他自己知道規則的排列。

排序 SHALL NOT 改變 rail 的順序，兩者互不影響。

#### Scenario: 下拉的候選為字母序

- **WHEN** workspace 中的 folder 於 rail 上並非按名稱排列，使用者觸發來源指示器
- **THEN** 下拉的候選依 folder 名稱由 a 至 z 呈現，與 rail 上的順序無關

#### Scenario: 下拉的排序不影響 rail

- **WHEN** 使用者開啟並關閉來源指示器的下拉
- **THEN** rail 上的 folder 順序不變

## MODIFIED Requirements

### Requirement: 切換側欄來源時重置錨定的 change

使用者切換側欄來源時，**該 folder 座標中**錨定的 change SHALL 被重置。change 的 slug 隸屬於某個
repo（`openspec/changes/<slug>`）—— 沿用舊 repo 的 slug，本 change 視圖會對著一個在新 repo 不
存在的 change，看起來像壞掉。重置後由既有的衍生預設接手（新來源 repo 恰有一個 active change 時
呈現它，**否則本 change 視圖與其入口不呈現**，使用者於瀏覽視圖自行挑選）。

#### Scenario: 切換側欄來源後本 change 重置

- **WHEN** 某個 folder 的座標錨定了 repoA 的某個 change，使用者將其側欄來源切至 repoB
- **THEN** 該 folder 不再錨定 repoA 的 change；本 change 視圖依 repoB 的狀態重新解析
