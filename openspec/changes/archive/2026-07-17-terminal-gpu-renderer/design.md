## Context

`terminal-rendering-and-preferences` 把 GPU renderer 延後，理由與調查留在它的 design D2。**本 change 重做了
一次獨立實測**（在暫存目錄裝一份 xterm 6 + webgl 0.19，不碰產品程式碼），結果**修正了 D2 的三個判斷**、
**推翻了我自己在 proposal 階段的一個假設**，也**戳破了一個我差點寫進本文件的假綠**。

實測環境：Electron 43.1.0（repo 的那顆）、Mesa Intel Xe（TGL GT2）、X11。webgl2 經 ANGLE 取得真 GPU
context（`ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL 4.6)`）。

**七項實測結論（全部左右了本文件的裁決）：**

| # | 結論 | 影響 |
|---|---|---|
| 1 | 載入 webgl 後 **`.xterm-rows` 確實消失**，改掛 **3 個 `<canvas>`** | D2 的前提成立；probe 的觀測管道全數失效 |
| 2 | **`getSelection()` 在兩種 renderer 下逐字元相同** | B 類的剪貼簿管道**可行** |
| 3 | **`.xterm` 的 computed `fontSize` 恆為 `16px`，不跟 `options.fontSize` 走** | **一個假綠**，見 D6 |
| 4 | `.xterm-screen` 的 rect **隨字級改變**（cols 固定 46：fs16→414px、fs22→598px） | 字級的替代觀測管道 |
| 5 | **行高 1.0 時 DOM 本來就無縫**；1.3 時 DOM 斷成 7 段／30px 空洞，**webgl 兩者皆為 1 段／0 空洞** | 見 D4 —— 靜態的縫已經被修好了 |
| 6 | DOM 的 **cellW 是分數（9.63px）**，內部垂直線被抹在 **2 個像素**上（`[1,2,2,1]`）；webgl cellW 為整數 9，**每條線都是 1 像素**（`[1,1,1,1]`） | **這才是行高 1.0 下仍然存在的缺陷** |
| 7 | 並存 webgl context **上限恰為 16**，超出時最舊的**靜默**被丟棄（建 30 個只有 16 個活著，`webglcontextlost` **一次都沒觸發**） | 見 D2 |

**必須先講清楚的一件事**：D2 說「webgl 之所以『修好』表格，有一部分只是把行高的問題蓋掉了」—— **這句話
比它自己以為的更重**。實測顯示**行高 1.0 下 DOM 的框線已經沒有縫**（結論 5）。也就是說：上一個 change 已經
把「靜態的縫」修完了，**本 change 對表格的貢獻不是修那個縫**，而是結論 6 的分數像素，加上把行高從「承重的
約束」降級為「自由的偏好」（D4）。

## Goals / Non-Goals

**Goals:**

- 終端的字格渲染**獨立於字型的 glyph 幾何**（框線程式化繪製），且**獨立於 cell 的分數像素落點**。
- webgl 只給 active 終端，並存 context 恆為 1；取不到或 loss 時**自動退回 DOM**，不比現況差。
- 使用者可關閉 GPU 加速（逃生口）。
- **修好被 webgl 廢掉的 27 個 probe 觀測點**，且**不讓驗收靠「把 GPU 關掉」迴避問題**。
- **先消滅假綠**：`TERMINAL_TEXT` 讀不到時 SHALL 丟錯，不得回空字串。

**Non-Goals:**

- **不宣稱修好「捲動時破版」。** 見 Risks —— 本 change **沒有重現**那個現象，因此也無法宣稱修好它。
- 不做像素級的渲染驗收（驗不到，見 D7）。
- 不改 `--text-terminal` 字級尺度的推導方式。
- 不動 `scrollback` 行數、快照策略、session 持久化。

## Decisions

### D1：GPU renderer 只有 webgl 一個選項 —— canvas **不再評估**

`@xterm/addon-canvas` latest **0.7.0**、peer **`^5.0.0`**、2023-11 後未再發佈，而我們的 xterm 是 **6.0.0**。
**它是唯一仍宣告 xterm 5 peer 的 addon** —— 我們其餘的 addon（fit 0.11 / serialize 0.14 / web-links 0.12）
與 webgl 0.19 **同代，皆已不宣告 peer**。canvas 正是 xterm.js 官方 deprecated、改推 webgl 的那一個。

