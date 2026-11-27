## Why

A scheduled handoff opens when its time comes, whether or not the computer can reach the agent's service. The
user hit this in daily use: with the lid closed (asleep) or away from any network, handoffs fell due, and on the
next tick — or the instant the computer woke, before Wi-Fi had reconnected — spekterm opened a session for each
one. Every one of them is an agent that cannot run: its first prompt fails, and the user comes back to a row of
dead sessions to clean up, while the work they scheduled did not happen.

The opening is also final: each handoff is opened automatically **at most once, ever** (`scheduled-handoff`), so a
handoff opened offline does not get a second chance when the network returns — it becomes an ordinary inbox item
the user has to deal with by hand.

## What Changes

- **Before an automatic opening, spekterm checks that the agent's service can be reached**, and holds every due
  handoff until it can. A held handoff keeps its one automatic opening.
- **The check is a real request, not the system's online flag** (the user's decision, 2026-11-26): the flag counts
  any interface that is up, and on the user's machine `tailscale0` stays up while offline. One `HEAD` to the origin
  the agent uses (`ANTHROPIC_BASE_URL` from the agent's environment, else `https://api.anthropic.com`), with no
  credentials, cookies or body; **any HTTP response, a redirect included, counts as reachable**; a failure or a
  5-second timeout as unreachable. Made **only when a handoff is due**, one at a time, and never trusted across a
  sleep.
- **When the network returns, and at start, the backlog opens one at a time** (the user's decision): oldest first,
  15 seconds apart, each after its own check; turning the check off during a hold opens them all at once. The
  backlog is what was due at that moment — a handoff that falls due or arrives during the release opens at once.
- **A Settings switch** (Agents & sessions, on by default) turns the check off, for setups spekterm cannot see: a
  provider chosen in Claude Code's own settings files, a proxy set only in the shell (the user's decision). No check
  either for Bedrock, Vertex or Foundry selected in the environment.
- **Scope: every automatic opening** — due scheduled handoffs, a recurrence's occurrences, overdue ones at start,
  and unscheduled handoffs read while offline. **Not** the user's own actions: Run now and Accept open at once.
- **The inbox says why**: one line while handoffs are held (since when, and where to turn the check off) or being
  released (how many are left). No notification and no count for being held.
- Website: "Data and network" lists the request, the handoffs and inbox pages state the rule (both languages).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `scheduled-handoff`: a new requirement for the check, the release and the switch; the conditions for opening
  ("a window can receive it", "due", "overdue at start") gain "the agent's service can be reached"; the
  documentation requirement names the check.
- `agent-handoff-source`: "on arrival" and the watcher-missed delivery's one-minute rule hold while the agent's
  service can be reached.
- `handoff-receipt`: `accepted` for a handoff means it is being opened, or will be once a window can receive it
  and the agent's service can be reached.
- `recurring-handoff`: an occurrence opens, and missed times run once, when a window can receive it and the
  agent's service can be reached.
- `remote-protocol`: a due scheduled item may stay listed with its time in the past while the desktop cannot reach
  the agent's service (no field changes).
- `terminal-preferences`: Agents & sessions lists the new switch, and its Restore defaults puts it back to on.

## Impact

- `src/main/handoff-opener.ts` — the gate, the generation per wake, hold and release, `resumed()`; Run now unchanged.
- New `src/main/agent-reachability.ts` (Electron-free: which origin, the timer) and `src/main/agent-reachability-net.ts`
  (the one `net.request`, its own file for the network allow-list).
- New `src/main/intake-snapshot.ts` (the `intake:list` snapshot as a pure function, testable), `src/main/ipc/intake.ts`.
- `src/main/preferences-store.ts`, `src/renderer/src/shell/settings/sections/AgentsSection.tsx`,
  `src/renderer/src/shell/intake/IntakeOverlay.tsx`, the dictionaries, preload and renderer types.
- `src/main/index.ts` — wiring, `resume` → `opener.resumed()`.
- `scripts/network-surface.test.mjs`; a stand-in service for `probe:intake`, `probe:remote` and
  `scripts/capture-screenshots.mjs`; `scripts/scenario-coverage.test.mjs`.
- Website: `reference/data-and-network.md`, `reference/settings.md`, `using/handoffs.md`, `using/inbox-and-slack.md`
  and their `zh-tw/` counterparts; `docs/remote-protocol.md` (one sentence).
- No new dependency. No change to the outbox format, the receipts' fields, the remote protocol or the introduction
  (design, Non-Goals, says why).
