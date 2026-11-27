## ADDED Requirements

### Requirement: An automatic opening waits until the agent's service can be reached

Before opening any handoff automatically — a due scheduled handoff, a recurrence's occurrence, a handoff whose
time passed while the application was closed, and a handoff that arrives without `at` — the system SHALL check
that the agent's service can be reached, and SHALL NOT open it while it cannot. A handoff held this way SHALL NOT
count as its one automatic opening: it stays exactly as it was (a scheduled handoff stays listed as scheduled, an
unscheduled one stays the pending item it was), and it SHALL open once the service can be reached.

**The check.** It SHALL be one request to the origin the agent's session would use, derived from the environment
an agent session is started with, read after the user's environment has been resolved: `ANTHROPIC_BASE_URL` when
it is set to an `http:` or `https:` URL (an empty value counts as unset), otherwise the Anthropic API's origin. **Any HTTP response SHALL count as
reachable**, whatever its status, a redirect included; a failed request, or one not answered within 5 seconds,
SHALL count as unreachable. The request SHALL carry no credentials, no cookies and no body. **It SHALL be made only
when at least one handoff is due to open automatically**, and at most one check SHALL be in progress at a time,
apart from one started before the computer slept, which is abandoned. The
system's own notion of being online SHALL NOT be used in its place: interfaces such as a VPN's stay up while the
computer is offline. A check started before the computer slept SHALL NOT decide anything after it wakes.

