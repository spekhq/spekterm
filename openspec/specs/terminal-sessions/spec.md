# terminal-sessions Specification

## Purpose

主舞台的多 session 真 pty 終端 —— 這個工作台**駕駛 agent 的地方**（PRD §6.2：terminal 是主場）。

一個**運作中**的 session 就是一個受**擁有者生命週期**約束的 pty：初始 cwd 落在某個 workspace
folder 之內、**或該 folder 所屬 repo 的某個工作目錄（git worktree）之內**、**或（不隸屬任何
folder 的全域 session）使用者的家目錄**、與 renderer 雙向串流
（低延遲且嚴格保序）、隨終端可用尺寸同步 pty 的欄列數，並在關閉
分頁、renderer 重新載入、關閉視窗這三種路徑上都被確實終止 —— **不留孤兒行程**。spawn 目標由使用者
於建立時選擇（`claude` 或 login shell）。

**但「session」不等於「pty」**：由 `session-persistence` 重建出來的 session 是**休眠**的 —— 它有完整
的身分（名字、順序）與畫面，卻**還沒有 pty**，要到首次被顯示時才啟動一個。本規格的
各項要求，凡涉及 pty 者，皆指運作中的 session。

**cwd 的邊界只約束「初始」工作目錄，它不是沙箱。** session 一旦啟動即為真實 shell，pty 內執行
的命令不受此邊界限制（使用者可以 `cd` 到任何地方 —— 那正是終端的用途）。這與 `filesystem-access`
的「renderer 只能觸及 workspace」是**不同**的語意，不可據此推論。
## Requirements
### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 為該 folder 的根目錄，**或該 folder 所屬 repo 的某個工作目錄（git worktree）的根**；由 `session-persistence` **重建**的 session SHALL 為其最後已知的工作目錄，該目錄無法取得或不落在上述任一之下時 SHALL 退回該 folder 的根目錄。

**本要求的適用範圍為隸屬於某個 folder 的 session。** 不隸屬任何 folder 的 session 其位置解析、
工作目錄與邊界論證由 `global-session` 定義。

renderer SHALL 僅以 `folderId` 與一個**工作目錄識別碼**指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑。工作目錄識別碼 SHALL 為不可逆的值（不含路徑資訊），主行程 SHALL 以**查表**方式將它解析為路徑，且查表的範圍 SHALL 為 `folderId` 所指涉之 folder 所屬的 repo —— 於是 renderer 可達的位置集合恆等於**該 folder 所屬 repo** 之工作目錄的列舉結果，仍由結構保證，而非由字串驗證事後補救。

**全域歸屬 SHALL NOT 使上述保證鬆動**：它不引入任何新的路徑詞彙、識別碼空間或查表 —— renderer 至多
表達「這是一個全域 session」這件事，位置是主行程的常數。於是可達的位置集合恰好擴大**一個由主行程
決定的元素**（見 `global-session`）。

工作目錄的列舉 SHALL 與側欄 OpenSpec 資料所用的列舉**同源且同參數**。兩者若各自列舉，可達的位置集合就可能大於使用者在介面上看得到的集合，而上述「恆等於」的保證即失效。

主行程 SHALL 在工作目錄識別碼查無對應時**拒絕建立**，SHALL NOT 退回 folder 的根目錄 —— 靜默退回會讓一個錯誤的識別碼把 session 開在別的地方，而使用者以為它開在他選的工作目錄裡。

**重建的工作目錄仍不經 renderer 之手**：renderer 至多供應一個不可逆識別碼，路徑的解析、驗證與夾制一律由主行程完成（見 `session-persistence`）。主行程自行取得的工作目錄（例如 shell 的最後位置）SHALL NOT 送往 renderer。**此禁令的作用域為持久化** —— 狀態列為呈現而取得的當下工作目錄不在其內（見 `status-bar`）。

此邊界只約束**初始**工作目錄。session 一旦啟動即為真實 shell，pty 內執行的命令 SHALL NOT 被此邊界限制 —— 這與 `filesystem-access` 那種「renderer 只能觸及 workspace」的沙箱語意不同。

#### Scenario: 於可用 folder 建立成功

- **WHEN** renderer 以一個已加入且狀態正常的 `folderId` 建立 session，未指定工作目錄
- **THEN** 主行程回傳一個 session 識別碼，且該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 於指定的工作目錄建立 session

- **WHEN** renderer 以一個 `folderId` 與該 repo 某個 linked worktree 的工作目錄識別碼建立 session
- **THEN** 該 session 的 pty 初始工作目錄為該 worktree 的根

#### Scenario: 於 folder 邊界之外的工作目錄建立 session

- **WHEN** 指定的 worktree 位於該 folder 的邊界之外（例如 `/tmp` 之下）
- **THEN** 該 session 仍於該 worktree 的根建立 —— 合法性來自工作目錄的列舉，不是路徑的包含關係

#### Scenario: 拒絕查無對應的工作目錄識別碼

- **WHEN** 建立 session 所帶的工作目錄識別碼不對應該 repo 的任何工作目錄
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty
- **AND** 不以該 folder 的根目錄替代之

#### Scenario: 重建的 session 其初始工作目錄仍受夾制

