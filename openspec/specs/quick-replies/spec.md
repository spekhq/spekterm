# quick-replies Specification

## Purpose
Sentences the user sends to agents often, kept in the preferences and sent to an agent session with one click from a
row under its terminal or conversation view, under the gates of a typed reply.

## Requirements

### Requirement: The user keeps a list of quick replies

The preferences SHALL hold a list of quick replies: sentences the user sends to agent sessions often. Each SHALL be
one line, without control characters, 1 to 200 characters after trimming; the list SHALL hold at most 12, no two
equal. A list read from disk that breaks any of these SHALL be treated as not set; it SHALL NOT be repaired in part.
Until the user sets the list, it SHALL be three defaults in the UI language: "Can this session be closed now?", "Is
there any risk, or anything I need to decide?" and "Is there anything left to do in this session?" (in Chinese
(Taiwan): 「這個 session 可以關了嗎？」「會有什麼風險或我要特別決策的嗎？」「這個 session 還有什麼要做的嗎？」); a change of UI language SHALL change them while the list is not set. Once set — even to
no sentence — the list SHALL be exactly what the user set, in the user's order, in every language.

The field SHALL follow the preferences' existing rules: its three answers (read from disk, kept on a partial
update, sent to the renderer) from the single field source, and written through the preferences' write queue.

#### Scenario: Defaults follow the language while not set

- **WHEN** the user has never edited the quick replies and switches the UI language from English to 中文（台灣）
- **THEN** the quick replies are the three defaults in Traditional Chinese

#### Scenario: An edited list is kept as edited

- **WHEN** the user has edited the list to two sentences and then switches the UI language
- **THEN** the list is the same two sentences

#### Scenario: A malformed list on disk

- **WHEN** the preferences file holds a quick reply list with a 300-character entry, or the same sentence twice
- **THEN** the quick replies are the defaults, and the other preferences are read as before

### Requirement: Edit the quick replies in Settings

The Agents & sessions section of Settings SHALL list the quick replies (the defaults while not set) and SHALL let
the user change a sentence, remove one, move one up or down, and add one, each change applied when it is made under
the dialog's save model (a typed sentence on Enter or blur, Esc restoring it). An added row SHALL NOT be saved until
it holds text; a sentence that breaks a rule of a sentence or equals another sentence SHALL NOT be applied, and the
editor SHALL say why; an existing sentence emptied and left SHALL be restored; adding SHALL NOT be offered when the
list holds 12. The first change SHALL save the whole list as shown. Changes made in quick succession SHALL each apply
over the result of the ones before.

#### Scenario: Adding a sentence

- **WHEN** the list is the defaults and the user adds "Go ahead if there is no risk" and presses Enter
- **THEN** the list is the three defaults followed by that sentence, and it is kept after a restart

#### Scenario: Removing every sentence

- **WHEN** the user removes every quick reply
- **THEN** the list is empty, no quick reply row shows under any session, and the list stays empty after a restart

### Requirement: Quick replies show under an agent session

While an agent session is shown and the list is not empty, a row of quick replies SHALL show under the session's
view — under the terminal in the terminal view, under the composer in the conversation view — one button per
sentence in the list's order, each named by its full sentence, then a control that opens Settings at Agents &
sessions. The row SHALL keep to one line, scrolling sideways when it does not fit, and SHALL keep one height: a
refusal or a notice SHALL take the buttons' place in the row, not add a line, so that the terminal is not resized by
it. For a dormant session the row SHALL show with its buttons disabled, so that waking the session
does not resize its terminal. It SHALL NOT show for a shell session or while the list is empty. Showing or hiding the row
SHALL leave the terminal fitted to its space.

#### Scenario: In the terminal view

- **WHEN** a running agent session is shown in the terminal view and the list is the defaults
- **THEN** three quick reply buttons show under the terminal, named by the three sentences

#### Scenario: Not for a shell

- **WHEN** a shell session is shown
- **THEN** no quick reply row shows

### Requirement: A click sends the sentence at once

Clicking a quick reply SHALL send its sentence to that session as a reply, with no further step: the text written
to the session, then the submit key about half a second later, in the session's order with any other reply or
answer, as a phone's reply is written. It SHALL NOT mark the reply as coming from a phone. A click SHALL NOT take keyboard
focus from the session's terminal or composer, and a button SHALL NOT send again while its send is pending. The
quick reply's writes SHALL count as typing into the session for everything else that watches typing (a turn in
progress, a waiting close or hibernate dropped, an offer to close withdrawn — `agent-session-control`). When the agent's state stops allowing a reply between the
text and the submit key, the submit key SHALL NOT be written and the row SHALL say the sentence was put in the
agent's input box but not sent.

#### Scenario: Sent from the terminal view

- **WHEN** the agent is ready and the user clicks "Can this session be closed now?" under the terminal
- **THEN** the agent receives that sentence as one prompt, the terminal keeps keyboard focus, and the terminal's size
  is unchanged

#### Scenario: Sent while the agent works

- **WHEN** the agent is working and the user clicks a quick reply
- **THEN** the sentence is sent, as a typed reply would be while the agent works

### Requirement: A quick reply is refused when a typed reply would be

The main process SHALL refuse a quick reply, writing nothing, when the agent asks for a choice or its state is
unknown, when a filled-in prompt is waiting unsent in the session, or when the session has no running process. It
SHALL NOT refuse a quick reply because something was typed into the session: the desktop cannot see the agent's input
box, so the sentence joins whatever the box holds. The main process SHALL read the agent's latest reported state
before deciding, and again before the submit key. The row SHALL say why, in one line; a refusal, and the notice of a
sentence not sent, SHALL go when the agent's state next changes or the user dismisses it. Buttons SHALL be disabled,
with the reason, while the window already knows the agent asks for a choice or its state is unknown; the main process
SHALL decide regardless. A key typed during the half second before the submit key SHALL withhold the submit key.

#### Scenario: Asking for a choice

- **WHEN** the agent asks for permission to run a command and the user clicks a quick reply through the main
  process (the button being disabled)
- **THEN** nothing is written to the session and the reason names the waiting choice

#### Scenario: Typed earlier, not sent

- **WHEN** the agent's turn ended, the user typed "fix the" in the terminal without sending it, and clicks a quick
  reply
- **THEN** the sentence is written and submitted, joining "fix the", with no warning

#### Scenario: After answering a prompt in the terminal

- **WHEN** the user answered the agent's permission prompt with keys in the terminal, the agent finished its turn,
  and the user clicks a quick reply
- **THEN** the sentence is sent, with no warning

#### Scenario: The user's own prompt is running

- **WHEN** the user typed a prompt and sent it with Enter, and clicks a quick reply while the agent works on it
- **THEN** the sentence is sent

#### Scenario: A waiting close is dropped

- **WHEN** the agent's own close of its session waits for its turn to end and the user clicks a quick reply
- **THEN** the close is dropped, as it is when the user types into the session

#### Scenario: A key typed before the submit key

- **WHEN** the user presses a key in the terminal in the half second between the sentence and the submit key
- **THEN** the submit key is not written and the row says the sentence is in the agent's input box, not sent

#### Scenario: Two quick replies in a row

- **WHEN** the user sends one quick reply and, while the agent works on it, clicks another
- **THEN** the second is sent too
