## ADDED Requirements

### Requirement: listFiles 遞迴列舉可供選擇的檔案

`listFiles` SHALL 以 `(folderId, relPath)` 定址一個目錄，並回傳該目錄之下**遞迴**的檔案清單。

**每個項目 SHALL 為 folder-relative 路徑** —— 與 `watch` 推送的事件、與 `readFile` 的參數屬於
**同一個座標系**。它 SHALL NOT 以相對於 `relPath` 的路徑表達：呼叫端取得清單的目的就是把項目
交給其他 `fs.*` 操作，兩種座標系並存只會把一次換算的責任推給每一個呼叫端，而換算漏掉時的症狀是
**打開另一個同名的檔案**，沒有任何錯誤。

它 SHALL 受與 `listDir` **完全相同**的邊界約束：絕對路徑、以 `..` 逃逸、經 symlink 逃逸、未註冊
的 `folderId` 一律拒絕。**本要求不放寬既有的任何一條邊界** —— 它只是換一種列舉的粒度，定址的詞彙
（folder 識別碼 ＋ folder-relative 路徑）一個字都沒有改變。

**遞迴 SHALL NOT 跟隨符號連結進入目錄。** 邊界的包含關係判定是**字面**比較，一條指向 folder 之外
的 symlink 目錄，其下的檔案路徑在字面上仍位於 folder 之內 —— 判定必定放行，邊界會從這道側門漏掉
（此為既有教訓：檔案監看曾因預設跟隨 symlink 而把邊界外的檔名推給 renderer）。這也避免 folder
**之內**的 symlink 目錄使同一個檔案以兩條路徑重複出現。

回傳的每一個路徑 SHALL 在推送給 renderer 之前通過與 `listDir` 相同的包含關係判定。列舉的來源
若為外部程式，其輸出 SHALL NOT 被信任為「必然位於邊界之內」—— 邊界保證的來源是我們自己的判定，
不是來源程式的性質。

清單 SHALL 只含檔案，SHALL NOT 含目錄。

檔名不限於 ASCII。列舉的來源若對非 ASCII 位元組施加任何轉義或引號，`listFiles` SHALL 還原為原始
的檔名 —— 一個被轉義的路徑在清單中看起來像亂碼，且拿它去 `readFile` 會得到「找不到檔案」。

#### Scenario: 回傳的路徑為 folder-relative

- **WHEN** renderer 以一個位於 folder 之下數層的目錄為目標呼叫 `listFiles`
- **THEN** 回傳的每個項目皆為自 folder 根起算的路徑，可直接作為 `readFile` 的 `relPath` 使用

#### Scenario: 回傳遞迴的檔案清單

- **WHEN** renderer 對一個已加入的 folder 呼叫 `listFiles`，目標目錄之下有多層子目錄
- **THEN** 回傳的清單含有各層之下的檔案

#### Scenario: 清單不含目錄

- **WHEN** 目標目錄之下同時含有檔案與子目錄
- **THEN** 回傳的清單只含檔案

#### Scenario: 不跟隨指向 folder 之外的 symlink 目錄

- **WHEN** 目標目錄之下有一個指向 folder 邊界之外的 symlink 目錄，其中含有檔案
- **THEN** 回傳的清單不含該 symlink 之下的任何檔案

#### Scenario: 不因 folder 之內的 symlink 目錄而重複

- **WHEN** 目標目錄之下有一個指向該 folder 內另一個目錄的 symlink
- **THEN** 該目錄之下的每個檔案在清單中恰好出現一次

#### Scenario: 拒絕逃逸出邊界的路徑

- **WHEN** `listFiles` 的 `relPath` 為絕對路徑、含 `..` 且解析後落在 folder 之外、或指向一個真實路徑落在 folder 之外的 symlink
- **THEN** 呼叫被拒絕並回報錯誤，不回傳任何清單

#### Scenario: 非 ASCII 檔名以原始形式回傳

- **WHEN** 目標目錄之下含有檔名為非 ASCII 字元的檔案
- **THEN** 該項目於清單中為原始檔名，且以它呼叫 `readFile` 可讀到該檔案的內容

### Requirement: listFiles 排除其他工作目錄與版控忽略的內容

`listFiles` SHALL 排除位於**其他 git 工作目錄**之下的檔案，以及版本控制所忽略的內容。

**排除其他工作目錄是本要求的重點。** 一個 repo 的 git worktree 可能位於該 repo **自身之內**
（使用者的標準工作流即如此），此時天真的遞迴會使同一個檔案在清單中出現多次 —— 而清單的用途是
讓使用者從中挑一個，重複項使它無法達成目的。

