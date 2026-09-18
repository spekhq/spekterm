## 1. i18n 核心（`src/shared/i18n/`）

- [x] 1.1 新增受支援語言的單一來源（`SUPPORTED_LANGUAGES`、`Language` 型別）；**各語言的自稱標籤存在各自的字典裡**（JSON 的值），以 `getFixedT(lang)` 取得。單元測試確認：於任一當前語言下取得的選項標籤都相同（若誤用 `t()`，中文介面會得到「英文／繁體中文」而使該測試變紅）
- [x] 1.2 實作 `resolveInitialLanguage(preferred: readonly string[]): Language` 純函式；單元測試涵蓋 `['zh-TW']`→`zh-TW`、`['zh-HK','en-GB']`→`en`、**`[]`→`en`（實測會發生：`LANG` 與 `LANGUAGE` 皆未設時該 API 回空陣列）**、大小寫與底線形式（`zh_TW`、`ZH-tw`）
- [x] 1.3 `index.ts` 改為多語言 `resources`，新增 `setLanguage()`；單元測試確認切換後 `t()` 回傳新語言的值（**`export const t = i18next.t` 在 `changeLanguage()` 之後是否仍解析到新語言，是主行程整條路徑的地基**），且未知語言不改變當前語言
- [x] 1.4 新增 `locale.ts`：`localeOf()`／`collator()`／`formatTime()`／`formatDate()`／`formatNumber()`／`relativeTime()`，格式化器以語言為鍵快取；把 `files/relative-time.ts` 既有的快取搬進來，單元測試確認切換語言後回傳新 locale 的結果（而非快取的舊值）

## 2. 字典 `zh-TW.json`

- [x] 2.1 先落地**完整的 key 骨架**：每一個 key 都在、值暫為英文原文，複數 key 只保留 zh 的 `_other`；此時 3.1 的完整性守衛即為綠（**其後每一批只替換值，`npm test` 從第一天起就不會紅**）
- [x] 2.2 翻譯 `activityBar`／`rail`／`time`／`common`／`stage`／`panelSwitch`／`panelSource`／`quickOpen`／`statusBar`／`settings`／`sessions`／`unsaved`／`fsError`／`terminalError`（161 條），守衛維持綠
- [x] 2.3 翻譯 `files`／`viewer`／`openspec`／`viz`（108 條）
- [x] 2.4 翻譯 `insights`／`conversation`（169 條）
- [x] 2.5 翻譯 `intake`／`slack`（100 條，其中 3 條已於 4.1 移出 ⇒ 97 條）
- [x] 2.6 人工逐條校對術語一致性（OpenSpec artifact 名、Slack 名詞、對話計量指標），並確認沒有任何 key 還留著英文原文

## 3. 守衛（`scripts/`，隨 `npm test` 執行）

- [x] 3.1 新增 `dictionary-completeness.test.mjs`：基底 key 相等、複數後綴恰為該語言的 CLDR 類別、插值變數集合相等、值非空；四條對照組各指名一種違反並確認變紅。**不提供 allowlist**（見 design D10）
- [x] 3.2 新增 `locale-source.test.mjs`：擋住 `src/` 之下除 `shared/i18n/locale.ts` 外的 `new Intl.`／`toLocaleString`／`toLocaleDateString`／`toLocaleTimeString`／`localeCompare`；**豁免清單為 design D6 的第二類，逐一具名且各帶理由**（`score.ts:105`、`fs-service.ts:146,192`、`insights-aggregate.ts:228,364`、`MainStage.tsx:472`），`*.test.ts` 一併豁免；對照組把一處第一類搬回別的模組並確認變紅
- [x] 3.3 新增 `probe-language.test.mjs`：**定義域為「會傳遞 `--user-data-dir` 的探針」**，每支的啟動路徑上有一次 seed；例外為 `probe-identity` / `probe-core` / `probe-native`（皆不傳該旗標、斷言不經字典）；對照組移除任一支的 seed 並確認變紅
- [x] 3.4 補 `aria-label-source.test.mjs` 的缺口：模板字面值中**出現在 `${}` 之外的字面片段**同樣視為硬編（現行 pattern 對 `${` 開頭的值一律跳過，`BrowseView.tsx:314` 因此逃掉）；對照組以該行為例確認變紅
- [x] 3.5 補 `settings-projection.test.mjs` 的缺口：新增**反向檢查** —— `preferences-store.ts` 中每一個回傳整份偏好的方法都必須出現在 `fullObjectMethods` 上；對照組新增一個未登記的方法並確認變紅

## 4. agent protocol 文字搬離 UI 字典

- [x] 4.1 新增 `src/main/agent-protocol-copy.ts` 持有 `contextHeader`／`prompt`／`promptFirstParty`（英文常數 + 插值），自 `en.json` 移除該三條，更新 `intake-context.ts` 的引用與既有單元測試；`npm test` 全綠且 CJK 守衛仍涵蓋該新檔

## 5. 偏好（主行程）

