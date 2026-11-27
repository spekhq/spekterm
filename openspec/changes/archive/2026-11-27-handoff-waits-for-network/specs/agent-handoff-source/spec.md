## MODIFIED Requirements

### Requirement: 交接於到達時直接建立 session 並送出第一則 prompt，不經使用者接受

一則通過驗證且解析出目標的交接 SHALL 於**到達時**直接建立 session，SHALL NOT 停留於待處理
狀態等待使用者接受。

**Exception: a handoff whose `at` names a time later than its arrival** opens when that time comes, through
this same path, and waits until then as a scheduled item (`scheduled-handoff`). Everything this requirement
says about the opened session applies to it at that moment.

"On arrival" means as soon as a window that has restored its sessions can receive the request **and the agent's
service can be reached** (`scheduled-handoff`, "An automatic opening waits until the agent's service can be
reached"). A handoff read before both hold — at start, from an outbox written while the application was closed, or
while the computer is offline — opens once they do, and every handoff is opened automatically at most once
(`scheduled-handoff`). One read while the service cannot be reached is a pending inbox item meanwhile, announced on
arrival as any handoff is.

該 session SHALL 經**與使用者手動接受時相同的路徑**建立，於是 context 檔的產生、prompt 的寫入時機、
session 清單與持久化一律相同。該則交接 SHALL 記為已接受並記錄它建立的 session 識別碼。

**第一則 prompt SHALL 被填入並送出**，不等使用者（`agent-intake` 的「第一則 prompt 不早於 agent
就緒寫入，第三方本文不代為送出」）。交接的本文是使用者自己的 session 中的 agent 撰寫、由他當下的
交辦觸發 —— 「填好而不送出」在這裡沒有擋下任何他沒同意過的事，只讓每一則交接多一趟切換。
**「不會有 agent 在使用者沒看著的時候自己跑起來」不再是本能力的保證**；使用者看得到它的方式是
rail、通知與交接單（`handoff-brief`）。

**系統 SHALL NOT 把焦點切換到新建立的 session。** 使用者在來源 session 交辦之後，那邊的 agent
通常仍在收尾；未經他的動作而改變焦點是在打斷他。

#### Scenario: 交接到達即建立 session

- **WHEN** 一則合法的交接投遞於某個 session 的落點，目標為 folder B
- **THEN** folder B 中出現一個新的 agent session，而使用者未執行任何接受動作
- **AND** 該則交接於收件匣中的狀態為已接受

#### Scenario: prompt 填入並送出

- **WHEN** 承上，該新 session 的等待狀態首次成為就緒
- **THEN** 送往該 session 的內容含第一則 prompt，其後以另一次寫入、隔開一段間隔送出字元
- **AND** 使用者未於該 session 執行任何動作

#### Scenario: 焦點不被切走

- **GIVEN** 使用者的焦點位於來源 session
- **WHEN** 一則交接到達並建立了新的 session
- **THEN** 焦點仍位於來源 session
- **AND** rail 上選中的項目未改變

#### Scenario: A handoff with a future time does not open on arrival

- **WHEN** a valid handoff with `at` set to tomorrow is written into a session's outbox, targeting folder B
- **THEN** folder B gets no new session, and the handoff is listed in the inbox as scheduled

### Requirement: A handoff the watcher never reported is still delivered

A handoff written into a session's outbox SHALL be delivered — its target session created, as for
any handoff — even if the file watcher never reports it, without an application restart and within
one minute of being written, while the agent's service can be reached (`scheduled-handoff`). This is the per-session case of the shared drop-point requirement
"Detection of a delivery does not depend on the watcher having reported it" in `agent-intake`, and
it is stated here because this is where it went wrong: a valid handoff sat unread in a session's
outbox because that outbox was the only one the watcher was not watching, and only a restart picked
it up.

**It SHALL hold for a session created after the application started as well as for a restored
one** — the outbox that was missed belonged to a session created that day.

**A permanently rejected handoff that the application cannot remove from the outbox SHALL be
notified once**, not once per re-read.

#### Scenario: A handoff the watcher never reported creates its session

- **WHEN** the handoff outboxes' watcher reports no events
- **AND** a session created after the application started writes a valid handoff to its outbox
- **THEN** within one minute a session is created in the target folder, without the application
  being restarted

#### Scenario: A restored session's handoff the watcher never reported creates its session

- **WHEN** the application restored a session at startup, and the handoff outboxes' watcher reports
  no events
- **AND** that session writes a valid handoff to its outbox
- **THEN** within one minute a session is created in the target folder, without the application
  being restarted

#### Scenario: A rejected handoff that cannot be removed is notified once

- **WHEN** a session writes a handoff whose target matches no folder, and the application cannot
  remove the file from the outbox
- **AND** the outbox is re-read several times afterwards
- **THEN** exactly one notification about that rejection is issued, and its rejection trace shows a
  single occurrence
