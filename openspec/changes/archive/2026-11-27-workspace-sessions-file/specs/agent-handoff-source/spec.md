## ADDED Requirements

### Requirement: The introduction points to the workspace sessions file before a handoff

The introduction every agent session receives (see "agent 於 session 啟動時被告知 spekterm 的存在、可交接的對象與投遞方式")
SHALL state, in one sentence, that before handing work to a repo now the agent reads the workspace sessions file (see
`workspace-sessions`), with its location, and that the file lists every session in the workspace and says when to
message one instead. This applies to **every agent session**, whether or not it was created by a handoff.

The file's rule and the meaning of its fields SHALL NOT be repeated in the introduction: the agent reads the file
before the only action they concern, as with the repeating and commands rules files.

The introduction SHALL stay within its size budget with the sentence included (the 30-folder variant, measured by the
existing test).

#### Scenario: Every agent session is told where the workspace sessions are

- **WHEN** the user opens a new agent session in a folder, with no handoff involved
- **THEN** the introduction it receives names the workspace sessions file's location and says to read it before handing
  work to a repo now

#### Scenario: The rule is not repeated in the introduction

- **WHEN** an agent session receives its introduction
- **THEN** the introduction does not state that a message gives no receipt, or what the file's state values mean