**這條不必再查。** 「GPU 加速」與「webgl」在本專案是**同一個 renderer 的兩個名字** —— 前者是設定介面上給
使用者看的字（沿用 VS Code `terminal.integrated.gpuAcceleration`），後者是實作。

### D2：只給 active 終端，且這是**必要條件**而非優化

此 app **同時掛載每個 session 的終端**（`terminal-sessions` 的 design D7 —— scrollback 活在 xterm 實例裡，
卸載即遺失）。而實測**並存 webgl context 上限恰為 16**。

**真正致命的是它的失效方式：靜默。** 建 30 個 context，**16 個活著、14 個死掉，而 `webglcontextlost` 事件
一次都沒觸發**。也就是說：超出上限時，最舊的那些終端會**直接變成空白，沒有任何事件可以讓我們知道**。
`WebglAddon.onContextLoss` 這條自癒路徑**在這個情境下根本不會被呼叫**。

因此：**webgl addon 只在終端由隱藏轉為顯示時載入，切走即 `dispose()`**（xterm 自動退回 DOM renderer）。
並存數恆為 1，永遠碰不到上限。而「需要框線正確的地方」正好就是「使用者看得見的那一個」。

**替代方案**：(a) 全部掛 webgl —— 上限 16，一個開 5 個 repo × 4 個 session 的使用者就中獎，且**無聲**。
(b) 以 LRU 管理 N 個 context —— 自己複製瀏覽器已經在做的事，複雜度換不到東西。(c) 不掛載非 active 的終端
—— 那會犧牲 scrollback，是 design D7 早已否決的。

**代價**：切換 session 時有一次 addon 建立／銷毀。實測建立在 900ms 的等待內完成，無可見閃動；但**這是在
一個乾淨的實驗頁上量的**，真實 app 的切換成本列為 dogfood 觀察項。

### D3：關閉 GPU 加速的開關 —— 它補的是**自動降級擋不住的那一格**

自動降級（context 取不到 → catch；執行中 loss → `onContextLoss` → dispose 退回 DOM）只擋得住
**「webgl 拿不到」**。擋不住的是**「webgl 拿得到、但驅動有 bug 畫出爛東西」** —— 那種情況不觸發任何事件，
只能由使用者自己關。VS Code 有 `terminal.integrated.gpuAcceleration` 正是為此。

落在既有的 `terminal-preferences`（`preferences.json` + `settings.*` IPC，版本 + 原子寫 + 損毀隔離），
比照 family／size／行高。**預設為開。**

### D4：行高的預設**維持 1.0** —— 因為 DOM 降級路徑仍然存在

實測（結論 5）：

| | 行高 1.0 | 行高 1.3 |
|---|---|---|
| DOM | **1 段 / 0 空洞** | **7 段 / 30px 空洞** |
| webgl | 1 段 / 0 空洞 | **1 段 / 0 空洞** |

xterm 6 的 `customGlyphs`（預設 true）官方文件明載：程式化繪製 block element 與 box drawing，
「continuous lines, **even when line height and letter spacing is used**」，且**對 DOM renderer 無效**。
實測完全吻合。

**直覺的推論是「webgl 讓行高自由了，可以把預設調回 1.3」—— 但那是錯的。** 行高是**跨 renderer 的偏好**，
而 **DOM 是真實可達的降級路徑**（context 取不到、驅動有問題、或使用者自己關掉 GPU）。預設行高若是 1.3，
那些落到 DOM 的使用者**開箱就是破的表格** —— 而他們正是最沒有能力自救的一群。

**因此：預設維持 1.0（在兩種 renderer 下都安全），但 `terminal-preferences` 那條「預設行高 SHALL 使框線
得以相接」的理由要改寫** —— 它現在的論證是「因為框線靠 glyph 拼接」，那個前提在 webgl 下不成立。新的論證
是「**因為降級路徑存在**」。**同一個數字，不同的理由 —— 而理由才是 spec 的內容。**

想要 1.2／1.3 的使用者仍然設得到，代價明確：**他們的 DOM 降級路徑會破**。

### D5：本 change 對表格的真正貢獻是**分數像素**，不是行高的縫

實測（結論 6）—— 在**現在出貨的預設**（fs 16 / 行高 1.0）下：

