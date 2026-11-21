## Why

The maintainer types the same few sentences to agents over and over. Counted in the local Claude Code
transcripts (2026-10-16 to 2026-11-21, user messages under 300 characters, deduplicated, variants of one question
grouped by a pattern): asking whether the session can be closed about 357 times (about 305 of them the exact same
sentence), asking whether a change carries any risk or anything to decide about 73 times (many wordings), asking
whether anything is left to do about 25 times. Each is typed in full every time, on the desktop and on the phone. A sentence the user sends verbatim dozens of times a week should be one click.

## What Changes

- **Quick replies**: a short list of sentences the user keeps, each sent to an agent session with one click.
- **Where they show**: a row of buttons under a running agent session, in both the terminal view and the
  conversation view. Clicking one sends that sentence to the session at once — no fill, no second key.
- **Gates**: a quick reply is sent only when a typed reply could be: while the agent is ready or working, never
  while it asks for a choice or its state is unknown, never over a filled-in prompt not yet sent, and — new for a
  send that bypasses the user's own keyboard — never while the user has typed into the session since the agent last
  reported a submitted prompt (the agent's input box may hold their words, which the sentence would join); "send
  anyway" overrides that one gate when nothing was typed since the warning. A refused click says why and sends
  nothing.
- **How it is written**: through the path a phone's reply takes (`sendReply`'s core: the session's queue, the text,
  then the submit key `SUBMIT_KEY_DELAY_MS` later, re-checked before the key), without the phone's origin note and
  without being bound to a watched conversation. Its writes count as typing for everything else that watches typing
  (a waiting close is dropped by a quick reply as by a typed one). The conversation view's own composer is unchanged.
- **The list**: kept in the preferences, edited in Settings → Agents & sessions (add, edit, remove, reorder). One
  line each, at most 200 characters, at most 12 entries, no duplicates. Until the user edits it, the list is three defaults from
  the dictionary in the UI language (the three sentences above). An empty list hides the row.
- **Desktop only.** The phone keeps its own list (the user's decision: each device manages its own); the companion
  app's change is separate (`quick-replies` in spekterm-android). **The remote protocol does not change.**

## Capabilities

### New Capabilities

- `quick-replies`: the list, where its buttons show, what a click sends and when it is refused.

### Modified Capabilities

- `terminal-preferences`: the Agents & sessions section of Settings also holds the quick replies.

## Impact

- `src/main/remote-conversation.ts`: the gate-and-write core of `sendReply` becomes a function both the phone's
  reply and a quick reply call; `sendReply` keeps its watched-conversation check and origin note.
- `src/main/agent-events.ts`, `src/main/agent-wait.ts`: the time of the agent's last submitted prompt.
- `src/main/ipc/`: a new invoke channel for a quick reply; `src/preload/index.ts` exposes it.
- `src/main/preferences-store.ts`, `src/main/ipc/settings.ts`, the preload, `PreferencesProvider`: a `quickReplies`
  field and its setter, read through the single field source like the others.
- `src/renderer/src/shell/terminal/`: the button row under the terminal and the conversation view.
- `src/renderer/src/shell/settings/sections/AgentsSection.tsx`: the list editor.
- `src/shared/i18n/en.json`, `zh-TW.json`: labels, refusal reasons, the default sentences.
- `scripts/probe-agent-view.mjs`, `scripts/probe-shell.mjs`, `scripts/settings-projection.test.mjs`,
  `scripts/scenario-coverage.test.mjs`; `docs/lessons/transcript.md`; the website's docs in both languages.
