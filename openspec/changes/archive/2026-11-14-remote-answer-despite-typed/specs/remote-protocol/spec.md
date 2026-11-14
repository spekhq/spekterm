## MODIFIED Requirements

### Requirement: The watched conversation states the open prompt and whether a device may answer it

While a watched agent waits on a choice and a permission request is open (`agent-event-bridge`), the wait
updates sent to the client SHALL carry the first open request with its identity and the number of open
requests. The request is one of:

- **a permission prompt**: the tool and its identifying argument, and whether a device may allow it once.
  Allowing once SHALL be offered only for tools whose prompt was measured to put a one-time approval first
  (the command, file edit, file write, file read and web fetch tools). It SHALL NOT be offered for any other
  tool.
- **a plan approval**: the plan's text when the agent wrote one, and the approvals a device may choose.
  With a plan, they are "approve, asking before each edit" and "approve and switch to auto mode". Without
  one, the only approval is "leave plan mode, asking before each edit". Allowing once SHALL NOT be offered
  for it, because its first option starts a mode that approves later actions.
- **a question**: its questions, each with its header, its options (label and description) and whether
  several may be chosen.

The update SHALL also say whether a device may answer. It may only when:

- exactly one request is open;
- no keystroke was written to the session since the request's tool call started;
- the request's agent reported no other tool start or finish since then;
- no device answer was written to it yet;
- for a question, there are one to four questions, each with one to eight options.

When a device may not answer, the update SHALL also state why: the first of these that holds, in this order —
more than one request is open; the question is outside the size above; a device answer was written to it; its
agent reported other tool activity; a deciding keystroke was written since the request's tool call started; a
keystroke was written since then. When the reason is the last one, it is therefore the only one, and every
keystroke since the request's tool call started was a moving one. When a device may answer, the update SHALL state no reason.

A keystroke is any write to the session except a device answer's own keys and the terminal's focus and mouse
reports: the keyboard, a client's terminal input, a reply, and the desktop's own prefills. A keystroke is
**moving** when the write holds only the four arrow keys without a modifier, Tab, the ASCII letters `a`–`z` and
`A`–`Z`, and Space. Every other keystroke is **deciding**, among them: an ASCII digit `0`–`9`, Enter, Esc, Shift+Tab,
any other control character, an arrow with a modifier, any other escape sequence, punctuation, any non-ASCII
character, and any paste (a paste is bracketed by escape sequences).

The update SHALL be sent whenever the prompt, the number of open requests, whether a device may answer or the
reason it may not changes, also when no agent event caused the change.

When no request is open, the update SHALL carry no prompt. The existing pending request (tool and argument)
SHALL be sent as before.

**Reason**: the terminal's options for a permission prompt are not in the agent's request, and their number
and meaning differ by tool and by the user's settings (measured, CLI 2.1.300). A question's options are in the
request. Several prompts can be open at once, and only the first is on screen.

The desktop's conversation view still offers no answering (`agent-input-bridge`), because it would depend on
the terminal's numbering. A device's answer depends on it too, but only within what was measured:

- the first option of the listed tools is a one-time approval;
- dismissing a prompt;
- the question tool's option numbering.

The answer is also checked against the agent's record where one exists.

#### Scenario: A permission prompt is stated with its answers

- **WHEN** a client watches an agent that asks permission to run a command
- **THEN** the client receives a wait update whose prompt names the command tool and its argument, carries an identity, offers allowing once, and is answerable

#### Scenario: A plan approval is stated with the plan and its approvals

- **WHEN** a client watches an agent that asks for approval of a plan it wrote
- **THEN** the prompt the client receives carries the plan's text, offers both approvals and denying, and does not offer allowing once

#### Scenario: A question is stated with its options

- **WHEN** a client watches an agent that asks two questions, the second allowing several choices
- **THEN** the prompt the client receives carries both questions with their options in order, marks the second as allowing several choices, and is answerable

#### Scenario: Two open requests are not answerable

- **WHEN** a client watches an agent with two open permission requests
- **THEN** the prompt the client receives names the first, says two are open, and is not answerable