- [x] 5.1 新增 `UiPreferences` 型別與第二張 `UI_PREFERENCE_FIELDS`（`satisfies` 維持逐欄位型別繫結），把讀入與投影的迴圈抽成吃「表 ＋ 來源物件」的泛型函式；單元測試確認終端群組的既有行為一字未改
- [x] 5.2 `language` 欄位的白名單清理器（不在受支援清單即視為未設定）＋ `parsePreferences` 接受不含 `ui` 區塊的舊檔且 `version` 不變；**送往 renderer 的投影維持扁平**（見 design D3）；單元測試涵蓋舊檔讀入、壞值視為未設定、改語言不動其他欄位
- [x] 5.3 新增 `workspace:settings:setLanguage` IPC —— 處理常式**先**在主行程 `setLanguage()`，**再**回傳投影；單元測試確認主行程套用失敗時不回傳新語言；該方法登記進 `settings-projection.test.mjs` 的清單（3.5 的反向檢查會強制它）
- [x] 5.4 `index.ts` 於 `whenReady`、建立視窗之前依偏好套用語言；偏好檔**不存在**時才以 `app.getPreferredSystemLanguages()` 經 1.2 決定初始語言；單元測試確認「偏好檔存在但無 `ui` 區塊」不觸發偵測
- [x] 5.5 `PreferencesStore.load()` 隔離不可信的偏好檔之後**立刻回寫一份預設偏好檔**，使「偏好檔不存在」嚴格等同於「從未啟動過」；單元測試：餵一份損毀檔 → 載入 → 檔案重新存在 → 再次載入不觸發偵測

## 6. 驗收腳本（`scripts/`）

- [x] 6.1 於 `scripts/lib/probe-language.mjs` 新增種入 `preferences.json`（`ui.language = 'en'`）的 helper，**只在該檔不存在時才寫**（於是損毀韌性與舊檔兩段不必列為例外），接到每一支探針的共用啟動路徑
- [x] 6.2 `scripts/lib/copy.mjs` 新增**可指定語言**的取文案入口；`copy()`／`label()` 兩個既有入口維持只讀 `en.json`
- [x] 6.3 `scripts/run-probes.mjs` 正規化 `LANG` 與 `LANGUAGE`（它目前只刷 `LEAKED_DEV_ENV`），使完整驗收與單支入口在同一個語言環境下執行
- [x] 6.4 `probe:workspace` 的 terminal-preferences 段新增語言段落：選取另一語言 → 介面文字改變、選項標籤為各自語言的自稱、關閉重啟後仍為該語言
- [x] 6.5 新增作業系統偵測段落，**以 `LANGUAGE` 驅動並同時設定一致的 `LANG`**（實測：`LANGUAGE` 才是驅動者，`--lang` 在 `LANGUAGE` 有值時完全無效）：不種偏好檔各啟動一次得到中文與英文；第三次以既有偏好檔（無 `ui` 區塊）＋ 中文環境啟動，斷言仍為英文；第四次以**被隔離過**的偏好情境啟動，斷言仍為英文
- [x] 6.6 新增「語言改變抵達主行程」的兩條斷言：切換語言後觸發一個經 IPC 送達畫面的 `fsError`，其訊息為新語言；以及 `probe:intake` 的**作業系統通知**內容為新語言（走既有的注入替身後端）
- [x] 6.7 「主行程拒絕該語言時畫面不搶先改變」**無自動化載體，理由寫下**：唯一的失敗路徑是 IPC 本身拋出，而要造出它必須在產品程式碼裡注入一個測試專用的失敗分支 —— 這個 repo 明文不做那件事。已覆蓋的部分：主行程端的順序由 5.3 的單元測試釘住（套用失敗時不回傳新語言），renderer 端「不搶先改」由 `await` 的結構保證（`.catch` 不更新 state）。此缺口登記於 8.2 的對照表
- [x] 6.8 `probe:intake` 新增：於語言 A 攝入一則項目 → 切換為 B → 該項目本文仍為 A，且接受後 context 檔界線之內與畫面上逐字元相同（沿用既有的跨行程斷言）
- [x] 6.9 `probe:intake` 與 `probe:agent-view` 新增：UI 語言為中文時，預填的 prompt 與 `SessionStart` 注入的自我介紹皆為英文
- [x] 6.10 重置時刻的格式**改以單元測試承擔**（`locale.test.ts`）：同一個 `Date` 在兩種語言下時刻格式不同、且與直接指名該 locale 的結果逐字元相同。**探針載體被否決的理由**：該欄位只在 agent 回報用量上限時出現，驅動它要一整份 status payload fixture，而「它真的走 `locale.ts`」已由 `locale-source.test.mjs` 結構性保證。**順帶修正一條假要求**：`{month:'numeric', day:'numeric'}` 的日期在 en 與 zh-TW 下恰好相同（皆為 `9/18`），因此斷言「日期格式會變」是錯的
- [x] 6.11 `probe:files` 新增：相對時間與名稱排序隨 UI 語言改變。**fixture 必須含足以分辨兩個 collator 的字元** —— 實測 `Intl.Collator('en')` 把漢字排在拉丁字母之後、`zh-TW` 排在之前，而純 ASCII 檔名在兩個 locale 下順序相同（若種三個 ASCII 檔名，這條斷言恆真）

