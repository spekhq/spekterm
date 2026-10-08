---
title: 快捷鍵
description: spekterm 加上的每一個快捷鍵，以及為什麼有些按鍵留給終端。
sidebar:
  order: 1
---

spekterm 的快捷鍵不論焦點在哪裡都有效 —— 終端、編輯器或側欄 —— 除非有對話框或選單開著。
終端幾乎永遠持有焦點，所以 spekterm 會在終端之前攔下這些按鍵，被它用掉的按鍵不會送進終端裡的程式。

## Session 與 rail

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 rail 項目內的下／上一個 session，依分頁順序（可循環）。焦點在側欄的 change 檢視時：下／上一個 artifact |
| `Ctrl+↓` / `Ctrl+↑` | rail 上的下／上一個項目，包含全域項目（可循環） |
| `Ctrl+T` | 開啟建立 session 的選單（可以全程用鍵盤操作） |
| `Ctrl+Shift+W` | 關閉當前的 session |
| `Ctrl+Shift+H` | 讓當前的 session 休眠 —— 它的行程會結束，但仍留在 workspace 裡，之後可以喚醒 |
| `Shift+↓` / `Shift+↑` | 把選中的 repo 在 rail 上往下／往上移動一格（跨過置頂段的分界即置頂或取消置頂） |
| `Shift+→` / `Shift+←` | 把當前的 session 在分頁列上移動一格 |

## 側欄與檔案

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl+Shift+M` | 放大／還原側欄 |
| `Ctrl+P` | 快速開檔 —— 只在側欄持有焦點時 |
| `Ctrl+S` | 存檔 |
| `Esc` | 關閉 overlay、對話框或選單 |

## 終端

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | 複製／貼上 |
| `Ctrl+C` | 永遠是中斷，即使畫面上有選取 |

## spekterm 留給終端的按鍵

- **終端持有焦點時的 `Ctrl+P`** 會交給終端：Claude Code 用它叫出上一筆歷史。要快速開檔，先點一下側欄。
- **`Ctrl+C` 絕不挪用。** agent 跑偏時要能中斷它，不論畫面上選取了什麼。
- **`Ctrl+W` 不挪用** —— shell 用它刪除一個字。關閉 session 是 `Ctrl+Shift+W`。
- **文字欄位裡的 `Shift+方向鍵`** 照常選取文字；排序快捷鍵只在文字欄位之外生效。

一個已知的代價：Claude Code 自己的 agents 檢視也用 `Shift+方向鍵`，而 spekterm 把它拿去排序了。