- **WHEN** 一個重建的 session 被啟動，而其最後已知的工作目錄既不在該 folder 之下、也不在該 repo 任何工作目錄之下
- **THEN** 該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 拒絕未註冊的 folder 識別碼

- **WHEN** 建立 session 的 `folderId` 不對應任何已加入 workspace 的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 拒絕路徑失效的 folder

- **WHEN** 建立 session 的 `folderId` 對應一個路徑已失效的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 建立介面不接受任何路徑參數

- **WHEN** 檢視建立 session 的能力介面
- **THEN** 它僅接受歸屬（`folderId`，或全域）、spawn 目標與工作目錄識別碼，不存在讓 renderer 指定工作目錄路徑的參數

#### Scenario: 工作目錄識別碼不含路徑資訊

- **WHEN** 檢視 renderer 取得的工作目錄識別碼
- **THEN** 其值不可逆推為檔案系統路徑，且不含 workspace 之外位置的任何片段

### Requirement: 使用者選擇 session 的 spawn 目標

建立 session 時，使用者 SHALL 能選擇其 spawn 目標為 `claude` 或使用者的 login shell 兩者之一。選擇 login shell 時，session SHALL 提供一個互動 shell。選擇 `claude` 時，session SHALL 嘗試啟動 `claude` agent。

`claude` 無法在使用者環境中被找到或啟動時，終端 SHALL 顯示由底層 shell 產生的失敗訊息，且該 session SHALL 依其行程的結束而標示為已結束 —— SHALL NOT 靜默地毫無回應。

#### Scenario: 選擇 login shell

- **WHEN** 使用者建立 session 並選擇 login shell
- **THEN** 終端出現一個互動 shell 的 prompt，可接受指令

#### Scenario: 選擇 claude

- **WHEN** 使用者建立 session 並選擇 `claude`
- **THEN** session 嘗試啟動 `claude` agent

#### Scenario: claude 無法啟動

- **WHEN** 使用者選擇 `claude`，但環境中找不到 `claude` 命令
- **THEN** 終端顯示失敗訊息，且該 session 標示為已結束，而非靜默無回應

### Requirement: session 與其 pty 雙向串流

focused session 的終端 SHALL 將使用者鍵入的資料送抵其 pty，並 SHALL 將 pty 的輸出顯示於終端。輸出 SHALL 以其產生的順序顯示，SHALL NOT 被重排或合批到失去順序。

#### Scenario: 輸入送達並顯示輸出

- **WHEN** 使用者於 focused session 鍵入一條指令並送出
- **THEN** 該指令送抵 pty，且 pty 的對應輸出顯示於終端

#### Scenario: 輸出保序

- **WHEN** pty 連續產生多段輸出
- **THEN** 這些輸出以產生順序顯示於終端

### Requirement: 切換 session 保留各自的終端內容

非 focused 的 session 其 pty SHALL 持續運作，其於未顯示期間產生的輸出 SHALL NOT 遺失。使用者切回該 session 時，SHALL 能看到期間累積的輸出。

#### Scenario: 背景 session 的輸出於切回後可見

- **WHEN** 一個非 focused 的 session 的 pty 在未顯示期間產生輸出，使用者稍後切回該 session
- **THEN** 期間累積的輸出可見於該 session 的終端

### Requirement: 終端尺寸變化時 pty 尺寸同步

終端可用的顯示尺寸改變時，其 pty 的欄數與列數 SHALL 隨之更新，使 pty 內執行的程式以正確的寬度換行輸出。

#### Scenario: 尺寸改變後 pty 收到新的欄列數

- **WHEN** 終端的可用尺寸改變
- **THEN** 其 pty 的欄數與列數更新為與新尺寸相符的值

### Requirement: 終端的字元寬度與 pty 內程式所依據的寬度一致

終端判定一個字元佔用**幾個** cell 時，SHALL 與 pty 內程式所依據的現代 wcwidth 一致（Unicode 9 起
emoji 為 Wide），且 SHALL 以 **grapheme cluster** 而非單一 code point 為判定單位。

**理由**：pty 內的程式（agent、任何做對齊輸出的工具）依現代 wcwidth 排版。兩邊的認定不一致時，
每一個認定不同的字元都會使該行其餘內容位移一格。表格是唯一會把這件事明白畫出來的形式（框線跑位），
但**缺陷涵蓋任何對齊的輸出** —— 清單、進度、欄位對齊皆然，而 agent 的輸出大量使用 emoji。

**為什麼判定單位必須是 cluster 而非 code point**：`U+26A0`（⚠）本身是 ambiguous —— 單看這個
code point，寬度就是 1，任何版本的寬度表皆然。它之所以成為兩格，是因為後隨的 VS16（`U+FE0F`）
把它推進 emoji presentation，而**那是 cluster 層的事實，不是任何單一 code point 的屬性**。因此
「採用較新版本的寬度表」不構成滿足本要求的充分手段。

**生效時機是承重的**：寬度判定 SHALL 於任何內容寫入終端**之前**即已生效，包含 session 重建時
重播的歷史快照。buffer 的 cell 佔用於寫入的當下決定，事後更換判定 SHALL NOT 被期待會重排既有內容
—— 順序錯誤的後果是「歷史是歪的、新輸出是對的」。