## 7. renderer

- [x] 7.1 `PreferencesProvider` 持有語言並提供 `updateLanguage`（await 主行程回傳後才改 renderer 的語言）；6.4 與 6.7 通過
- [x] 7.2 設定對話框新增語言選取（`aria-label` 取自字典，選項標籤為自稱）；6.4 通過
- [x] 7.3 語言確定後於 renderer 覆寫 `document.documentElement.lang`（`index.html` 的靜態 `lang="en"` **保留** —— 它是第一次繪製的值，而依 design D2 那一瞬本來就是英文）；探針斷言其值等於當前語言
- [x] 7.4 design D6 第一類的八處改走 `locale.ts`：`useFileTree.ts:35`、`relative-time.ts:22`、`StatusBar.tsx:269,271`、`InsightsOverlay.tsx:399`、`ReportTab.tsx:21,143,144,208`、`SlackSettings.tsx:70`、`PanelSourceBar.tsx:77`、`ipc/settings.ts:46`；`locale-source.test.mjs` 通過
- [x] 7.5 `useFileTree.ts` 的 `describeFailure()` 改為把失敗以**結構**（錯誤碼 ＋ 參數）存進 state、於呈現時才 `t()` —— 它現在把翻好的字串存進 `state.errors`（三處），切換語言後會維持舊語言直到該目錄被重新請求；單元測試或探針斷言切換語言後既有的錯誤訊息隨之改變
- [x] 7.6 把 design D12 第 2 點列出的既有硬編英文補進字典並改走 `t()`：`OpenSpecPanel.tsx:237,253`、`FilesPanel.tsx:306,317`、`BrowseView.tsx:314`（連同 `probe-openspec.mjs:575` 硬編的同一後綴）、`charts.tsx:86` 的 `WEEKDAYS`、`InsightsOverlay.tsx:264-267` 的四組分桶標籤；3.4 的守衛通過

## 8. scenario → 載體對照表

- [x] 8.1 把 `scripts/intake-coverage.test.mjs` 更名為與其實際定義域相符的名稱，更新其引用處（CLAUDE.md 與 `control-groups-source.test.mjs` 若有），`npm test` 全綠
- [x] 8.2 把 `ui-language-switch` 登記進 `COVERED_CHANGES`，並為本 change 四份 delta 的每一條 `#### Scenario:` 各填一列（`carrier` / `greenIfAbsent` / `mutation`）——**MODIFIED 區塊中沿用的既有 scenario 要真的把那條既有斷言找出來，找不到就填「無載體」＋理由**（已知至少兩條無載體：關閉視窗的原生對話框、終端重播分隔線的語言），守衛通過

## 9. 文件與規格

- [x] 9.1 更新 `openspec/specs/ui-localization/spec.md` 的 `## Purpose`（delta 的 Purpose 對既有能力無效）—— 現行版本寫著「所有使用者可見的文案**為英文**」與「一個全英文的介面裡會混入『3 分鐘前』」，封存後會與新規格直接矛盾
- [x] 9.2 改寫 CLAUDE.md 的「UI 文案與 i18n」一節：語言是使用者的選擇、字典有兩份、新增的三道守衛、locale 的單一收斂處與其兩類分界、「寫給 agent 的文字不進 UI 字典」的分界；並更正該節「6 支 probe」為 11 支
- [x] 9.3 新增 `docs/lessons/i18n.md`（Electron 三個 locale API 的完整實測矩陣、`LANGUAGE` 蓋過 `LANG`、`--lang` 在 `LANGUAGE` 有值時無效、`getPreferredSystemLanguages()` 會回空陣列、`getSystemLocale()` 會回 `en-US@posix`、CLDR 複數類別、探針種語言的失效方向、renderer 首次繪製的閃動），並在 CLAUDE.md 的「踩雷指南」表新增一列觸發器
- [x] 9.4 更新 `docs/PRD.md`：多語言進入功能範圍，受支援語言清單與「agent 面向的文字不在地化」寫入權威來源

## 10. 收尾

- [x] 10.1 `npm run typecheck` 與 `npm run lint` 全綠
- [x] 10.2 `npm test` 全綠（含五道新／補的守衛與其對照組）
- [x] 10.3 `npm run test:e2e` 全綠，且總結標示每支探針皆完整執行
- [x] 10.4 dogfood 的三條 dogfood-only 項目**併入日常 dogfood**（原生未存提示的語言、終端重播分隔線的語言與中文雙寬字元的呈現、中文介面下設定對話框與狀態列的版面）—— 它們本來就在平常使用的路徑上。**無載體的理由仍記於 `scripts/scenario-coverage.test.mjs` 的對照表**（三條 `carrier: null` 各帶理由，由守衛釘著）
- [x] 10.5 「讀後感的 claims 不隨 UI 語言在地化」已開為 **issue #49**，並記於 proposal 立場 3
