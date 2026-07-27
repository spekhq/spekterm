## REMOVED Requirements

### Requirement: session 可錨定一個 change

**Reason**: 這是「錨定為 per-session」的**根** —— 它明文寫著「每個 session SHALL 可錨定其所屬
folder 的一個 change」「錨定關係為 per-session」。本 change 把側欄座標的三個維度（來源 repo、
工作目錄、錨定的 change）一併改基到 rail 的項目上，錨定不再是 session 的一個屬性，因此這條
requirement 的主體不再存在。

**它同時是一條既有規格矛盾的一半，移除即解。** 該 requirement 寫著「錨定關係 SHALL NOT 持久化
—— session 本身即不跨 app 重啟存活」，而 `session-persistence`（`session-restore` 引入）不但把
錨定列為必須持久化的事實，還有一條「錨定的 change 一併回來」的 scenario。`session-restore` 加了
持久化卻沒有回寫這一條，兩者自此對立。

其中「session 建立時，若其所屬 folder 恰有一個 active change，該 session SHALL 錨定該 change」
一段亦隨之消失：座標不再由「建立 session」這個動作寫入，該情形改由 `openspec-panel` 既有的
**衍生預設**涵蓋（側欄來源 repo 恰有一個 active change 且尚無明確錨定時即呈現它）。這使規則由
兩條（動態預設 + 建立 session 時固化）收斂為一條。

**Migration**: 「錨定關係由使用者建立，SHALL NOT 由系統自 pty 的輸出或標題推測」及其論證（假陽性
／假陰性、「一個大部分時候對、偶爾莫名其妙跳到別的 change 的側欄比沒有側欄更糟」、以及它與
「session 的標籤反映 pty 設定的終端標題」為何不矛盾）由 `openspec-panel` 的
`## ADDED Requirements` 承接，主詞由 session 改為側欄座標。「錨定不隨 pty 的輸出改變」的 scenario
一併遷移。

座標的歸屬與可改變性由 `side-panel-source` 的「側欄座標為 per-folder，不以 session 的
存在為前提」承接；持久化由同一份規格的「側欄座標跨應用程式重啟存活」承接。「多個 session 各自
錨定不同 change」不再可能，那是本 change 明確接受的取捨（見該 requirement 的最後一段）。
