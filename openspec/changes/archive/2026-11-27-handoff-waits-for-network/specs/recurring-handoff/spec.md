## MODIFIED Requirements

### Requirement: An approved recurrence keeps at most one upcoming occurrence, and its time is visible

An approved recurrence SHALL have **at most one** upcoming occurrence: a scheduled handoff (`scheduled-handoff`)
for the first matching time after the later of now and its previous occurrence, opening in the folder the user
approved it into. The occurrence SHALL be listed in the inbox's scheduled section with its time, that folder, its
full body and its expression, and SHALL behave as a scheduled handoff: it raises no notification and does not
count in the badge while it waits; it opens through the scheduled handoff's path — a new session, at most once,
only when a window can receive it and the agent's service can be reached (`scheduled-handoff`), its arrival notification raised when it opens.

It SHALL have exactly one, except while:

- **its latest occurrence was refused when it came to open** — its target no longer resolves, or agent event
  reporting is off — so it is a pending inbox item. The recurrence SHALL create no further occurrence until the
  user accepts or ignores that item; then the next is the first matching time after that moment. A recurrence
  whose folder is gone would otherwise add a failed item, a notification and a held place in the inbox at every
  time. An occurrence whose session was requested but then not created, or whose prompt was not filled in in
  time, also stays as a pending item for the user, but SHALL NOT pause the recurrence: its next occurrence
  already exists by then;
- the inbox is full: no occurrence is created; the next is created once there is room, at the first matching
  time after that moment;
- the approved recurrences could not be read at start (the file is damaged or from a newer version): nothing
  about them is changed, nothing is created, and the inbox says that they could not be read.

When an occurrence is opened, skipped or run now, or a waiting one is dealt with, the next occurrence SHALL be
created at once, whether the action was taken on the desktop or from a device. An approved recurrence and its
upcoming occurrence SHALL survive a restart; whatever point the application stopped at, the next start SHALL
leave at most one upcoming occurrence.

The inbox SHALL list every approved recurrence that is not stopped in its own section (in the Schedules tab), with its expression,
folder, title, and its next time or the reason it has none, so that a recurrence is visible and can be stopped
when it has no upcoming occurrence. That list is not made of inbox items, and in this version a device does not
see it (`remote-protocol`).

The recurrence SHALL keep going until its end time, if it has one, or until the user stops it. When the next
matching time would be later than its end time, no occurrence SHALL be created and the recurrence ends. An
occurrence created before its end time SHALL still open if it opens late.

#### Scenario: Each time opens a new session

- **GIVEN** an approved recurrence for folder B whose occurrence is two minutes from now
- **WHEN** that time passes, and later the following matching time passes
- **THEN** folder B has two new agent sessions, one for each time, each with the recurrence's prompt sent once its agent is ready

#### Scenario: The next occurrence is listed as soon as one opens

- **WHEN** an occurrence of a weekly recurrence opens
- **THEN** the scheduled section lists the occurrence one week later

#### Scenario: A recurrence survives a restart

- **WHEN** a recurrence is approved and the application restarts
- **THEN** the scheduled section lists exactly one occurrence for it, at the same time as before the restart

#### Scenario: A restart after a crash between the two writes leaves one occurrence

- **GIVEN** the application stopped after an occurrence was added and before the recurrence recorded it
- **WHEN** the application starts after that occurrence's time
- **THEN** exactly one occurrence of the recurrence is opened or listed, not two

#### Scenario: A removed target fails one occurrence and the recurrence waits for the user

- **GIVEN** an approved daily recurrence for folder B, and the user then removes folder B from the workspace
- **WHEN** its next time comes, and the following two times pass
- **THEN** one failure is visible with a notification and an inbox trace, one pending item stands for it, no further occurrence is created, and the recurrences section states that an earlier time is waiting

#### Scenario: The next occurrence exists while an occurrence is still opening

- **WHEN** an occurrence fires and its session has been requested but not yet created
- **THEN** the scheduled section already lists the next occurrence

#### Scenario: Dealing with the waiting item resumes the recurrence

- **GIVEN** a recurrence waiting because an earlier occurrence failed
- **WHEN** the user ignores that item
- **THEN** the scheduled section lists the recurrence's next matching time after now

#### Scenario: An occurrence whose folder is gone names no other folder

- **GIVEN** a recurrence approved into folder B, folder B removed from the workspace, and a routing rule and a fallback folder that would match the occurrence
- **WHEN** its next occurrence is created
- **THEN** the occurrence is listed as having its folder gone, never with the rule's or the fallback's folder

#### Scenario: An unreadable recurrence file changes nothing

- **GIVEN** an approved recurrence with an upcoming occurrence, and its recurrence file then damaged
- **WHEN** the application starts
- **THEN** the upcoming occurrence is still listed, the file is unchanged, the inbox states that the recurrences could not be read, and approving a proposal is refused with that reason

### Requirement: Times missed while the application was closed run once

When one or more of a recurrence's times passed while its occurrence could not open — the application was not
running, the computer was asleep, no window could receive it, or the agent's service could not be reached — its
upcoming occurrence SHALL open **once**, without asking, as soon as a window can receive it and the agent's service
can be reached (`scheduled-handoff`; an occurrence the service held opens by that capability's release rule). No further occurrence SHALL be created for the other missed
times; the next occurrence is the first matching time after it opened. Should two overdue occurrences of the same
recurrence exist at a start (the application stopped between creating one and recording it), only one SHALL
open: for occurrences of one recurrence, that is the coalescing this requirement asks for, not the dropping of
an overdue handoff that `scheduled-handoff` forbids.

#### Scenario: Three missed times open one session

- **GIVEN** an approved daily recurrence, and the application closed for three days across three of its times
- **WHEN** the application starts and its window restores its sessions
- **THEN** exactly one new session is created for it, and the scheduled section lists its next time after now