**失效方向**：所採用的寬度判定若無法建立，SHALL NOT 靜默沿用較舊的判定。靜默降級會使本要求完全
失效，而其外在呈現僅是「emoji 又少一格」—— **與從未實作本要求無法區分**。

**呈現正確性的建立方式（與相鄰要求的區別，此段為規範性）**：本要求的對象是 **cell 的佔用**，
那是確定性的資料，且兩種渲染路徑讀取的是同一份 buffer。因此「終端的字格渲染獨立於字型的 glyph
幾何」所載明的驗收限制 —— 畫素層級的正確性不得被視為可由自動化驗收建立 —— **不適用於本要求**。
本要求 SHALL 可由自動化驗收建立，SHALL NOT 以「需要真實圖形驅動」為由降低其驗收強度。

**驗收判準的鑑別力（此段亦為規範性）**：本要求 SHALL NOT 以「把終端內容複製出來比對文字」或
「選取一段內容比對所得字串」建立。複製與選取都是把 cell 轉回字串 —— 一個字元少佔一格時，
**字元序列完全不變**，所得因而在滿足與不滿足本要求時完全相同。判準 SHALL 取自 cell 佔用的可觀察
後果（該字元寫入後游標前進的格數、或同排版各行的右緣位置），且 SHALL 以對照組確認其鑑別力。

**涵蓋範圍（此段為規範性）**：驗收 SHALL 以按**類別**組織的代表性字元集進行，至少涵蓋：
BMP 寬字元、**星形平面（碼位 ≥ U+10000）寬字元**、BMP emoji、星形平面 emoji、**基底＋VS16**、
**ZWJ 序列**、**膚色修飾**，以及窄字元對照。

**SHALL NOT 以少數個別字元的通過推論整體正確** —— 不同實作的缺陷落在不同類別上，一個只涵蓋兩三個
字元的案例集，可能對兩個能力差距極大的實作給出相同的結論，或給出與事實相反的排序。此段是規範性的，
因為它防的不是實作缺陷而是**驗收設計**的缺陷，而後者不會被任何實作層的測試抓到。

#### Scenario: 代表性字元集的 cell 佔用逐類別正確

- **WHEN** 終端逐一寫入涵蓋上述各類別的代表性字元
- **THEN** 每一個字元佔用的 cell 數符合現代 wcwidth，**每一個類別皆然** —— 任一類別失敗即為
  本要求未被滿足，SHALL NOT 因其餘類別通過而視為部分達成

#### Scenario: 含 emoji 的行與純 ASCII 的行等寬

- **WHEN** 終端寫入數行由同一份排版產生、應當等寬的內容，其中一行的欄位值為 emoji、另一行為
  同寬的純 ASCII、另一行為框線
- **THEN** 三行的右緣位置相同，含 emoji 的那一行 SHALL NOT 較其餘各行短少任何格數

#### Scenario: 多 code point 組成的 cluster 佔一個字的寬度

- **WHEN** 終端寫入由多個 code point 組成、應呈現為單一字的 cluster —— 基底＋VS16（`⚠️`）、
  ZWJ 序列（`👨‍👩‍👧`）、或帶膚色修飾的 emoji（`👍🏽`）
- **THEN** 每一者各佔用兩個 cell，SHALL NOT 因其組成的 code point 數量而佔用更多格數

#### Scenario: 重播的歷史沿用同一份寬度判定

- **WHEN** session 重建並重播含 emoji 的歷史畫面快照
- **THEN** 該歷史的對齊與其產生當下一致，SHALL NOT 出現「歷史歪、新輸出正」的分歧

#### Scenario: 寬度判定無法建立時明確失敗

- **WHEN** 所指名的寬度判定不存在於可用的判定清單中
- **THEN** 該情形 SHALL 以明確的失敗呈現，SHALL NOT 靜默沿用較舊的判定

### Requirement: 終端的字格渲染獨立於字型的 glyph 幾何

終端呈現 block element 與 box-drawing 字元時，SHALL NOT 倚賴字型自身的 glyph 幾何 —— 這些字元 SHALL 依 cell 的邊界程式化繪製。

**倚賴 glyph 的呈現有兩個各自獨立的缺陷，它們在不同的方向上壞掉：**

- **垂直方向**：glyph 僅約 1em 高，而 cell 的高度是 `字級 × 行高` —— 行高大於 1 時，上下列的框線之間留縫。
- **水平方向**：cell 的寬度是分數像素時，落在整數像素上的框線銳利、落在分數位置的被反鋸齒攤到兩個像素而成為兩道淡線 —— **同一張表格內的框線因而粗細不一**。此缺陷與行高無關，**行高為 1 時依然存在**。

因此：

- 框線的連續性 SHALL NOT 隨行高改變。
- 框線的呈現 SHALL NOT 隨 cell 落在整數或分數像素而改變。
- 程式化繪製不可用時，終端 SHALL 退回倚賴 glyph 的呈現 —— SHALL NOT 崩潰、SHALL NOT 呈現空白、SHALL NOT 遺失既有內容。**該降級路徑是真實可達的**（渲染資源取不到、驅動有缺陷、或使用者自行關閉 GPU 加速），因此凡以「框線是否相接」為據的預設值，SHALL 以降級路徑為準（見 `terminal-preferences`）。