#### Scenario: A prompt the desktop typed into is not answerable

- **WHEN** a permission request is open, the agent reports nothing more, and a letter key is typed into the session on the desktop
- **THEN** the client receives a wait update that says the prompt is not answerable, because of a keystroke and nothing else

#### Scenario: Another reason is stated before the keystroke

- **WHEN** two permission requests are open and a key is typed into the session on the desktop
- **THEN** the prompt the client receives is not answerable because more than one request is open, and the keystroke is not stated

#### Scenario: A deciding key is stated as its own reason

- **WHEN** a permission request is open, the agent reports nothing more, and an arrow key and then an option's digit are typed into the session on the desktop
- **THEN** the prompt the client receives is not answerable because of a deciding keystroke

#### Scenario: An answerable prompt states no reason

- **WHEN** a client watches an agent that asks permission to run a command, and nothing is typed
- **THEN** the prompt the client receives is answerable and states no reason

### Requirement: A device's answer reaches only the prompt it was given and never submits text

Answering SHALL be accepted only for the conversation the connection watches, and only with the identity of
the open request. The answer SHALL be one of:

- allow once, where offered;
- for a plan approval, one of the approvals it offers;
- deny (for a question, decline; for a plan approval, keep planning);
- for an answerable question, one choice per single-choice question and one or more distinct choices per
  several-choice question.

Anything else SHALL be refused, and nothing SHALL be written.

The desktop SHALL write the answer to the session as the keys a user would press, one key at a time, with a
pause between keys. Immediately before each key, it SHALL read the agent's events again. It SHALL write the
key only while:

- exactly one request is open;
- it has the answer's identity;
- no keystroke was written to the session since that request's tool call started;
- the request's agent reported no other tool start or finish since then;
- no other answer was written to it.

A client MAY send an answer **despite earlier typing**, for any decision. For that answer, the keystroke
condition SHALL instead be: no deciding keystroke was written to the session since that request's tool call
started, and no keystroke of any kind since the desktop received the answer. Moving keystrokes written before it
SHALL NOT withhold any of its keys; keystrokes written after it, including while
it waits behind another write to the same session, SHALL. Every other condition SHALL apply unchanged, so an
answer withheld for any other reason SHALL be refused or reported partial exactly as without it. An answer
despite earlier typing SHALL be confirmed or reported as differing exactly as any other. A value other than yes
or no for it SHALL be refused as a bad parameter, and nothing SHALL be written.

Then:

- When the first key is withheld, the answer SHALL be refused with an error stating the prompt is gone.
- When a later key is withheld, the remaining keys SHALL NOT be written, and the answer SHALL be reported as
  partial.
- For a question, the desktop SHALL compare the answers the agent records with the choices sent. For a plan
  approval, it SHALL compare the permission mode the agent reports next with the one chosen. It SHALL report
  either as confirmed or as differing. With no record within three seconds, it SHALL report the keys as sent.
- After a denial the desktop writes, the request SHALL no longer be open (`agent-event-bridge`).

No answer SHALL include the submit key. Answers and replies to one session SHALL be written one at a time.

**Reason**: text and the submit key typed into an open prompt approve it (`companion-test-fixes`), so an
answer must not be text.

The desktop cannot see what a keystroke did to a prompt, because that is only on the screen. Measured (CLI
2.1.325):

- after a deciding key answered the prompt on the desktop, a device's dismiss key interrupted the tool the desktop
  had allowed, and its option key stayed in the agent's input box for the next reply. So a deciding key stays a
  block that no client can lift;
- after moving keys, a device's keys landed right, were typed as text into a field and submitted nothing, or
  submitted choices the user did not make. So the desktop does not decide that moving keys were harmless, and the
  user, warned by the client, does.

The protocol document SHALL state these outcomes, and that the reason and the answer despite earlier typing are
offered together.

- The agent waits for its tool-start event before showing any prompt. It reports each queued request before
  that request's own prompt is shown, and shows queued prompts in the order reported (measured, CLI 2.1.300).
  A prompt that replaced the one being answered, or one queued behind it, is therefore known before the next
  key.
