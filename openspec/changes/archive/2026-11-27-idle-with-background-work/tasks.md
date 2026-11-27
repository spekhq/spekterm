## 1. The derivation (main process and shared)

- [x] 1.1 `src/main/agent-events.ts`: export `isBackgroundWork(task: BackgroundTask): boolean` — `kind !== 'monitor'`
      (design D1), with a comment naming why `monitor` is left out; unit test in `agent-events.test.ts` for each kind
- [x] 1.2 `src/shared/wait/attention.ts`: `Attention` gains `'idleBackground'`; `AttentionInput` gains
      `background: boolean`; `attentionOf` returns `idleBackground` only where it returned `idle` and `background` is
      true (D2); `URGENCY` ranks it after working and before running/unknown (D5); doc comments updated
- [x] 1.3 `src/shared/wait/attention.test.ts`: idle + background → `idleBackground`; not seen + background →
      `waiting`; working, choice and unknown unchanged with background; busy outside a turn + seen + background →
      `idleBackground`; ready + in a turn (a turn held open) + background → `idleBackground`; `mostUrgent` ranks it
      above running and idle and below working. Run the control: drop the `background` branch and confirm the first
      assertion turns red
- [x] 1.4 `src/main/wait-attention.ts` + `src/main/ipc/wait.ts`: `AttentionSources.background`, wired as
      `backgroundOf(sessionId).some(isBackgroundWork)` (D4); `wait-attention.test.ts`: the source reaches
      `attentionOf`, and `AttentionBroadcaster` sends when only idle ↔ idle · running in background changed
- [x] 1.5 A carrier for the hibernation scenario at unit level: held background tasks, then `clearWait`, then the
      projection with the real `backgroundOf` → `idle` (in `agent-wait.test.ts` or `wait-attention.test.ts`). Control:
      `clearWait` keeping `background` turns it red
- [x] 1.6 The sweep (D3): grep `src/` and `scripts/` for comparisons against attention / row state values — literals
      (`=== 'idle'`, `'waiting'`, `'choice'`, `'working'`, `'unknown'`), comparisons between variables
      (`[!=]== attention`, `.state [!=]==`), `Record<RowState` / `Record<Attention` / `Record<SummaryBucket`, and the
      probes' own lists of states and words — and settle each one (D3 lists the known ones: `QuickReplyRow.tsx` both
      checks, `SessionSummary.tsx`, `SUMMARY_BUCKETS` and `ANY_ATTENTION`)

## 2. The desktop's presentation

- [x] 2.1 `src/shared/wait/summary.ts`: bucket `idleBackground` in `SummaryBucket` / `BUCKET_OF`, ordered between
      working and running by `URGENCY`; `summary.test.ts` for the order and for the two idle buckets staying apart
- [x] 2.2 `src/renderer/src/shell/terminal/session-badge.tsx`: `ATTENTION_KEY` entry, `TONE` entry (the ring filled
      with translucent green, D5), the `TONE` doc comment; `SessionSummary.tsx`: `BUCKET_DOT` entry
- [x] 2.3 Dictionaries: `sessions.attentionIdleBackground` ("Idle · running in background" / 「閒置 · 背景執行中」) and
      `stage.summaryState.idleBackground` in `en.json` and `zh-TW.json`

## 3. Acceptance

- [x] 3.1 Probes match a tooltip's state exactly, not by substring: "Running · Idle" is a prefix of the new state's
      tooltip, so `includes(IDLE)` cannot tell idle from idle · running in background. In `probe-agent-view.mjs`, read
      the state part of the tooltip (after the title's separator) and compare it for equality, or require
      `!includes(IDLE_BG)` with every `includes(IDLE)`; change every existing idle assertion that way, and the two in
      `probe-remote.mjs` (~2666, ~2670). Add the new state to `SUMMARY_BUCKETS` and its words to `ANY_ATTENTION`
- [x] 3.2 `probe-agent-view.mjs` `runAttention`, **before the focus gate** (the section returns early without window
      focus): to a started session that has had no turn end (seen), fire a `SubagentStop` carrying `background_tasks`
      (not a turn end) — a running shell → its tab and rail row tooltips state idle · running in background; then only
      a `monitor` → idle; then an empty list → idle. With an idle sibling and a running shell in the same folder,
      collapsed: the folder row states idle · running in background. The header summary lists idle · running in
      background and idle as two entries. An own `Stop` that lists a running background subagent, for a session not
      displayed → idle · running in background, not waiting; an unseen turn end with a background shell → waiting with
      no background words
- [x] 3.3 `probe-agent-view.mjs`, **inside the focus gate** (recorded as a gap without focus, as today): a turn that
      ends while the user looks, with a background shell listed → idle · running in background
- [x] 3.4 Controls for 3.2: wire the source to `() => false` (the first assertion turns red), and make
      `isBackgroundWork` always true (the "only a `monitor`" assertion turns red); record both in the section's
      comment
- [x] 3.5 `scripts/scenario-coverage.test.mjs`: register `idle-with-background-work` in `COVERED_CHANGES` and add one
      row for each **new** scenario of the delta (nine), each with its carrier and mutation, checked against the
      assertion it names. The MODIFIED requirements' existing scenarios already have rows under their names; do not add
      them again — re-check that each still discriminates after 3.1
- [x] 3.6 `npm run typecheck`, `npm run lint`, `npm test`, `npm run probe:agent-view`, `npm run probe:remote`

## 4. Documents

- [x] 4.1 `docs/remote-protocol.md`: the `seen` paragraph states the desktop's reading of `ready` + `seen: true` +
      `background` (a task whose kind is not `"monitor"` → "Idle · running in background"), and section 5 says it is
      idle for `sessions.hibernate` / `sessions.close` (no `SESSION_BUSY`) (D6)
- [x] 4.2 Website, both languages: `site/src/content/docs/docs/using/terminals-and-sessions.md` (the dot table's new
      row, the header summary's state list, and that automatic hibernation applies to it too) and
      `site/src/content/docs/docs/using/remote-access.md` ("Background work": a monitor is not listed and the state
      wording — only what the desktop now does, the phone's own release updates the rest); their `zh-tw/` copies; run
      the site build
- [x] 4.3 `docs/lessons/transcript.md`: "The status dots read these boundaries" and the background tasks'
      "Re-measure after a CLI upgrade" say the dots now rest on the task `kind` (`monitor` left out)
- [x] 4.4 `CLAUDE.md`: the status dots line ("working / waiting for you / asks for a choice / idle") names idle ·
      running in background and the `monitor` exclusion