**呈現正確性的建立方式（本條的驗收限制）**：上述前兩點所描述的**畫素層級的正確性** SHALL NOT 被視為可由自動化驗收建立 —— 它取決於實際作用中的圖形驅動，而自動化驗收在無圖形硬體的環境下取得的是軟體實作的渲染路徑。**軟體渲染路徑證明得了資源的生命週期（取得、釋放、退回），證明不了畫素**。因此：

- 自動化驗收通過 SHALL NOT 被詮釋為「程式化繪製的呈現是正確的」。
- 這兩點的正確性 SHALL 於具備真實圖形驅動的環境中實地確認。

此限制是誠實性要求，不是缺口的藉口：把它寫明，是為了讓後續變更不會因為「驗收是綠的」而誤以為這一面已被涵蓋。

#### Scenario: 框線於任何行高下皆相接

- **WHEN** 終端以程式化繪製呈現含框線的輸出，且行高設為大於 1 的值
- **THEN** 上下列的框線相接，SHALL NOT 因行高而留下縫隙

#### Scenario: 框線的粗細不隨 cell 的像素落點改變

- **WHEN** 終端以程式化繪製呈現含框線的輸出，且 cell 的寬度為分數像素
- **THEN** 同一輸出內的各條框線呈現一致，SHALL NOT 有的銳利、有的被攤為兩道淡線

#### Scenario: 程式化繪製不可用時退回且不遺失內容

- **WHEN** 程式化繪製的渲染路徑無法建立，或於執行期失效
- **THEN** 終端以倚賴 glyph 的方式繼續呈現，既有內容仍在，SHALL NOT 崩潰或呈現空白

### Requirement: 程式化繪製的渲染資源僅供當下顯示的終端

程式化繪製所需的渲染資源 SHALL 僅由使用者當下看得見的那一個終端持有；終端由顯示轉為隱藏時 SHALL 釋放之，由隱藏轉為顯示時 SHALL 取得之。

**理由，以及為什麼這不是一項優化而是正確性要求**：所有 session 的終端**同時掛載**（各自保留 scrollback，見「切換 session 保留各自的終端內容」）。而該渲染資源在瀏覽器中有**並存數上限**，**超出上限時最早取得的會被靜默回收 —— 不觸發任何可觀察的事件**。若每個終端各持有一份：開了足夠多 session 的使用者會看到較舊的終端**無聲地變成空白**，而上一條的「不可用時退回」**救不了他** —— 那條自癒倚賴一個失效通知，而這裡根本沒有通知。

「需要框線正確」的地方恰好就是「使用者看得見」的地方，因此此限制不損及能力。

**「釋放」SHALL 指歸還並存額度，SHALL NOT 僅指移除該路徑在文件中留下的產物。** 這兩者是可以分離的，而實測它們確實分離了：底層套件的解除掛載會移除產物，卻**不歸還額度** —— 額度要等垃圾回收，而上限的檢查是即時的。於是「已釋放」的資源仍佔著位置，直到把使用中的那一個擠掉。**一個只移除產物的實作滿足不了本要求**，即使它看起來做了釋放的動作。

**「持有」的判定依據**：一個終端是否持有該渲染資源，SHALL 依據**它當下實際使用的渲染路徑**判定 —— 程式化繪製路徑與倚賴 glyph 的路徑各自有專屬於該終端、且隨路徑切換而建立與移除的產物，判準 SHALL 取自它們。

**而渲染路徑在文件中留下的產物，並非每一個都屬於某一個終端**：其中有**跨終端共用**、且會在終端之間**遷移**的暫存物（實測的實例：glyph 光柵化用的暫存畫布 —— 它為了繼承字型設定而必須掛在某個終端的節點下，且因為字型設定相同的終端共用同一份 glyph 快取，全域只有一份，會停留在最近一次光柵化的那個終端底下）。此類共用暫存物 SHALL NOT 被視為「該終端持有渲染資源」的證據。

**這條判定依據是本要求的一部分，不是驗收的細節**：一個把共用暫存物誤認為 per-terminal 狀態的判準，會在資源真的洩漏時保持沉默、卻在一切正常時間歇地報錯 —— 兩個方向都錯，且後者會誘使人把它當成不穩定而忽略它。

**上述判定依據涵蓋「路徑是否切換」，SHALL NOT 被當作「額度是否歸還」的證據** —— 產物的移除由套件自己完成，因此依它判定的斷言**在額度未歸還時依然全綠**。額度的歸還需要各自的驗收（見下）。

**取得該資源參照的查詢，SHALL 侷限於該終端自己的子樹，SHALL NOT 以整份文件為範圍。** 所有終端同時掛載，因此以文件為範圍的查詢會回傳**另一個終端**的資源 —— 釋放它等於讓一個**正在顯示**的終端當場變成空白，而那正是本要求所要防止的結果本身，且同樣不觸發任何事件。終端銷毀的路徑更確定：該終端的節點此時已脫離文件，以文件為範圍的查詢**只可能**命中別人的。

