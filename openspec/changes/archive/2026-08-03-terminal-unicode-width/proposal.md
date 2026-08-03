# terminal-unicode-width

## Why

**終端把 emoji 當成一格寬，而 agent 按兩格排版 —— 於是每一個 emoji 都讓那一行少一格。**

第十次 dogfooding 的回饋是「claude 輸出的表格捲動時會破版，右邊的框線會跑位」。實測把根因鎖死在
一個與捲動、與 GPU、與行高都無關的地方：**xterm 內建的字元寬度表是 Unicode 6**
（`term.unicode.versions` 實測為 `["6"]`），而 `✅`（U+2705）要到 **Unicode 9** 才被定為 Wide。
claude 依現代 wcwidth 排成兩格、xterm 依 Unicode 6 畫成一格，該行的右框線因此往左跑一格：

```
每行右緣 x（cell 寬 9.633px）
  ├─────┼────────┼─────┤    212.11
  │ 8   │ 東京   │ OK  │    212.11   ← 純 ASCII，對齊
  │ 7   │ 東京   │ ✅  │    202.48   ← 差 9.63px ＝ 正好一格
```

中文沒事，因為 CJK 在 Unicode 6 就已經是 Wide。**這也是為什麼它看起來像「表格的毛病」** ——
表格是唯一會把「少一格」明白畫出來的輸出形式，但缺陷本身涵蓋**任何含 emoji 的對齊輸出**
（清單、進度、框），而 claude 的輸出到處是 emoji。

這條缺陷從 Phase 4 終端誕生起就在，先前三次針對「表格破版」的調查
（`terminal-rendering-and-preferences` 的行高、`terminal-gpu-renderer` 的 webgl）都繞過了它 ——
它們修的是**一個 cell 內怎麼畫**，而這條是**一個字元佔幾個 cell**。

## What Changes

- **終端的字元寬度改依 grapheme cluster 判定，與現代 wcwidth 一致。** 載入
  `@xterm/addon-unicode-graphemes` 並啟用其寬度表。
- **開啟 xterm 的 `allowProposedApi`** —— unicode 版本切換是 xterm 的 proposed API，不開則
  `term.unicode` 存取即拋錯（實測）。這擴大了我們對 xterm 未穩定介面的依賴表面，理由與代價於
  design 論證。
- **不新增使用者可見的設定。** 與 GPU 加速那顆開關的差別於 design 論證（那顆存在的理由是
  「取得了但驅動畫錯，只有使用者看得出來」，而字元寬度是確定性的、不依賴驅動）。

**為什麼是 graphemes 而不是 `addon-unicode11`** —— 十三個案例的實測對照（判準為寫入後的
`cursorX`，即實際佔用的 cell 數；環境比照產品的 renderer 設定，見 design D8）：

「期望」欄是**實測 agent 的排版**（讓 claude 畫一張框線表格，反推它為每個符號保留幾格），
不是規範推論；其中五列為已知值的對照組且全部符合。

| 類別 | 例 | **claude 排版** | 現況 v6 | `unicode11` | `graphemes` |
|---|---|---|---|---|---|
| BMP CJK | `一` U+4E00 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| 星形平面 CJK 擴充 B/C/D | U+20000 等 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| BMP emoji | `✅` U+2705 | 2 | **1 ✗** | 2 ✓ | 2 ✓ |
| 星形平面 emoji | `🚀` U+1F680 | 2 | **1 ✗** | 2 ✓ | 2 ✓ |
| 半形／全形 | U+FF8A／U+FF21 | 1／2 | ✓ | ✓ | ✓ |
| **基底＋VS16** | `⚠️` `ℹ️` | 2 | **1 ✗** | **1 ✗** | 2 ✓ |
| **ZWJ 序列** | `👨‍👩‍👧` | 2 | **3 ✗** | **6 ✗** | 2 ✓ |
| **膚色修飾** | `👍🏽` | 2 | 2 ✓（碰巧） | **4 ✗** | 2 ✓ |