```
DOM:   cellW = 9.630434782608695（分數）→ 垂直線佔的 x 數：[1, 2, 2, 1]
webgl: cellW = 9（整數）              → 垂直線佔的 x 數：[1, 1, 1, 1]
```

峰值亮度兩者相同（163/152），所以**不是變暗，是被抹開**：外框線恰好落在整數像素而銳利，內部的線落在
9.63 的倍數上被反鋸齒攤到兩個像素 —— **同一張表格裡，有的線是一條、有的線是兩條淡的**。這是靜態就存在的
缺陷，行高 1.0 修不到它（那修的是垂直方向的縫，這是水平方向的落點）。

webgl 的 cell 尺寸取整數、且框線由 shader 依 cell 邊界程式化繪製，**與落點無關**。

### D6：`.xterm` 的 `fontSize` **是一個假綠** —— 字級改以 cell 幾何觀測

**我在 proposal 階段的假設是錯的，實測把它殺掉了。** 原本以為 `.xterm-rows` 消失後可以改讀 `.xterm` 容器
的 computed `fontSize`（結論 1 顯示它在 webgl 下仍讀得到）。實測：

| `term.options.fontSize` | `.xterm-rows` | `.xterm` |
|---|---|---|
| 16 | `16px` | `16px` ← **恰好相等（巧合）** |
| 22 | `22px` | **`16px`** ← 沒動 |
| 11（webgl） | （不存在） | **`16px`** ← 還是 16 |

**`.xterm` 的 16px 只是瀏覽器的預設字級**，與終端的字級無關；它剛好等於我測試的初始值，於是第一眼看起來
「可行」。**這與 CLAUDE.md 已記的 `--text-terminal` calc() 陷阱是同一個形狀**：「因為 fallback 剛好等於
當時的正確值，畫面上完全看不出來」。若照假設實作，那 4 條字級斷言會變成**永遠回 16px 的假綠**。

**改用 cell 幾何**：字級的效果體現在 cell 的尺寸上，而 cell 量測走 `CharSizeService`（DOM，非 renderer）。
實測證實其鑑別力充足 —— 每個字級的 cell 寬都不同，且餘裕很大：

| `fontSize` | 14 | 15 | 16（尺度值） | 17 | 22 |
|---|---|---|---|---|---|
| `cellW` | 8.4348 | 9.0217 | 9.6304 | 10.2391 | 13.2391 |

相鄰字級差約 **0.6px**，而離屏量測與 xterm 實際 cell 寬的誤差僅 **0.02px** —— **30 倍餘裕**。

> **機制修正（實作階段推翻了本節的初稿）。** 初稿寫的是「讀 `.xterm-screen` 的 rect ÷ `cols`」——
> **那行不通**：`cols` 只存在於 xterm 實例上，而 probe 碰不到它（暴露它就是往產品程式碼塞測試鉤子，
> 本 repo 明文禁止）。DOM 上的候選訊號**全部實測為死路**：
>
> | 候選 | 實測結果 |
> |---|---|
> | `.xterm-char-measure-element` | **webgl 下不存在** |
> | `.xterm-helper-textarea` 的 computed `fontSize` | **恆為 `13.3333px`** —— 與 `.xterm` 同型的假綠 |
> | `.xterm-helper-textarea` 的 rect | **卡在初始值**（`9.625×19`），字級改了它不動 |
> | `.xterm-screen` 的 rect | 還在，但 `= cols × cellW` —— 沒有 `cols` 就算不出 `cellW` |
>
> **正解：不算 `cellW`，直接讀 pty 的 `cols`。** 固定容器寬度下「字級 ↑ → `cols` ↓」，而 `cols` 正是
> A 類改寫後的讀檔管道拿得到的（`stty size` → 檔案）。四條斷言全部以 `cols` 的比較承載：
> `cols(pref=14) ≠ cols(無 pref)`、`cols(base=15) ≠ cols(base=24)`、`cols(pref=22) ≠ cols(無 pref)`、
> `cols(清除後) = cols(原本)`。

**這個判準嚴格更強**：它證明的是「字級真的改變了 **pty 的幾何**」—— 而那正是這條 requirement**真正在乎的
東西**（`typography-scale` 的 scenario 明寫「**AND** pty 收到更新後的行列數」）。computed `fontSize` 只證明
「一個 CSS 屬性被設了」，證明不到它有沒有傳到 pty。