**該查詢亦 SHALL NOT 可能命中共用暫存物或其他既存節點。** 命中錯的節點時，真正該被釋放的那一個不會被釋放（本要求靜默失效）；而若命中的節點尚未持有任何繪製脈絡，查詢其脈絡**會當場建立一個新的**，那時失效方向與本要求相反。**以「取得該資源時新增了哪些節點」為判準，可使上述兩種誤選在結構上皆不可能發生** —— 那比列舉要排除哪些節點更穩固，後者是黑名單，會隨底層套件新增節點而靜默失效。

#### Scenario: 任一時刻只有顯示中的終端持有渲染資源

- **WHEN** 使用者建立多個 session 並在其間切換
- **THEN** 任一時刻僅有顯示中的那一個終端使用程式化繪製路徑，其餘皆已退回倚賴 glyph 的路徑

#### Scenario: 切回的終端重新取得渲染資源且內容完整

- **WHEN** 使用者切離一個 session 後再切回
- **THEN** 該終端重新以程式化繪製呈現，且其先前的內容仍在

#### Scenario: 共用的暫存物不構成持有的證據

- **WHEN** 一個已退回倚賴 glyph 路徑的隱藏終端，其節點下仍存在跨終端共用的渲染暫存物
- **THEN** 該終端仍被判定為未持有程式化繪製的渲染資源

#### Scenario: 釋放後該資源即為失效狀態

- **WHEN** 一個終端由顯示轉為隱藏而釋放其渲染資源
- **THEN** 該資源於釋放後即處於失效狀態，不再佔用並存額度

#### Scenario: 僅移除產物而不歸還額度即失敗

- **WHEN** 釋放的實作改為只解除掛載、不歸還額度
- **THEN** 驗收失敗

#### Scenario: 釋放的參照取自該終端自己

- **WHEN** 一個終端釋放其渲染資源
- **THEN** 被釋放的是該終端自己的資源，其餘終端持有的資源不受影響

### Requirement: session 生命週期釋放，不留孤兒行程

關閉單一 session 時，其 pty 行程 SHALL 被終止。擁有 session 的視窗關閉、或其 renderer 重新載入（導航至應用程式自身來源）時，該 renderer 建立的所有 pty 行程 SHALL 被終止，SHALL NOT 留下任何孤兒行程。

重新載入後的頁面 SHALL NOT 接收先前 pty 的輸出 —— 舊 pty 的串流連同舊 renderer 一併釋放。

#### Scenario: 關閉單一 session 終止其 pty

- **WHEN** 使用者關閉一個運作中的 session
- **THEN** 該 session 的 pty 行程被終止

#### Scenario: 關閉視窗終止其所有 pty

- **WHEN** 擁有若干運作中 session 的視窗被關閉
- **THEN** 該視窗建立的所有 pty 行程皆被終止，不留下任何孤兒行程

#### Scenario: 重新載入釋放先前的 pty

- **WHEN** renderer 重新載入
- **THEN** 先前建立的所有 pty 行程被終止，且重新載入後的頁面不接收任何先前 pty 的輸出

### Requirement: pty 結束在 UI 呈現，不靜默消失

session 的 pty 自行結束（例如使用者於 shell 執行 `exit`、或 `claude` 收工）時，該 session SHALL 在 UI 被標示為已結束，SHALL NOT 自動從清單消失 —— 使用者仍應能看到它最後的輸出。使用者事後 SHALL 能手動關閉一個已結束的 session。

#### Scenario: pty 結束後標示為已結束

- **WHEN** 一個 session 的 pty 自行結束
- **THEN** 該 session 於 UI 標示為已結束，且仍保留在清單中，其最後的輸出仍可見

#### Scenario: 手動關閉已結束的 session

- **WHEN** 使用者關閉一個已結束的 session
- **THEN** 該 session 自清單移除，此時無 pty 需要終止

### Requirement: 啟動失敗以 session 結束與終端訊息呈現，不使應用程式崩潰

所選的 shell 或命令無法執行時（shell 路徑無效、或 `claude` 不存在），該 session SHALL 以其行程的非零結束呈現，且失敗訊息 SHALL 顯示於終端；應用程式 SHALL NOT 因此崩潰。

**建立 session 的呼叫本身 SHALL NOT 因此失敗** —— 實測（node-pty 1.2.0-beta.14）：`spawn` 對 execvp 失敗**不同步拋錯**，它成功回傳一個 pty，該 pty 隨即以非零碼結束，並由輸出串流送出 `execvp(3) failed.` 這類訊息。於是 shell 路徑無效與 `claude` 找不到**殊途同歸**，都走「非零結束 + 終端訊息」這條路徑，而不是回一個錯誤碼。

建立呼叫的錯誤碼只留給**底層 pty 無法配置**這種罕見情形（那才會同步拋錯）。

#### Scenario: shell 或命令無法執行

- **WHEN** 建立 session 後，所選的 shell 或命令無法被執行
- **THEN** 該 session 以非零碼結束，終端顯示失敗訊息，應用程式維持運作

#### Scenario: 建立呼叫不因命令不存在而失敗

- **WHEN** 建立 session 時所指定的 shell 路徑無效
- **THEN** 建立呼叫仍成功回傳 session 識別碼，失敗改以該 session 的非零結束呈現

