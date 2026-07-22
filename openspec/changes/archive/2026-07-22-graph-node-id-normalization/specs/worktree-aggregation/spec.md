## MODIFIED Requirements

### Requirement: 視覺化的既有行為不因聚合而退化

關係圖與 Timeline 在聚合之後 SHALL 維持其既有行為 —— 特別是 Timeline 的**依 spec topic 分組**
SHALL 持續有效。

聚合掃描產生的關係圖，其 change 節點的識別碼帶有來源工作目錄的識別碼，且節點上附帶完整的
來源資訊。送往 renderer 之前，主行程 SHALL 完成下列**兩件事**：

1. change 節點的識別碼 SHALL 還原為**非聚合形式**（不含來源工作目錄的識別碼）；
2. 節點 SHALL NOT 附帶來源工作目錄的資訊（其中含絕對路徑，見「change 的來源以識別碼與分支
   呈現，絕不以絕對路徑」）。

**這兩件事是同一件事的兩面，SHALL NOT 只做其中一半。** 還原識別碼所需的資訊就在來源裡；
一旦來源被移除，renderer 便無從自行還原。只做第二件而不做第一件，其失效方式是
**畫面照樣畫得出來、分組卻靜靜地全部落到「無 topic」**，不會有任何錯誤。

還原 SHALL 在來源資訊尚存時完成，並 SHALL 以來源提供的識別碼為判準 —— 識別碼單獨看無法分辨
「來源的識別碼」與「slug 的開頭」，因此 slug 本身含分隔字元時 SHALL 仍完整還原。

邊（edge）以識別碼引用節點，因此其 **change 端** SHALL 與節點一併還原：消費端是先以邊的端點
查出節點、再讀取節點的識別碼，只還原節點會使查表全數落空，其症狀與完全未還原相同。

> 此處**只約束 change 端**是刻意的。關係圖的 spec 節點來自**已納入 specs 的 capability**，
> 而一個 change 的 delta 可以提議一個**尚未納入**的 topic —— 於是「change 指向一個不存在的
> spec 節點」是**合法且有意義的狀態**，它表達的正是「這個 change 提議一個新 capability」。
> 本 change 自己就是一例。
>
> **這與聚合無關**（非聚合掃描同樣會產生這種邊，已實測），因此它既不是本能力要處理的事，
> 也不該由本 app 過濾掉 —— 本能力另有一條 requirement 明文禁止對掃描結果二次過濾。
> 消費端 SHALL 容忍這種邊（我們使用的關係圖元件自身即已忽略端點無法解析的邊）。

#### Scenario: 聚合後 Timeline 仍依 topic 分組

- **WHEN** 一個含多個工作目錄的 repo，其 change 動到了某些 spec topic，使用者開啟 Timeline
  並啟用依 topic 分組
- **THEN** change 被歸入其對應 topic 的分組，而非全部落在「無 topic」

#### Scenario: 送往 renderer 的關係圖已還原識別碼且不含來源

- **WHEN** renderer 為一個含多個工作目錄的 repo 請求關係圖
- **THEN** 每個 change 節點的識別碼為非聚合形式
- **AND** 節點上沒有來源工作目錄的資訊
- **AND** 每條邊的 change 端都對得到一個節點