**代價（已與使用者確認並接受）**：「字級**恰等於**尺度推導的 px 值」這種**絕對值**斷言做不到了 —— 退為兩條
**相對關係**：「**≠ fallback 常數 14**」（`773`）與「**隨尺度改變**」（`800`）。spec 的原文是「SHALL 由字級
尺度**推導**，SHALL NOT 是一個與尺度無關的獨立常數」，這兩條合起來仍然涵蓋它，但確實比絕對值比對鬆。

### D7：驗收策略 —— 分面，且**誠實標示驗不到的部分**

| 面向 | 手段 | 可驗？ |
|---|---|---|
| **假綠哨兵** | `TERMINAL_TEXT` 讀不到終端內容時**丟錯**，不回空字串 | ✅ **最先做** |
| **A 類 14 條**（pty 行為） | 改為**讀檔**（`echo X > file` → 讀檔） | ✅ **嚴格更強**（能區分回顯與執行） |
| **B 類 8 條**（scrollback／重播） | 產品自己的**複製路徑**（拖曳選取 → 複製 → 讀系統剪貼簿）。實測 `getSelection()` 在兩種 renderer 下**逐字元相同**（結論 2） | ⚠️ 見下方限制 |
| **B 類 4 條**（字級） | **pty 的 `cols`**（D6 —— 「cell 幾何」的可行版本） | ✅ 相對關係可驗，絕對值不可 |
| **C 類 2 條**（休眠提示） | `elementFromPoint` 測堆疊順序 | ✅ 預期原樣存活 |
| **webgl 已啟用** | 代理判準：active 終端內存在 `<canvas>`（DOM renderer 無 canvas；實測 webgl 掛 3 個） | ✅ |
| **框線像素級正確** | —— | ❌ **驗不到**，由 code review + 本文件 + dogfood 承擔（比照 OSC 8 `linkHandler` 的先例） |

**B 類剪貼簿管道的限制（必須誠實）**：`term.selectAll()` 存在，但 **probe 呼叫不到它** —— xterm 實例在
`handleRef.current` 裡，暴露它就是往產品程式碼塞測試鉤子（本 repo 明文禁止）。既有那條複製斷言
（`probe-terminal.mjs:945-960`）靠的是**真滑鼠拖曳選取**，而拖曳**只選得到看得見的範圍**。因此：

- **看得見的畫面**（重播的歷史 + 分隔線的順序、alt buffer 的 `ALT_OK_81`）→ 拖曳選取涵蓋得到 ✅
- **超出畫面的 scrollback** → **拖曳選取涵蓋不到** ❌

**「切回 session 後其先前的輸出仍在」（1165、1412）這兩條若其內容已捲出畫面，本管道救不了它們。**
tasks 階段必須先確認那兩條的 fixture 內容是否落在可見範圍內；若否，它們是**本 change 的 Open Question**，
不得以「反正它綠著」蒙混（那正是假綠）。

### D8：預覽的框線要拿掉 —— 它會開始說謊

終端字型設定的即時預覽，其範例文字**含框線**（`en.json` 的 `settings.previewSample`：
`┌──────┬──────┐ / │ cell │ cell │ / └──────┴──────┘`）。它是**純 DOM 渲染**。

CLAUDE.md 早就預言了這個反轉：「preview 裡框線接不接得起來，就是終端裡表格會不會破。**（若日後 GPU
renderer 進來，這條就反了：那時 preview 的框線不再代表終端，得重新想。）**」

**現在就是那個「日後」。** webgl 之後，真終端的框線程式化繪製、預覽的框線來自字型 glyph —— 預覽會顯示
**終端不會有的縫**，使用者據此調整行高，調的是一個不存在的問題。

**裁決：把框線自預覽的範例移除。** 預覽的職責是「這個**字型**長什麼樣」，而框線在 webgl 下**不再是字型的
一部分**。保留字母／數字／易混淆字符（`il1 | oO0 {}[]()`）—— 那些才是選字型時真正要看的。