**No check** SHALL be made, and handoffs SHALL open as if the service were reachable, when the environment selects
a provider whose endpoint the system does not derive (Bedrock, Vertex, Foundry), when `ANTHROPIC_BASE_URL` is set
to a value that is not such a URL, or when the user turned the check off. **Turning the check off while handoffs
are held or being released SHALL open every due handoff at the next look**, not one at a time. **Settings → Agents & sessions SHALL offer
the check as a setting, on by default**, for configurations the system cannot see (a provider chosen in Claude
Code's own settings files, a proxy set only in the shell).

What is due SHALL be decided again after the check: a handoff cancelled, run, accepted or no longer receivable
while the check was in progress SHALL NOT be opened by it.

**The release.** Two sets of handoffs — the *backlog* — SHALL open **one at a time**: those due at the first look
after the application starts at which a window can receive them (overdue scheduled handoffs, occurrences, and
handoffs read from outboxes written while it was closed), and those due when the service is first found reachable
again after a hold. They open the oldest due time first, the next no sooner than 15 seconds after the previous one, each after its own check (a service lost again holds the rest). A handoff that leaves the backlog
otherwise (cancelled, accepted, run) SHALL leave it, and so SHALL one whose opening was attempted and failed: a
failure does not stop the release. **Handoffs not in the backlog are not affected**: one that
falls due or arrives during the release opens at the next look, as it would without a hold.

The user's own actions — Run now, accepting from the inbox, accepting from a device — SHALL NOT wait for the
check.

**Visibility.** While a due handoff is held, and while a backlog is being released, the inbox SHALL say so in one
line: since when handoffs have been waiting, or how many that waited are still to open. Being held SHALL NOT raise
a notification. A held scheduled handoff SHALL stay out of the activity bar's count; a held unscheduled one counts
as the pending item it is. When a held handoff opens, a scheduled one raises the
arrival notification then (as any scheduled handoff does); an unscheduled one, announced when it arrived, is not
announced again.

#### Scenario: A handoff due while the service cannot be reached does not open

- **GIVEN** a handoff scheduled for a time two minutes from now, and the agent's service cannot be reached
- **WHEN** that time passes while the application runs
- **THEN** no session is created for it, it is still listed as scheduled, no notification is raised, and the inbox shows that due handoffs are waiting for the agent's service

#### Scenario: A held handoff opens once the service can be reached

- **GIVEN** a scheduled handoff that fell due and was held because the agent's service could not be reached
- **WHEN** the service becomes reachable
- **THEN** within one minute, a new agent session is created for it in its target folder, the arrival notification is raised, and the inbox no longer shows the waiting line

#### Scenario: A held backlog opens one at a time

- **GIVEN** three due handoffs held because the service could not be reached
- **WHEN** the service becomes reachable
- **THEN** the oldest opens at once, and the other two open one after the other, each at least 15 seconds after the previous one, oldest first

#### Scenario: Overdue handoffs at start open one at a time

- **GIVEN** three handoffs whose times passed while the application was closed, and the agent's service can be reached
- **WHEN** the application starts and its window restores its sessions
- **THEN** the oldest opens at once, and the other two open one after the other, each at least 15 seconds after the previous one

#### Scenario: A handoff not in the backlog does not wait behind it

- **GIVEN** a backlog of three handoffs being released one at a time
- **WHEN** an agent writes a new handoff without `at` during the release
- **THEN** a session is created for it at the next look, before the backlog has finished opening

#### Scenario: Handoffs that fell due during sleep wait for the network after wake

- **GIVEN** two handoffs whose times passed while the computer slept
- **WHEN** the computer wakes and the first check finds the agent's service unreachable
- **THEN** neither opens; once the service becomes reachable, the older opens first and the other at least 15 seconds later, each in a new session

#### Scenario: A check from before sleep does not decide after wake

- **GIVEN** a check in progress when the computer goes to sleep
- **WHEN** the computer wakes and that check is then answered as reachable
- **THEN** nothing is opened on that answer, and a new check is made

#### Scenario: Turning the check off opens every held handoff at once

- **GIVEN** three due handoffs held because the service could not be reached
- **WHEN** the user turns the check off in Settings
- **THEN** all three open at the next look, each in a new session

#### Scenario: Any HTTP status counts as reachable

- **GIVEN** the agent's service answers every request with status 404
- **WHEN** a handoff falls due
- **THEN** it opens as it would without the check

#### Scenario: A redirect counts as reachable

- **GIVEN** the agent's service answers every request with a redirect to another address
- **WHEN** a handoff falls due
- **THEN** it opens as it would without the check, and the redirect is not followed

#### Scenario: No request is made while nothing is due

- **GIVEN** the inbox holds only a handoff scheduled for tomorrow
- **WHEN** the application runs for several minutes
- **THEN** no request is made to the agent's service

#### Scenario: The check targets ANTHROPIC_BASE_URL

- **GIVEN** the environment an agent session is started with sets `ANTHROPIC_BASE_URL` to a gateway's URL
- **WHEN** a handoff falls due
- **THEN** the check's request goes to that gateway's origin and not to the Anthropic API

#### Scenario: Another provider has no check

- **GIVEN** the environment an agent session is started with selects Bedrock
- **WHEN** a handoff falls due
- **THEN** no request is made, and it opens as it would without the check

#### Scenario: The check can be turned off

- **GIVEN** the user turned the check off in Settings, and the agent's service cannot be reached
- **WHEN** a handoff falls due
- **THEN** no request is made, and it opens as it would without the check

#### Scenario: A handoff cancelled during the check does not open

- **GIVEN** a due handoff whose check is in progress
- **WHEN** the user cancels it before the check is answered, and the answer is that the service is reachable
- **THEN** no session is created for it

#### Scenario: Run now does not wait for the check

- **GIVEN** a handoff scheduled for tomorrow, and the agent's service cannot be reached
- **WHEN** the user chooses Run now
- **THEN** a session is created for it at once

#### Scenario: A held unscheduled handoff stays where it was

- **GIVEN** the agent's service cannot be reached
- **WHEN** an agent writes a handoff without `at`
- **THEN** no session is created for it, it is a pending inbox item the user can accept, and it opens automatically once the service can be reached unless the user accepted it first, with no second notification

#### Scenario: A held occurrence does not pile up the recurrence

- **GIVEN** an approved recurrence every hour, whose occurrence is held because the service cannot be reached
- **WHEN** three hours pass and the service then becomes reachable
- **THEN** one session is created for the recurrence, and its next occurrence is listed at its next time after now

## MODIFIED Requirements

### Requirement: A handoff opens only when a window can receive it, and each handoff is opened automatically at most once

A handoff — scheduled or not — SHALL be opened automatically only when a window that has restored its
sessions is listening for it **and the agent's service can be reached** (see "An automatic opening waits until the
agent's service can be reached"); until then it waits, and it opens as soon as both hold. A request to
open a session that no window receives is lost, and the handoff would sit in the inbox as if it had been
refused.

**Each handoff SHALL be opened automatically at most once, ever** — not once per run of the application. Once
an automatic opening has been attempted, or the user has accepted the handoff from the inbox or from a device,
the handoff SHALL NOT be opened automatically again, whatever became of that attempt. A handoff whose opening
did not lead to a working session is an ordinary pending inbox item from then on, and the user decides.
Without this, a handoff whose prefill timed out would open another session at every start of the
application, and announce itself again each time.

A handoff that was pending in the persisted state before this capability existed SHALL NOT be opened
automatically.

#### Scenario: A handoff read before the window restored opens after it

- **GIVEN** an agent's outbox holds a valid handoff written while the application was closed
- **WHEN** the application starts, reads it before its window has restored its sessions, and the window then restores them
- **THEN** a new session is created for that handoff in its target folder without any user action

#### Scenario: A handoff whose prefill timed out is not opened again at the next start

- **GIVEN** a handoff that was opened automatically, whose prefill timed out so that it is pending again
- **WHEN** the application restarts
- **THEN** no new session is created for it, and no notification is raised for it

### Requirement: A due handoff opens a new session through the arriving handoff's path

When a scheduled handoff's time comes while the application runs with a window that can receive it **and the
agent's service can be reached**, the system SHALL **create its session no later than one minute after its time**, through the same path as a
handoff that arrives without `at` (`agent-handoff-source`, "交接於到達時直接建立 session 並送出第一則
prompt"): a **new** session in its target folder, its first prompt filled in and submitted by the rules that
apply to every handoff (including showing it as waiting to be sent when the submission does not take), focus
not moved, the handoff recorded as accepted with that session.

The target SHALL be resolved again from the target string the agent wrote, by the same rule as on arrival, so
a folder removed and added back in the meantime is still found.

The due time SHALL be judged against the wall clock, not against elapsed time measured since scheduling: a
computer that slept through the time still opens the handoff after it wakes, once the agent's service can be
reached. **A handoff held while the service could not be reached is not bound by the one-minute limit**: it opens
by the release rule of "An automatic opening waits until the agent's service can be reached".

At that moment, and not when it was scheduled, the arrival notification (`agent-intake`) and the `intake`
attention event (`remote-notifications`) SHALL be raised for it.

#### Scenario: A handoff opens when its time comes

- **GIVEN** a handoff scheduled for a time two minutes from now, targeting folder B, and the agent's service can be reached
- **WHEN** that time passes while the application runs
- **THEN** within one minute after it, folder B has a new agent session for it, its first prompt is then sent once the agent is ready, and the handoff is accepted

#### Scenario: Focus is not moved when a scheduled handoff opens

- **GIVEN** the user's focus is on a session in folder A
- **WHEN** a scheduled handoff targeting folder B opens
- **THEN** the focus is still on that session, and the rail's selection is unchanged

#### Scenario: Opening raises the arrival notification

- **WHEN** a scheduled handoff opens
- **THEN** an operating-system notification is raised for it, and triggering it focuses the session it created

### Requirement: A handoff whose time passed while the application was closed opens at the next start

A scheduled handoff whose time passed while the application was not running SHALL open at the next start,
**without asking the user**, as soon as a window can receive it and the agent's service can be reached. Every overdue handoff SHALL open; none is
dropped for being late. They open one at a time, by the release rule of "An automatic opening waits until the
agent's service can be reached".

#### Scenario: An overdue handoff opens at start

- **GIVEN** a handoff scheduled for a time that passed while the application was closed
- **WHEN** the application starts and its window restores its sessions
- **THEN** a new session is created for that handoff in its target folder without any user action

#### Scenario: Several overdue handoffs all open

- **GIVEN** two scheduled handoffs whose times both passed while the application was closed
- **WHEN** the application starts
- **THEN** both handoffs open, each in a new session

### Requirement: Scheduling is not a promise that work runs while spekterm is closed

The system SHALL NOT claim that a scheduled handoff runs at its time regardless of the application's state.
It opens only while the application runs; a time that passes while it is closed is honoured at the next
start. The introduction and the user documentation SHALL say so. **The user documentation SHALL also say that a
due handoff waits until the agent's service can be reached, that spekterm makes one request to that service to
find out, and how to turn the check off**; the website's data and network page SHALL list that request.

#### Scenario: The introduction states that a handoff opens only while spekterm runs

- **WHEN** the text injected into an agent's context is examined
- **THEN** it states that a scheduled handoff opens only while spekterm is running, and at the next start if its time passed while spekterm was closed
