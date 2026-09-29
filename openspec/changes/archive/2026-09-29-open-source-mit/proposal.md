## Why

2026-09-29 的競品重評（`docs/PRD.md` §2.3、§10.2）顯示，spekterm 作為封閉付費產品的空間已經不在了：原規劃的付費層
（同一人的跨機傳訊、手機核准）已由 Anthropic 官方免費附在訂閱裡，而同一種產品形狀的對手（better-agent-terminal、
Nimbalyst）都是 MIT 免費。使用者裁決**改以 MIT 開源、沿用現在的 GitHub repo 公開、保留完整 git 歷史**，目標是讓
OpenSpec 社群看得到它（能見度，以及可能的贊助），而不是賣授權。

現在 repo 在每一個宣告授權的位置都寫著「私有、專有、保留所有權利」—— 只把 GitHub repo 切成 public 而不改這些，
會發佈一個**自稱不開源的開源專案**：沒有 `LICENSE` 檔的公開程式碼，在法律上的預設就是「不得使用」。

另外，repo 的**歷史**裡有使用者任職公司的內部名稱（公司名、內部 repo 名、Slack 頻道、環境變數名）、同事的名字、
與維護者的本機家目錄路徑。repo 一旦公開，這些就收不回來 —— 別人 clone 走的副本不會因為之後改寫而消失。
**要清就只能在公開之前清**，而且只清目前的檔案不夠。

## What Changes

- **授權改為 MIT**：新增 `LICENSE`（著作權人 `Kewang`，與 `spek` 一致）；`package.json` 的 `license` 從
  `UNLICENSED` 改為 `MIT`，並補上 `author`、`repository`、`homepage`。
- **所有「私有／專有／商業版」的宣告改寫**：README、CLAUDE.md、`openspec/config.yaml` 的 context、PRD（授權的
  宣告、§10 商業模式與 Phase 8+ 改記為「已裁決：開源，不做付費層」、競品表與 SWOT 裡描述 spekterm 自己為封閉
  付費的說法）。
- **被出貨的產物帶著授權文字**：AppImage 帶著 spekterm 的 `LICENSE`，**以及一份第三方授權彙總** —— 產物裡被
  打包進去的 React、Monaco 等約一百多個套件，目前沒有任何一份授權文字隨產物出貨，而它們的 MIT 條款同樣要求
  附上聲明（既有缺口，本 change 一起補）。
- **改寫全部 git 歷史**：以一份**不進版控**的替換對照表，把內部名稱、同事名字、本機家目錄路徑在**每一個 commit
  的內容與 commit 訊息**裡換成通用範例，然後 force push 回現在的 repo。PR 參照裡殘留的舊 commit，使用者已裁決
  可以接受。
- **兩道守衛**：
  - 版控中不得再宣告專有授權（archive 除外）。
  - 版控中不得出現內部識別字詞與維護者的家目錄路徑（**不排除 archive**）。字詞清單以單向雜湊保存 —— 守衛
    本身若寫出那些字，就等於把它們公開。
- **第一個公開版本是 0.2.0**（使用者裁決）：打包指令目前寫死只遞增 patch，改成可由 `RELEASE_LEVEL` 指定
  `minor`／`major`，預設仍是 patch。封存時以 minor 打包。
- **贊助與貢獻**：新增 `.github/FUNDING.yml`（GitHub Sponsors，個人帳號 `kewang`）與 `CONTRIBUTING.md`（貢獻依
  MIT 提供；贊助是給維護者的支持，不依貢獻分配）。

**不在本 change 內**：把 GitHub repo 切成 public、在 GitHub 開通 Sponsors 帳號、處理 GitHub issue 內文裡的內部
名稱 —— 這些是使用者自己在 GitHub 上的動作。**本 change 也不動 `package.json` 的 `private: true`**：那個欄位的
語意是「不發佈到 npm」，與開不開源無關。**commit 的作者 email 與 commit 訊息裡的 session 連結不改寫**（使用者
裁決）。

## Capabilities

### New Capabilities
- `project-license`: 專案的授權宣告 —— 版控中的授權宣告一致為 MIT、被出貨的產物附帶本身與第三方的授權文字、
  版控中不得殘留專有授權的宣告、貢獻與贊助的條件寫在版控裡。
- `public-content-hygiene`: 公開的 repo 不含維護者宣告為內部的識別字詞與本機家目錄路徑，涵蓋版控中的每一個檔案
  （含 archive）。

### Modified Capabilities
- `build-identity`: 新增「遞增的層級可由執行者指定，預設為 patch」。既有的「每一份產物的版本由打包指令自身遞增」
  不變。
- `agent-handoff-source`: 「目標以告知 agent 的那份清單查表解析」這條 requirement 的 scenario 範例改用通用的
  folder 名稱，並保住「完整相等、前綴不算」兩條 scenario 的鑑別力（歷史改寫會換掉原本的名稱，而機械替換會讓
  「前綴不算」那條退化成恆綠）。要求本身不變。

## Impact

- **檔案**：新增 `LICENSE`、`CONTRIBUTING.md`、`.github/FUNDING.yml`、兩支守衛測試（`scripts/`）、一個產生第三方
  授權彙總的建置步驟；修改 `package.json`、`electron.vite.config.*`、`README.md`、`CLAUDE.md`、
  `openspec/config.yaml`、`docs/PRD.md`、`scripts/probe-package.mjs`、`scripts/scenario-coverage.test.mjs`、
  幾支測試的 fixture。
- **git 歷史**：**所有 commit 的識別碼都會改變**。repo 內引用 commit 識別碼的文件（一處在 `docs/lessons/`、其餘在
  archive）改寫後要依改寫工具產出的對照表更新；已安裝的 0.1.17／0.1.18 產物在 About 顯示的 commit 會查不到，
  重新打包一次即可。本機只有一份工作副本，改寫後在原地換成新歷史並清掉舊物件。
- **GitHub**：force push 到 `master`（不可逆，執行前停下等使用者批准）。
- **依賴**：無新增 npm 依賴；歷史改寫用本機已安裝的 `git filter-repo`。