#### Scenario: 底層 pty 無法配置

- **WHEN** 建立 session 時底層 pty 無法被配置
- **THEN** 建立呼叫以錯誤碼回報失敗，應用程式維持運作

### Requirement: session 的標籤反映 pty 設定的終端標題

**spawn 目標為 `claude` 的 session**，其 pty 內執行的程式 SHALL 能決定該 session 的標籤：程式送出設定終端標題的序列（OSC）時，該 session 在 UI 上的每一處呈現（分頁與 rail 子列）SHALL 以該標題為標籤。

session 的身分因此由**跑在裡面的東西**宣告，而不是由本應用程式的流水號決定 —— 這正是終端模擬器讓分頁自動改名的同一個機制。

**spawn 目標為 login shell 的 session SHALL NOT 採用 pty 宣告的標題**，一律使用由 spawn 目標與序號組成的本地標籤（`shell 1`、`shell 2`…）。login shell 宣告的標題是它的預設 prompt 標題（`使用者@主機:/路徑`），對使用者不具識別意義；且它比 session 本身晚抵達，採用它會使分頁的寬度在使用者眼前突變，把緊鄰其後的建立入口推離游標。

pty 從未設定標題（或設定為空）時，標籤 SHALL 退回一個由 spawn 目標與序號組成的本地標籤。

標籤過長時 SHALL 截斷呈現，且**完整標題 SHALL 仍可自該元素的提示取得** —— 截斷是呈現上的取捨，不是資料的遺失。

#### Scenario: claude session 的 pty 設定標題後標籤隨之更新

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 內的程式送出設定終端標題的序列
- **THEN** 該 session 於分頁與 rail 子列的標籤更新為該標題

#### Scenario: login shell 的 session 不採用 pty 宣告的標題

- **WHEN** 一個 spawn 目標為 login shell 的 session，其 pty 送出設定終端標題的序列
- **THEN** 該 session 的標籤**維持**本地標籤（`shell N`），不因該標題而改變

#### Scenario: pty 未設定標題時退回本地標籤

- **WHEN** 一個 session 的 pty 從未設定終端標題
- **THEN** 該 session 的標籤為由其 spawn 目標與序號組成的本地標籤

#### Scenario: 過長的標題被截斷但不遺失

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 設定了一個超出可呈現長度的標題
- **THEN** 標籤以截斷後的形式呈現，且完整標題可自該元素的提示取得

### Requirement: 終端支援複製與貼上

終端 SHALL 提供複製選取內容與貼上剪貼簿內容的能力，且 SHALL 同時提供**滑鼠**與**鍵盤**兩條路徑 —— 終端若不能複製貼上，等同不能使用。

- **鍵盤**：SHALL 提供複製與貼上的快捷鍵。鍵盤路徑 SHALL NOT 受 pty 是否啟用 mouse reporting 影響。
- **右鍵（gate 在 mouse reporting）**：pty 內的程式**未啟用** mouse reporting 時，右鍵 SHALL 開啟複製／貼上選單（無選取內容時複製 SHALL 為停用）；程式**已啟用** mouse reporting（例如 claude 接管滑鼠）時，右鍵 SHALL 交由該程式處理（由 xterm 轉發），終端 SHALL NOT 開啟自己的選單 —— 否則會與程式自身的右鍵慣例（如右鍵貼上）雙重作用。當下的 mouse reporting 狀態 SHALL 於事件發生時判定（程式會在執行期間動態開關）。原生瀏覽器選單 SHALL 一律不呈現。
- **中鍵（一律由終端擁有）**：中鍵貼上是終端的慣例，SHALL 一律由終端貼上剪貼簿的內容，且**恰好一次**，**與 mouse reporting 是否啟用無關**。終端 SHALL 擋掉瀏覽器原生的中鍵貼上、且 SHALL NOT 把中鍵轉發給 pty 內的程式 —— 否則原生貼上與程式的處理會疊加成多次貼上。

**`Ctrl+C` SHALL 維持送出中斷訊號（SIGINT），SHALL NOT 被挪用為複製** —— 使用者中斷失控程式的能力，不得因畫面上剛好有一段選取而失靈。複製因此採用終端模擬器慣用的 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不與中斷訊號衝突，故於該平台使用 `Cmd+C`／`Cmd+V`）。

貼上的內容 SHALL 原封不動地送交 pty，SHALL NOT 被過濾或轉換。

#### Scenario: 未啟用 mouse reporting 時自右鍵選單複製與貼上

- **WHEN** pty 內的程式未啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 出現包含複製與貼上的選單，且該選單完整落在可視範圍內

#### Scenario: 無選取內容時複製為停用

- **WHEN** pty 未啟用 mouse reporting、終端中沒有任何選取內容，使用者開啟右鍵選單
- **THEN** 複製項目為停用狀態

#### Scenario: 啟用 mouse reporting 時右鍵讓位給程式

- **WHEN** pty 內的程式已啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 終端 SHALL NOT 開啟自己的選單，該滑鼠事件交由 pty 內的程式處理

#### Scenario: 中鍵貼上恰好一次

- **WHEN** 剪貼簿中有一段文字，使用者於終端按下中鍵（無論 pty 是否啟用 mouse reporting）
- **THEN** 該段文字**恰好一次**送交 pty，SHALL NOT 因瀏覽器原生中鍵貼上或程式的轉發處理而重複

