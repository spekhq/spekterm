---
title: OpenSpec 側欄
description: 在 agent 處理一個 OpenSpec change 的同時跟著它 —— artifact、task、spec delta、瀏覽、worktree、關係圖與時間軸。
sidebar:
  order: 2
---

側欄是 spekterm 存在的理由。你不必切到編輯器去讀 spec，而是把 agent 正在處理的 change 放在它的終端
旁邊，看著它隨 agent 的寫入而變化。

側欄有兩個身分，在它頂端切換：**OpenSpec** 與 **檔案**。這一頁講 OpenSpec；「檔案」有
[它自己的一頁](/zh-tw/docs/using/files/)。沒有 `openspec/` 目錄的 repo 只提供「檔案」。

## 這個 change

**這個 change** 呈現一個 change，每個 artifact 一個分頁：proposal、design、spec delta、tasks，
以及 change 帶有的資料檔。分頁的順序依你的 OpenSpec schema 所定義。

- **Task** 分頁呈現進度，以及依標題分組的各個 task。進度數字也在狀態列上。
- **Spec delta** 分頁替每條 requirement 標示它是新增、修改、移除或改名，並把 scenario 的
  `WHEN` / `THEN` 關鍵字標亮。
- 磁碟上的檔案一變，這裡就跟著更新。agent 把一個 task 打勾，分頁就會更新。

焦點在這個視圖裡時，`Ctrl+Tab` / `Ctrl+Shift+Tab` 在 artifact 分頁之間切換，方向鍵、
`Page Up` / `Page Down`、`Home`、`End` 與 `Space` 捲動內容。

## 選擇 change

spekterm 不從 agent 的輸出去猜一個 session 在處理哪個 change —— 一個偶爾會莫名跳到錯的 change 的側欄，
比沒有側欄更糟。由你來選：

1. 打開 **瀏覽**。
2. 展開 **Change**（**進行中** 或 **已封存**），挑一個。

這個 change 就成為這個資料夾的錨定，**這個 change** 會呈現它。每個資料夾各自記得自己的選擇，跨重啟
保留。repo 若恰好只有一個進行中的 change，不必挑就會直接呈現。

**瀏覽** 也列出每一個 spec。打開一個 spec，會看到有哪些 change 動到它。

## 續寫 change

change 缺 artifact 時，**這個 change** 會呈現 **續寫**，並列出還沒寫出的部分。按下去會把
`/opsx:continue <change>` 送給這個 repo 裡 focused 的 `claude` session，由它寫出下一個 artifact。
下一個該寫哪一個，不是 spekterm 決定的，是 OpenSpec 決定的。

沒有 session 承接得了的時候，**續寫** 會停用並說明原因：這個 repo 沒有 session、focused session 是
shell、它沒有在執行，或 change 與 session 位在不同的工作目錄。

## 其他 worktree 裡的 change

如果你習慣一個 change 一個 git worktree，側欄會呈現 repo 所有 worktree 的 change，並標示各自的工作
目錄。你正在看的 change 所在的 worktree 沒有 session 在跑時，**在那裡開一個 session** 會在那個
worktree 開一個 `claude` session，並替你把 change 錨定好。

## 顯示另一個 repo

側欄平常顯示 rail 上選中的 repo，但它可以顯示工作區裡任何一個資料夾 —— 例如 session 在 app 裡工作時，
你想讀共用函式庫的某個 spec。按側欄頂端的來源指示器挑一個資料夾；**回到選中的 repo** 就回來了。
側欄顯示別的 repo 時，狀態列會顯示 `側欄：<名稱>`。

## 在 spec 與檔案之間移動

在 artifact 上按 **在「檔案」中開啟**，會在「檔案」身分打開那個檔案。在 `openspec/` 底下的檔案按
**在 OpenSpec 中檢視** 就回去。`Ctrl+P`（焦點在側欄時）打開快速開檔，以檔名找任何檔案 —— 見
[檔案與快速開檔](/zh-tw/docs/using/files/)。

## 放大、關係圖與時間軸

`Ctrl+Shift+M` 把側欄放大，蓋過 session 分頁與終端（它們在底下照常執行）；再按一次或按 **還原** 就
回去。rail 仍然看得到。

OpenSpec 身分另有兩個視圖，只在側欄放大時呈現（選了其中一個會自動放大）：

- **關係圖** —— spec 與 change 如何關聯：哪些 change 動到哪些 spec。
- **時間軸** —— 每個 change 在時間軸上的生命週期。

在任一個視圖點一個 change，會在 **這個 change** 打開它；在關係圖點一個 spec，會在 **瀏覽** 打開它。
還原側欄會回到你先前的視圖，停在同一個 artifact、同一個捲動位置。

## 跟上磁碟

側欄監看 repo，檔案一變就重繪。如果用了一陣子之後它不再更新，多半是系統的檔案監看上限太低 ——
見[疑難排解](/zh-tw/docs/help/troubleshooting/)。
