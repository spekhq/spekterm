---
title: Worktree 聚合
description: spek 如何顯示 repository 所有 git worktree 的 change，以及實驗性的 jj workspace 支援。
sidebar:
  order: 2
---

一個 repository 常常同時有好幾份工作目錄 —— 每個 agent、每件平行進行的工作，各自在自己的 git worktree 的分支上。那些工作的 OpenSpec change 散在這幾份工作目錄裡，檢視器只指著其中一份的話，只看得到一部分。

spek 會找出 repository 的所有 worktree（用 `git worktree list`），把它們進行中的 change 併成一份清單：

- **所有 worktree 的 change**，各自標出來自哪個分支；主要 worktree 的不加標示，讓 feature 的工作更顯眼。
- **一個 change 只佔一列** —— 被好幾個 worktree 繼承的同一個 change 只顯示一次。選哪一份是看 git 歷史（哪個 worktree 真正把它推進到主分支之後），不是看檔案時間。
- **已封存的 change** 也從所有 worktree 合併。
- 任何一個 worktree 的 `openspec/` 有變動時會自動更新。

不管 spek 指著哪一個 worktree，或指著主要的工作目錄，看到的結果都一樣。

## 範圍切換

有不只一份工作目錄時，頁首會出現範圍切換：**Current dir**、**Worktrees**，偵測到 jj workspace 時還有
**Worktrees + jj**。選擇會被記住：網頁版記在瀏覽器的儲存空間，VS Code 記在 `spek.aggregateWorktrees` 與 `spek.aggregateJjWorkspaces` 設定裡。

## jj workspace（實驗性）

在同時使用 git 與 [jj](https://jj-vcs.github.io/jj/) 的 repository 裡，`git worktree list` 看不到 jj
workspace。選 **Worktrees + jj**（或在 VS Code 設定 `spek.aggregateJjWorkspaces`），spek 會連每個 jj
workspace 一起掃描：

- 預設關閉，而且只有存在 jj workspace 時才會出現這個選項。
- 內容相同的同一個 change 會合併成一列；已經分歧的 workspace 保留自己的那一列，標示為衝突，若它正是該 workspace 目前的 change，則標示為 *editing*。
- 永遠不需要 jj：沒裝 jj，或選項關閉時，spek 的行為就跟沒有這個功能一樣。

## 哪些用法支援

網頁版與 VS Code 擴充套件會聚合 worktree，JetBrains 外掛不會。