#### Scenario: 複製選取的內容

- **WHEN** 使用者選取終端中的一段輸出並觸發複製
- **THEN** 該段內容被寫入系統剪貼簿

#### Scenario: 以鍵盤貼上的內容送達 pty

- **WHEN** 剪貼簿中有一段文字，使用者以貼上快捷鍵觸發貼上
- **THEN** 該段文字原封不動地送交 pty

#### Scenario: Ctrl+C 仍為中斷訊號

- **WHEN** 使用者於終端中按下 `Ctrl+C`（無論當下是否有選取內容）
- **THEN** 中斷訊號送交 pty，複製 SHALL NOT 發生

### Requirement: 讀取系統剪貼簿的能力僅在使用者明確要求貼上時使用

renderer 取得的剪貼簿讀取能力 SHALL 僅於使用者明確觸發貼上時使用（右鍵選單、快捷鍵、中鍵），SHALL NOT 主動讀取、SHALL NOT 背景輪詢、SHALL NOT 於啟動時讀取。

系統剪貼簿**沒有 workspace 邊界可言** —— 它可能存放使用者剛複製的任何東西。此能力的可接受性建立在兩道前提之上：renderer 不會被導航至應用程式自身來源之外（見 `workspace-app-shell` 的導航防護），以及讀取只發生於使用者的明確意圖之下。

#### Scenario: 未觸發貼上時不讀取剪貼簿

- **WHEN** 應用程式啟動並開啟 session，使用者未觸發任何貼上操作
- **THEN** 系統剪貼簿的內容未被讀取

### Requirement: 終端內的連結一律經受控接縫開啟

終端內被觸發的連結，無論其為輸出中的純文字 URL 或 OSC 8 escape-sequence 超連結，SHALL 一律交由
主行程驗證協定後以系統的預設瀏覽器開啟。終端呈現的內容是不受信任的 —— pty 的輸出中，使用者 repo
裡的任何東西都可能印出一個 URL。

終端內的連結 SHALL NOT 落入終端模擬器的內建預設連結處理器 —— 該預設會彈出一個其文字由不受信任
輸出所控制的確認對話框，並嘗試自行開啟視窗。僅協定屬於 `http` 或 `https` 的連結 SHALL 被開啟，
其餘協定 SHALL 被拒絕；此協定驗證 SHALL 在主行程執行。

#### Scenario: 終端輸出中的 OSC 8 超連結被觸發

- **WHEN** pty 輸出一個 OSC 8 超連結，且使用者觸發它
- **THEN** 該連結經主行程的協定驗證後交由系統瀏覽器開啟，且不彈出終端模擬器內建的確認對話框

#### Scenario: 終端連結的非安全協定被拒絕

- **WHEN** 終端內一個協定不屬於 `http` 或 `https` 的連結被交付至主行程
- **THEN** 主行程拒絕開啟它

### Requirement: 主行程的剪貼簿寫入對畸形輸入防禦

主行程接收 renderer 剪貼簿寫入請求的進入點 SHALL 對輸入型別防禦：收到非字串的輸入時 SHALL 丟棄
該請求，且 SHALL NOT 因此產生未捕捉的例外。

renderer 端的型別標註屬編譯期，不構成執行期防護 —— 一個被入侵或有 bug 的 renderer 可送出任意
型別的值。此防護 SHALL 在主行程這一側執行。

#### Scenario: renderer 送出非字串的剪貼簿寫入

- **WHEN** renderer 對剪貼簿寫入進入點送出一個非字串的值
- **THEN** 該請求被丟棄，主行程不產生未捕捉的例外並繼續正常運作

#### Scenario: 正常的字串寫入不受影響

- **WHEN** renderer 送出一個字串以寫入系統剪貼簿
- **THEN** 該文字被寫入系統剪貼簿

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱，**不分 spawn 目標**。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > pty 宣告的終端標題（僅 `claude` 目標）> 由 spawn 目標與序號組成的本地標籤**。

**指定名稱 SHALL 視為使用者永久接管該 session 的命名權。** 此後 pty 送出設定終端標題的序列時，該標題 SHALL NOT 覆蓋使用者指定的名稱，且系統 SHALL NOT 因此呈現任何確認或提示 —— 該標題被靜默地不予呈現。

此規則**不因 pty 送出的標題與先前是否相同而異**：pty 反覆宣告同一個標題，與宣告一連串不同的標題，處理方式相同 —— 皆不呈現、不打斷。

**pty 宣告的標題 SHALL 於使用者接管期間持續被記錄**（僅不呈現）。

使用者將名稱清空 SHALL 視為放棄命名權：`claude` 目標的 session 標籤**立即**回到 pty **最近一次**宣告的標題（含接管期間所宣告者；pty 從未宣告過時則為本地標籤），login shell 的 session 則回到本地標籤。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: 命名後 pty 宣告不同的標題不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 送出一個與該名稱不同的終端標題
- **THEN** 不呈現任何對話框或提示，且該 session 的標籤維持使用者指定的名稱