**替代方案**：(a) GPU 開時不顯示框線、關時顯示 —— 誠實但把一個設定的顯示綁在另一個設定上，複雜且沒人看得
懂。(b) 預覽也用 webgl —— 為了一塊預覽開第二個 context，與 D2 的「並存恆為 1」直接衝突。(c) 保留框線不動
—— 那是明知它說謊還留著。

## Risks / Trade-offs

- **[「捲動時破版」沒有被重現，因此無法宣稱修好]** → **本 change 的最大誠實缺口。** 我嘗試以合成 fixture
  重現（大量含框線的輸出 + 捲到不同位移），**失敗** —— 合成的表格結構本身就有合法的斷點，量到的是 fixture
  的結構而非渲染缺陷。真實情境的變數（claude 實際輸出的表格、使用者自己的字型 MesloLGS NF、真 pty 的捲動
  時序）合成不出來。**已知並已修的是靜態缺陷**：行高 > 1 的縫（D4）與分數像素的抹開（D5）。**捲動的部分
  只能由 dogfood 認定** —— 若 dogfood 之後仍破，本 change 沒有解決那個痛點，且要重新調查（不得因為「已經
  上了 webgl」就宣稱結案）。
- **[「表格」這個痛點可能不只一個病因]** → 上一個 change 修了行高（縫）、本 change 修分數像素（抹開）——
  兩者都是真的，但**都不是使用者原話裡的「捲動時」**。要有心理準備：dogfood 後可能還有第三個病因。
- **[切換 session 時建立／銷毀 webgl addon 的成本]** → 實測在乾淨實驗頁上無可見閃動，但**未在真實 app 量過**；
  列為 dogfood 觀察項。若可見，退路是「保留最近 N 個」（N ≪ 16）。
- **[context loss 的自癒在「超出上限」時不會觸發]**（結論 7 實測）→ 正是 D2「只給 active」的理由；並存恆為 1
  即碰不到上限。**但若日後有人放寬 D2，這條自癒不會救他** —— 已寫入 D2。
- **[驗收改寫的量很大（27 個觀測點 / 26 條斷言）]** → A 類 14 條改讀檔是**淨賺**（判準更強）；風險集中在 B 類
  的剪貼簿管道（D7 的限制）。**tasks 必須先做哨兵**，否則後續每一步都在假綠上前進。
- **[`probe:keyboard` 先前不在紀錄的爆炸半徑內]** → 它的三條否定式斷言（`leaked.length === 0`）是假綠重災區；
  1211 是唯一寫了 `&& ptyText !== ''` 的。哨兵一上，這三條會**立刻變紅**，那是好事（它們本來就該紅）。
- **[macOS / Windows 未實測]** → 本機僅 Linux + Mesa Intel。ANGLE 在 macOS 走 Metal、Windows 走 D3D11，
  行為可能不同。列入 Phase 6 打包前確認項（比照既有的 `ui-monospace` / `O_NOFOLLOW` 待確認項）。
- **[emoji 在 webgl 下的呈現]** → **實測通過**（`✳ 🚀 ✅ ❌ 中文寬字元` 於 webgl 下正常且彩色），proposal
  列的這個疑慮**已關閉**。

## Migration Plan

- 新增相依 `@xterm/addon-webgl@^0.19.0`（**`dependencies`，不是 `devDependencies`** —— 它會被 vite bundle
  進 renderer 產物，比照既有的 `@xterm/*`）。
- 無資料遷移：GPU 偏好不存在時＝預設開啟。舊版程式忽略該欄位，向後相容。
- **Rollback**：移除 webgl addon 的載入即可 —— xterm 自動退回 DOM renderer，其餘（偏好、觀測點改寫）皆
  無害殘留。**觀測點的改寫刻意設計為 renderer-agnostic**（讀檔、剪貼簿、cell 幾何在兩種 renderer 下都成立），
  於是 rollback **不需要把 probe 改回去**。

## Open Questions

- **B 類的「切回 session 後其先前的輸出仍在」（1165、1412）能不能靠拖曳選取涵蓋？** 取決於其 fixture 的
  內容是否落在可見範圍內（D7）。tasks 階段必須先確認；若涵蓋不到，需要另尋管道，**不得留著假綠**。
- **切換 session 時的 addon 建立成本在真實 app 是否可見？** 僅在乾淨實驗頁量過。
- **dogfood 之後「捲動時破版」是否真的消失？** 本 change 無法回答（見 Risks 第一條）。
