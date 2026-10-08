---
title: 瀏覽
description: spek 的各個畫面 —— 總覽、spec、change、schema、關係圖、時間軸 —— 與搜尋。
sidebar:
  order: 1
---

每一種 spek 都有同樣的導覽：**Overview**、**Specs**、**Changes**、**Graph**、**Schemas**、**Timeline**，外加搜尋。

## 總覽（Overview）

總覽列出 spec、進行中 change、已封存 change 的數量，以及 task 完成率、已封存 change 的平均生命週期，還有多少進行中的 change 已經停滯（超過 30 天沒有動靜）。下方是進行中的 change 與它們的 task 進度，以及最近封存的 change。

## Spec

所有 spec 以資料夾樹呈現，照 `openspec/specs/` 在磁碟上的巢狀結構排列，附篩選。spec 打開後是一份大綱：requirement 與 scenario 可以就地收合，規範性關鍵字（SHALL、MUST）與 scenario 步驟（WHEN、GIVEN、THEN、AND）都有標示。每份 spec 也會顯示它在 git 裡的修訂歷史。

## Change

進行中與已封存的 change，每一列標出建立日期、封存日期與生命週期。change 打開後，artifact 以分頁呈現 ——
proposal、design、tasks、specs —— 依工作流程 schema 定義的順序，或依最後修改時間排列。delta spec 的每個操作（ADDED、MODIFIED、REMOVED、RENAMED）都有標籤；task 清單顯示勾選框，並依段落呈現進度。

## 關係圖（Graph）

spec 與 change 之間的關係：每個 change 連到它的 delta 動到的 spec。

## Schema

repository 可用的所有工作流程 schema，標出它的來源與定義的 artifact。schema 打開後是一張流程圖：每個 artifact
依相依順序排列，標出它產生的檔案、撰寫前需要什麼，以及它的撰寫指示。repository 的預設 schema 會特別標示，每個 schema 也連到正在使用它的進行中 change。

## 時間軸（Timeline）

所有 change 的生命週期，排成橫向的甘特圖：已封存的 change 是從建立到封存的長條，進行中的則延伸到今天。可以依 spec 主題分組，也可以隱藏進行中或已封存的 change。

## 搜尋

`Ctrl+K`（macOS 上是 `Cmd+K`）搜尋所有 spec 與 change 的內文。

## 主題

spek 有深色與淺色兩種主題，頁首的按鈕可以切換。