**退回保守列舉的條件 SHALL 限於「目標不在版本控制之下」，SHALL NOT 涵蓋其他失敗。** 退回之所以
可接受，理由是「不在版本控制之下的目錄沒有巢狀工作目錄的問題」—— 該理由只對這一個條件成立。
若因逾時或輸出過大而退回，巢狀工作目錄之下的檔案會**全部湧入**，本要求當場失效，**而使用者只會
看到清單變長**。逾時與輸出過大 SHALL 回報錯誤。

目標目錄整個位於版控忽略範圍之內時（列舉成功但結果為空），`listFiles` SHALL 改以保守列舉回傳
清單 —— 使用者既然正在該目錄下工作，「它被忽略」不是把它呈現為空的理由。

列舉失敗時 `listFiles` SHALL 回報錯誤，**SHALL NOT 回傳空清單** —— 空清單與「這個目錄真的沒有
檔案」在呼叫端無法區分。

#### Scenario: 排除位於自身之內的其他工作目錄

- **WHEN** 目標目錄之下含有一個屬於同一 repo 的 git worktree
- **THEN** 回傳的清單不含該 worktree 之下的任何檔案

#### Scenario: 排除版控忽略的內容

- **WHEN** 目標目錄之下含有被版本控制忽略的目錄（例如相依套件或建置產物）
- **THEN** 回傳的清單不含其中的檔案

#### Scenario: 目標不在版本控制之下時仍可列舉

- **WHEN** 目標目錄不在任何 git 版本庫之內
- **THEN** 回傳可用的檔案清單，且不含常見的相依套件與建置產物目錄之下的檔案

#### Scenario: 目標整個被版控忽略時仍可列舉

- **WHEN** 目標目錄本身位於版控忽略的範圍之內，其下含有檔案
- **THEN** 回傳的清單含有那些檔案，而非一個空清單

#### Scenario: 逾時不退回保守列舉

- **WHEN** 版控列舉因逾時而失敗
- **THEN** 呼叫回報錯誤，SHALL NOT 改以保守列舉回傳一份含有其他工作目錄之檔案的清單

#### Scenario: 列舉失敗時回報錯誤

- **WHEN** 列舉因目標不存在或不是目錄而失敗
- **THEN** 呼叫被拒絕並回報錯誤，而非回傳空清單

### Requirement: listFiles 的列舉不得阻塞主行程

`listFiles` 若藉由執行外部程式完成列舉，該執行 SHALL 為非同步。

主行程一旦阻塞，**所有終端 session 的輸入輸出會一併停住** —— 它同時是 pty 資料流的中介。一個
大型版本庫的列舉是數十至數百毫秒等級，那個代價 SHALL NOT 由整個應用程式承擔。

**此性質的驗收 SHALL 觀察「事件迴圈於列舉期間仍在運行」，SHALL NOT 以「某個同步 API 未被呼叫」
代之。** 後者是前者的代理判準，且它有一個結構性的盲點：以具名匯入取得的函式不經屬性查找，攔截
其模組的匯出**攔不到它** —— 於是一個使用同步 API 的實作會讓該斷言保持綠燈。

#### Scenario: 列舉期間事件迴圈仍在運行

- **WHEN** 對一個大型版本庫呼叫 `listFiles`，同時有一個已排入佇列的計時器等待執行
- **THEN** 該計時器於列舉完成之前即被執行

## MODIFIED Requirements

### Requirement: 檔案系統能力僅暴露已為其定義邊界要求的操作

暴露給 renderer 的檔案系統能力 SHALL 僅含本規格已定義邊界要求的操作。任何新的檔案系統能力 SHALL NOT 出現於 renderer 可觸及的介面上，直到後續 change 明確引入並為其定義邊界要求。

這條要求的形式是「白名單」而非「清單」—— 它約束的不是當下有哪幾個函式，而是**任何函式進入介面之前，都必須先有邊界要求**。

#### Scenario: 介面上只有已定義邊界要求的能力

- **WHEN** 於 renderer 檢視 preload 暴露的檔案系統介面
- **THEN** 其上只有 `listDir`、`listFiles`、`readFile`、`writeFile`、`createFile`、`createDirectory`、`deleteEntry`、`rename`、`watch`、`unwatch` 與變更事件的訂閱介面 `onWatchEvent`，不存在建立符號連結、變更權限或其他未經本規格定義邊界要求的能力
