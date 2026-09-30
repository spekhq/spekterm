## ADDED Requirements

### Requirement: Detection of a delivery does not depend on the watcher having reported it

A delivery placed in a drop point SHALL be processed without an application restart even if the
file watcher never reports it, and SHALL be processed within a fixed interval of at most one minute
after it was written. It SHALL go through the same handling path as a delivery the watcher reported
and as one found by the startup scan, so validation, deduplication, and persistence stay
single-sourced.

**The watcher is an accelerator, not the guarantee.** A watcher can miss a directory for reasons
that cannot be enumerated in advance (a broken output stream, exhausted watch descriptors, a network
filesystem), and it can fail to become ready at all. When it does, nothing reports an error: the
producer sees a successful write, the user sees an empty inbox. This requirement exists because that
has happened. The periodic re-read SHALL therefore not depend on the watcher becoming ready, nor on
the startup scan succeeding.

**This SHALL hold for every drop point built on the shared drop-point implementation**, including
the per-session handoff outboxes, and SHALL NOT depend on each caller enabling it.

**The periodic re-read SHALL NOT repeat what the user already saw.** A delivery that is still in the
drop point, unchanged since it was last handled, and whose handling was visible (a rejection trace)
SHALL NOT have that trace counted again by the periodic re-read. This includes a delivery the
application decided to consume but could not remove.

**Except when the reason it was left has gone away:** a delivery left because the inbox was full
SHALL be handled again by the periodic re-read once the inbox has room — the temporary-rejection
promise of "投遞以檔案落點為契約，且落點的內容是不受信任的", which SHALL NOT wait for a restart.

**The carrier of this requirement SHALL reproduce a watcher that reports nothing**, and SHALL NOT be
satisfied by a watcher that works: with a working watcher, an implementation without any recovery
path passes. Its control group is removing the recovery path; the assertion SHALL then fail.

#### Scenario: A delivery the watcher never reported is processed without a restart

- **WHEN** the shared inbox's watcher reports no events
- **AND** a valid intake is placed in the shared inbox after the application started
- **THEN** within one minute the intake appears in the inbox as pending, without the application
  being restarted

#### Scenario: The re-read runs even if the watcher never becomes ready

- **WHEN** the shared inbox's watcher never reports that it is ready
- **AND** a valid intake is placed in the shared inbox
- **THEN** within one minute the intake appears in the inbox as pending

#### Scenario: A delivery stuck on a full inbox is not counted again

- **WHEN** a valid intake is placed in the shared inbox while the inbox is full, and its rejection
  trace appears once
- **AND** the periodic re-read runs several times while the inbox stays full and the file is
  unchanged
- **THEN** the rejection trace still shows a single occurrence

#### Scenario: A delivery stuck on a full inbox enters it once there is room

- **WHEN** a valid intake is held back in the shared inbox because the inbox is full, and the
  watcher reports no events
- **AND** the user deals with a pending item so the inbox has room
- **THEN** within one minute the held-back intake appears in the inbox as pending, without the
  application being restarted

#### Scenario: A half-written delivery completed later is picked up

- **WHEN** a file in the shared inbox could not be parsed when it was read, and the watcher reports
  no events
- **AND** the file is then rewritten with a valid intake
- **THEN** within one minute the intake appears in the inbox as pending