#### Scenario: 命名後 pty 反覆宣告標題仍不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 連續送出多個終端標題（含與先前相同者）
- **THEN** 全程不呈現任何對話框或提示，且該 session 的標籤始終維持使用者指定的名稱

#### Scenario: claude session 清空名稱後立即回到 pty 最近宣告的標題

- **WHEN** 使用者將某個 spawn 目標為 `claude`、且其 pty 曾於接管期間宣告過標題的 session 的名稱清空
- **THEN** 該 session 的標籤**立即**變為 pty 最近一次宣告的標題，不需等待 pty 再次宣告

#### Scenario: claude session 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某個 spawn 目標為 `claude` 的 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

#### Scenario: login shell 的 session 清空名稱後回到本地標籤

- **WHEN** 使用者將某個 spawn 目標為 login shell 的 session 的名稱清空
- **THEN** 該 session 的標籤回到本地標籤（`shell N`），即使其 pty 曾宣告過標題

### Requirement: session 的歸屬有兩種，且兩者在型別上互斥

一個 session 的**歸屬** SHALL 為下列之一：某個 workspace folder，或**全域**（不隸屬於任何
folder，見 `global-session`）。

renderer 與 preload 的介面 SHALL 在型別上使這兩者**互斥且不可混淆**：表達「不隸屬任何 folder」的
方式 SHALL NOT 是一個保留的 folder 識別碼字串。以字串偽裝會使每一處「以識別碼查找 folder」的呼叫
靜默地查回空值而非錯誤，而型別檢查對此無能為力。

**型別互斥發生在 renderer 與 preload，輸入驗證發生在 IPC 的入口** —— 兩者不可互相取代：主行程收到
的是**不受信任的輸入**（IPC 的另一端可能是被入侵或過期的 renderer），因此
`global-session`「全域 session 帶工作目錄識別碼即拒絕」那條 SHALL 在主行程實作並可被測試，
SHALL NOT 以「型別上表達不出來」為由略去。

本能力的其餘要求（雙向串流、尺寸同步、生命週期釋放、標題、複製貼上、命名權）SHALL 同等適用於兩種
歸屬的 session，SHALL NOT 因歸屬而有差異。

#### Scenario: 兩種歸屬的 session 並存

- **WHEN** 使用者同時開啟一個隸屬於某 folder 的 session 與一個全域 session
- **THEN** 兩者各自運作，各自的終端內容互不影響

#### Scenario: 全域 session 同樣享有本能力的其餘保證

- **WHEN** 使用者於一個全域 session 內調整終端尺寸、選取文字並複製、為該 session 命名
- **THEN** 其行為與隸屬於 folder 的 session 相同

#### Scenario: 歸屬的表達不以保留識別碼字串偽裝

- **WHEN** 檢視建立 session 的能力介面與 session 的執行期狀態
- **THEN** 「不隸屬任何 folder」以一個與 folder 識別碼互斥的形式表達，而非一個保留的字串值

### Requirement: 渲染資源的釋放在無法完成時發出訊息

釋放渲染資源時，若無法取得該資源的參照，實作 SHALL 於主控台輸出一則訊息，SHALL NOT 靜默略過。

**理由**：取得參照倚賴底層套件的內部結構，而該結構會隨套件版本改變。失效時的行為是「什麼都不做」——
與「正確釋放了」在外部**完全無法區分**，且後果（額度不歸還、使用中的終端被擠掉、無任何事件）
正是本能力所要防止的那一種靜默失效。**這個缺陷本身就是「看起來做了事、實際上沒做」造成的**，
其修復不應再引入同一個形狀的盲點。

該訊息屬於主控台輸出，非使用者可見文案，因此 SHALL NOT 進入文案字典，但 SHALL 以英文撰寫。

#### Scenario: 取不到渲染資源的參照時發出訊息

- **WHEN** 終端釋放渲染資源，但無法取得該資源的參照
- **THEN** 主控台出現一則指出該情形的訊息

### Requirement: 額度歸還的驗收以資源自身的失效狀態為觀察對象

驗證「釋放是否歸還額度」的驗收，SHALL 以**該資源本身是否已失效**為觀察對象，SHALL NOT 以
「並存上限被觸發時誰先被回收」為觀察對象。

**理由是鑑別力，而且是結構上的**：歸還額度的動作使該資源**立即**進入失效狀態，因此持有其參照
即可直接觀察 —— 未歸還時必為未失效，已歸還時必為失效，兩者不可能相同。反之，以「誰先被回收」
為觀察對象時，回收順序（最早取得者優先）會使兩種實作在多數佈局下得到**完全相同**的結果，
驗收因此靜默失去鑑別力；實測已兩次得到這種無差別的結果，並差點據此推翻一個正確的結論。

**驗收持有該資源的參照，這件事本身是承重的**：它使觀察不受垃圾回收時機影響。未歸還額度的
實作之所以在多數情況下沒有出事，正是因為垃圾回收碰巧來得及 —— 一個受回收時機影響的驗收，
測到的是回收器的心情，不是實作的正確性。

#### Scenario: 以資源自身的失效狀態判定

- **WHEN** 驗證一個終端釋放渲染資源後額度是否歸還
- **THEN** 斷言的對象是該資源自身是否已失效，而非其他資源是否被回收