- A prompt answered or dismissed on the desktop reports nothing until its tool ends, or nothing at all. The
  key the user pressed is what tells it.
- A request dismissed in some other way can still be answered. The keys then reach the agent's input box,
  where none of them submits anything, or interrupt a working agent (Esc). The protocol document SHALL state
  this.

#### Scenario: Allowing a command from a device

- **WHEN** a client answers the open command prompt of its watched agent with allow once
- **THEN** the session receives that prompt's first-option key and no submit key, and the answer is reported as sent

#### Scenario: An answer to a prompt that was replaced is refused

- **WHEN** the agent's prompt is answered on the desktop, the agent then asks permission for another tool, and a client answers the first prompt's identity
- **THEN** the answer is refused as gone, and nothing is written to the session

#### Scenario: An answer after the desktop typed is refused

- **WHEN** a permission request is open, a key is typed into the session on the desktop, and a client answers that request
- **THEN** the answer is refused as gone, and nothing is written to the session

#### Scenario: An answer despite earlier typing is written

- **WHEN** a permission request is open, an arrow key is typed into the session on the desktop, and a client allows it once despite earlier typing
- **THEN** the session receives that prompt's first-option key and no submit key, and the answer is reported as sent

#### Scenario: Typing after an answer despite earlier typing arrived withholds the rest

- **WHEN** a client answers a two-question prompt despite earlier typing and, before its last key, a key is typed into the session on the desktop
- **THEN** the remaining keys are not written, and the answer is reported as partial

#### Scenario: Typing while the answer waits behind another write withholds it

- **WHEN** a client's answer despite earlier typing arrives while another write to the same session is being carried out, and a key is typed into the session before the answer's first key
- **THEN** the answer is refused as gone, and nothing of it is written

#### Scenario: Despite earlier typing does not lift a deciding key

- **WHEN** a permission request is open, the dismiss key is typed into the session on the desktop, and a client denies it despite earlier typing
- **THEN** the answer is refused as gone, and nothing is written to the session

#### Scenario: Despite earlier typing does not lift another reason

- **WHEN** two permission requests are open, a key was typed, and a client answers the first one's identity despite earlier typing
- **THEN** the answer is refused as gone, and nothing is written to the session

#### Scenario: A second answer to the same prompt is refused

- **WHEN** a client allowed a command whose tool is still running, and an answer to the same prompt arrives
- **THEN** it is refused as gone, and nothing is written to the session

#### Scenario: An answer while two requests are open is refused

- **WHEN** two permission requests are open and a client answers the first one's identity
- **THEN** the answer is refused as gone, and nothing is written to the session

#### Scenario: A question is answered with the option keys

- **WHEN** a client answers a two-question prompt, choosing the second option of a single-choice question and the first and third of a several-choice question
- **THEN** the session receives, one key at a time, the second option's key, the first and third options' keys, the key that moves past the question, and the confirmation key, and no submit key

#### Scenario: A question's answer is confirmed against the agent's record

- **WHEN** a client answers a question and the agent records the chosen labels as the answer
- **THEN** the answer is reported as confirmed

#### Scenario: An answer interrupted by the prompt ending is partial

- **WHEN** a client's multi-key answer is being written and, before the last key, the agent reports another permission request
- **THEN** the remaining keys are not written, and the answer is reported as partial

#### Scenario: Allowing where it is not offered is refused

- **WHEN** a client answers the plan approval with allow once
- **THEN** the answer is refused as not answerable from a device, and nothing is written

#### Scenario: Approving a plan from a device asks before each edit

- **WHEN** a client approves its watched agent's plan with the approval that asks before each edit
- **THEN** the session receives that option's key and no submit key, and when the agent next reports the default permission mode the answer is reported as confirmed

#### Scenario: A plan approval that lands in another mode is reported

- **WHEN** a client approves a plan with auto mode, and the agent next reports a mode other than auto
- **THEN** the answer is reported as differing

#### Scenario: After a device's denial the agent takes a reply

- **WHEN** a client denies the agent's only open prompt
- **THEN** the session receives the dismiss key, the wait state becomes ready, and a reply from the client is accepted