**`graphemes` 十三個全過；`unicode11` 錯四類，且錯的方向是量級上的** —— ZWJ 家庭判成 **6 格**
（三個 emoji 各算兩格，它不知道 ZWJ 把它們連成一個 cluster）、膚色修飾判成 **4 格**。**這比現況
更糟**：現況只是少一格，它是多四格。

差別是結構性的，不是版本新舊：`U+26A0` 這個 code point **本身**是 ambiguous（單看它，任何版本的
寬度表都回 1），它成為兩格是因為後隨的 VS16 把它推進 emoji presentation —— **那是 cluster 層的
事實，不是任何單一 code point 的屬性**。ZWJ 與膚色修飾同理。因此「採用較新版本的寬度表」
結構上就到不了這一半，而 `👍🏽`、`👨‍👩‍👧`、`⚠️` 在 agent 的輸出裡都很常見。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `terminal-sessions`: 新增一條字元寬度的要求 —— 終端判定字元佔用幾個 cell 時 SHALL 與現代
  wcwidth 一致，且 SHALL 以 grapheme cluster 而非單一 code point 為單位。它與既有的「終端的字格
  渲染獨立於字型的 glyph 幾何」是**相鄰但不同層**的關切（後者管一個 cell 內怎麼畫），兩條並存。
  既有的「終端支援複製與貼上」是否受 cluster 粒度影響，於 specs 階段判定。

## Impact

- **依賴**：新增 `@xterm/addon-unicode-graphemes`（0.4.0，unpacked 618 KB —— 它內含 Unicode
  表格）。renderer bundle 因此變大，`npm run measure:bundle` 的歸因要能看見它。
- **程式碼**：`src/renderer/src/shell/terminal/xterm.ts`（唯一的 xterm wrapper —— renderer 其餘模組
  不直接 import `@xterm/*`，此約束不變）。
- **驗收**：`probe:terminal`。注意其**觀測管道本身受影響** —— 畫面內容走「產品自己的複製路徑」
  （拖曳選取 → 複製 → 讀剪貼簿），而 cluster 粒度可能改變選取行為。
- **持久化**：`session-persistence` 的畫面快照是字元序列而非 cell 座標，重播時以當下的寬度表重新
  排版；升級後首次重播舊快照的呈現差異需確認（預期是變正確，非退步）。
- **不受影響**：主行程、IPC、任何檔案系統邊界。這是純 renderer 的終端呈現變更。
- **條件式的相依**：`workspace-app-shell` 有兩條「wrapper 化」與「bundle 體積可歸因」的
  requirement，但其文字**只涵蓋編輯器**。本 change **不打算修改 `measure:bundle`**；若實作時發現
  歸因報告完全看不見這個 addon 而決定去動那支腳本，則需為 `workspace-app-shell` 補一份 MODIFIED
  把該約束推廣至「wrapper 化的第三方 UI 套件」。此判定留待 tasks 5.1 執行時決定。

## 一個尚未解釋的觀察（不阻擋本提案，但不得被忽略）

使用者回報「**resize 或切回 session 之後會恢復**」。而本提案確立的根因是**靜態**的 —— 寬度表不會
因為 resize 而改變，該行應當恆常短一格。兩者不相容，代表下列之一為真：

1. 「恢復」指的是 emoji 溢出鄰接 cell 的**殘影**消失（那確實由重繪修好），而框線偏移一格因為不夠
   醒目而未被察覺；或
2. 除了寬度表之外**還有第二個因素**尚未被找到。

因此本 change **不得**因為寬度對齊修好就宣稱「捲動破版」結案 —— 交付後必須由 dogfood 對同一份輸出
確認，若仍破則第二個因素成立、另案處理。此紀律比照 `terminal-gpu-renderer`
（「若 dogfood 仍破，不得因為『已經上了 webgl』就宣稱結案」）。
