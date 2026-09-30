## ADDED Requirements

### Requirement: A handoff the watcher never reported is still delivered

A handoff written into a session's outbox SHALL be delivered — its target session created, as for
any handoff — even if the file watcher never reports it, without an application restart and within
one minute of being written. This is the per-session case of the shared drop-point requirement
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
