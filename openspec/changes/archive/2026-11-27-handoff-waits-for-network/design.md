## Context

`HandoffOpener` (`src/main/handoff-opener.ts`) owns every automatic handoff opening. It looks after each delivery
(`onDelivered`), every 30 seconds, when a window's restore gate opens, when a window first lists the inbox
(`onNewReceiver`), and on `powerMonitor`'s `resume`. Its one condition today is `canReceive()` — one window that
lists the inbox and has restored its sessions. `#fire` persists `firedAt` first, so whatever the opening becomes,
the handoff is never opened automatically again (`scheduled-handoff`, "at most once, ever").

The user's report (2026-11-26): with the lid closed or away from a network, scheduled handoffs still opened when
due, and every one became an agent that cannot run. Two paths lead there:

1. **Asleep through the time.** No tick runs while suspended. On wake, `resume` ticks at once — before Wi-Fi has
   reassociated — and every handoff that fell due during the sleep opens in that one tick.
2. **Awake but offline** (away, no network): the 30-second tick opens each one at its time.

Because the opening is final, both waste the handoff: it becomes an ordinary pending item to be accepted by hand.

The user's decisions (2026-11-26):

- judge "online" by **actually reaching the agent's service**, not by the system's network state;
- when the network returns, the backlog that waited opens **one at a time**, not all at once — and so do the
  handoffs overdue at start; several arriving together while the app runs online still open together;
- the spacing is **15 seconds**;
- a **Settings switch** for the check, on by default, for configurations spekterm cannot see (instead of reading
  Claude Code's settings files).

Measured:

- On the user's machine, `ip -br link`: `wlp0s20f3` (Wi-Fi), `tailscale0` (`UP`, `POINTOPOINT`, its own address),
  docker and libvirt bridges (`DOWN`). Tailscale keeps its interface up and addressed while the uplink is gone, so
  Chromium's online flag (`net.isOnline()`) would very likely answer true offline here. **Not measured with the
  network off**; this is why the flag is not used at all. The dogfood task records the real reading.
- `curl -I https://api.anthropic.com/` with no credentials: `404` in 0.3–0.5 s, no redirect.
- Electron 43.8.4 `net.fetch(url, { redirect: 'manual' })` on a 302: **rejects** with "Redirect was cancelled"
  (`fetchWithSession` attaches no `redirect` listener); Node's `fetch` with the same options resolves with 302.
  `net.request({ redirect: 'manual' })` emits `redirect` with the status (measured by the change review, one-off
  Electron script). Each request carries `user-agent` (with the app's name and version, and the OS) and
  `accept-language`; no `cookie` or `authorization` header (measured likewise).

## Goals / Non-Goals

**Goals:**

- A due handoff opens only when its agent could reach its service; until then it waits, keeps its one automatic
  opening, and opens once the service can be reached.
- A backlog the network held opens one at a time; nothing else is slowed down.
- The user can see why a due handoff has not opened, and can turn the check off.
- spekterm's own connection is as small as it can be: only when something is due, no credentials, listed on the
  website.

**Non-Goals:**

- Telling whether the agent's **account** works (logged in, quota, an outage that answers 5xx). Any HTTP answer
  means the network path is there; the rest is the agent's to report, as today.
- Reading Claude Code's settings files (`~/.claude/settings.json`, a repo's `.claude/settings.json`, managed
  settings) for a provider or endpoint: their precedence is Claude Code's and changes with it. The switch covers
  those users.
- Re-opening sessions that already opened offline, or retrying an opening that failed for another reason.
- Gating the user's own actions (Run now, Accept, a device's accept).
- A device-side indication. The remote protocol's fields and the Android app are unchanged; its spec and
  `docs/remote-protocol.md` say that a due item may stay with its time in the past while the desktop cannot reach
  the agent's service.
- Changing the introduction. An agent that writes a handoff cannot act on the network rule, the introduction's
  `accepted` line already leaves out the window condition the receipt spec states, and its budget is tight
  (`docs/lessons/handoff.md` §16). The receipt spec (`handoff-receipt`) states the new condition. This leaves the
introduction's "a time not later than now opens at once" (`agent-handoff-source`) true only while the service can
be reached; the lesson records it.

## Decisions

### D1. A real request to the agent's origin, through `net.request`, made only when something is due

`agent-reachability-net.ts` holds the one Electron call: `net.request({ method: 'HEAD', url: origin + '/',
redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' })`, ended with no body.
`response` → reachable (any status); `redirect` → reachable, then `abort()` (the redirect is not followed);
`error` → unreachable; `abort` (the timer's) → unreachable. **Not `close`**: measured during implementation, a
`HEAD` emits `close` before `response` and before `error`, so treating it as an outcome failed every check. A packet
dropped on the way emits nothing; the 5-second timer below covers it. It returns
`{ done: Promise<boolean>, abort() }`; `done` never rejects.

`agent-reachability.ts` (Electron-free) races that promise against its **own** 5-second timer (`REACHABILITY_TIMEOUT_MS`)
and aborts the request when the timer wins, so a request that never settles cannot hold the opener; a throw counts
as unreachable.

*Why `net.request`, not `net.fetch`:* measured above — `net.fetch` with `redirect: 'manual'` rejects on a redirect,
which would read a gateway whose root redirects (to SSO, to docs) as unreachable and hold its user's handoffs for
good. Following redirects instead would send requests to wherever the redirect points.

*Why `net` (Chromium's stack), not Node's:* it follows the system proxy settings, as the update check does.

*Why not `net.isOnline()`:* see Context — the user's own interfaces make it unreliable, and a wrong "online" is the
failure being fixed. *Why not a DNS lookup:* the resolver answers from its cache offline, and a captive portal
resolves everything. *Why not a generic connectivity URL, or `spekterm.com`* (the user asked, 2026-11-26): it measures the wrong path —
a network may let one through and block the other, and a gateway in `ANTHROPIC_BASE_URL` is not on it at all; a
request from every installation to the project's own domain is a visible usage signal in its host's logs, at odds
with "no telemetry"; and the site going down or the domain lapsing would hold everyone's handoffs. The agent
contacts its service a moment after the opening anyway.

*Why only when a handoff is due:* most looks have nothing due, so spekterm does not poll the service; a hold costs
one request per look while it lasts.

The request's headers are left to the engine (the user agent with the app's version and OS, the accept-language).
The website says so instead of "nothing about you".

### D2. Which origin: the environment the agent gets, after it is resolved

`agentOrigin(env)` reads the environment an agent session is spawned with — `ptyEnv()` (`terminal.ts`), which is
`process.env` plus the user's login-shell environment — **after `await whenUserEnvReady()`** (the first look, at the
restore gate, can come before the shell environment is read; `TerminalService.create` waits for it the same way):

- the check is off in Settings → `null` (no check);
- any of `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY` set to anything but empty,
  `0`, `false`, `no` or `off` (case-insensitive) → `null`. Claude Code's exact rule for these is not verified; a
  value misjudged as "set" only skips the check, which is today's behavior;
- `ANTHROPIC_BASE_URL` empty → as if unset;
- `ANTHROPIC_BASE_URL` set and parsing as an `http:` or `https:` URL → its origin (path dropped);
- `ANTHROPIC_BASE_URL` set but not such a URL → `null`;
- otherwise `https://api.anthropic.com`.

It is read at each check. Reading it applies it nowhere — `user-env.ts`'s rule (only `PATH` enters `process.env`)
is untouched; the value builds one URL. The agent's login shell runs again when the agent starts (`$SHELL -l -c
claude`), and an rc file could set a different value then; the environment spekterm resolved once at startup is
the same shell's, so the two differ only if the rc file changed since spekterm started (the documented "restart
the app" rule).

### D3. The gate in `tick()`: asynchronous, one check in flight, a generation per wake, everything re-read

`HandoffOpenerDeps` gains `reachable?: () => Promise<boolean | null>` (`null`: no check applies, open) and the opener
gets `resumed()`, which `index.ts` calls on `powerMonitor`'s `resume` in place of `tick()`. Absent `reachable` ⇒
today's synchronous behavior, so the existing opener tests keep their meaning. `tick()`:

1. `keeper.ensureAll()`; if `!canReceive()` → return.
2. Compute the due list. Empty → clear the hold and the backlog (D4) and return.
3. No `reachable` dep → fire them, as today.
4. A check in flight of the current generation → return (its settling looks again). A check of an older
   generation is abandoned, not awaited: it settles into step 5's discard. This is the one case where two checks
   are in progress, and the spec says so.
5. Start a check, tagged with the current generation. When it settles: if its generation is not current, discard
   it and `tick()` again. If `null` (no check applies — the switch was turned off, or the provider is not derivable): clear the hold and
   the backlog and fire **every** due record, as without the gate — a user who turned the check off to get their
   handoffs expects them now, not one at a time. If reachable: run steps 1–2 again and fire per D4 — **never the list from
   before the check**: during it the user may have cancelled one, accepted one, run one, or the window may have
   gone. If unreachable, enter the hold.

`resumed()` increments the generation and ticks: a check sent before the sleep, answered after the wake, decides
nothing (it may have been answered by the network as it was before the lid closed).

A check that throws counts as unreachable and is logged. `tick()` stays `void` and never throws; tests await the
opener's promise through `settled()`. `runNow` is untouched; the user's Accept and a device's accept do not go
through the opener.

*Why every automatic opening, not only scheduled ones:* an unscheduled handoff read at wake (written before the lid
closed, or by an agent whose turn raced the network's loss) is the same dead session. The cost online is one
request of about half a second before an arriving handoff opens.

*Recurrences:* the keeper creates the next occurrence only after one fires or is refused (`#afterFire`); a held one
is neither, so nothing piles up. When it opens, the keeper's "after `max(now, last, start)`" rule skips the times
missed meanwhile — as for times missed while spekterm was closed.

### D4. Hold and release: a set of ids, one at a time, 15 seconds apart

The opener's state is one of:

- **open** — nothing held;
- **held** `{ since }` — a check failed with something due;
- **releasing** `{ backlog: Set<recordKey>, lastReleasedAt }` — entered with `backlog` = the keys of the records
  due at that moment, at the first successful check after a hold, **and at the first look after start** at which a
  window can receive and something is due (`#atStart`, cleared by that look, or by the first look that can receive
  and finds nothing due — a handoff arriving ten minutes after start is not a backlog). At start the release does
  not depend on the check: with the check off or not applicable (`null`), the start's backlog is still released
  one at a time. Only turning the check off **during a hold** releases everything at once (D3).

At each successful check (the release is not unconditional — each look checks again):

- every due record **not** in `backlog` fires, as without a hold;
- the oldest (by `opensAt`) due record **in** `backlog` fires if `now − lastReleasedAt ≥ RELEASE_SPACING_MS`
  (15 s; the first one at once). The spacing is by time, not by looks: `onDelivered`, `onNewReceiver`, the restore
  gate and resume all look between the 30-second ticks;
- keys no longer due (cancelled, accepted, run, fired) are dropped from `backlog`; empty → **open**;
- a release whose `#fire` throws or returns false still counts: its key leaves the backlog and `lastReleasedAt`
  is set, so one broken record cannot stop the rest (`#fire` persists `firedAt` first, so it is not due again).

**The next release is scheduled, not waited for.** After each release the opener asks an injected
`schedule(ms, fn)` (`setTimeout` in `index.ts`, a fake in tests) for a look at `lastReleasedAt + RELEASE_SPACING_MS`.
Without it, the next look is the next 30-second tick, and since `now` and `lastReleasedAt` are both taken after
a request of varying latency, and the ticks are 30 s apart, a 15 s spacing would in practice be 30 s or 60 s
(found by the change review). The scheduled look is an ordinary `tick()`, so it
checks again and re-reads everything.

A failed check during **releasing** returns to **held** with the remaining backlog kept, so the order survives
another drop; the next success resumes the release with that backlog plus whatever else is due by then. Not
persisted: after a restart the first look decides again, and the start's own backlog takes over.

Without a `reachable` dependency (the existing unit tests) there is no hold and no release: everything due opens
together, as before.

A record in the backlog does not count against the one-minute rule of "A due handoff opens…": the modified
requirement says so.

### D5. Visibility: the snapshot gets the state; `changed()` only on transitions

`intake:list`'s snapshot gets `waitingForNetwork?: { kind: 'held'; since } | { kind: 'releasing'; remaining }`,
**never on `IntakeView`** (`remote-host.ts` spreads `IntakeView` to devices). The opener calls `changed()` only when
the state's kind changes. `waitingState()` is **computed when the snapshot asks**: `remaining` is the backlog's keys
that are still due, and a held state with nothing due any more is reported as absent. A cancel, accept or run
already re-lists the inbox, so the count and the line follow it without the opener calling `changed()`. No
`lastTriedAt`: a field that changes every 30 seconds would re-list the inbox to every device, rewrite the schedules
file and re-send sessions each time (`index.ts`'s `onIntakeChanged` listeners).

The snapshot's assembly moves out of `ipc/intake.ts` into a pure function (`src/main/intake-snapshot.ts`), because
that module imports `ipcMain` at load and cannot be loaded by `node:test`.

The inbox overlay shows one line above every tab's content while the field is present, `role="status"`, text from
the dictionaries, times through `locale.ts`:

- held: "Due handoffs are waiting for the agent's service since {{time}}. spekterm tries again every 30 seconds.
  You can turn this check off in Settings."
- releasing: "Opening {{count}} handoffs that waited, one every 15 seconds."

No notification, no badge change. A held scheduled handoff stays listed as scheduled; a held unscheduled one is the
pending item it already was (announced on arrival by `deliver`, and `#fire` announces only scheduled ones — so it
is not announced twice).

### D6. The Settings switch

A terminal preference `handoffNetworkCheck?: boolean` (absent = on) in `PREFERENCE_FIELDS`, `group: 'other'`,
`toRenderer: true` (the Settings section shows it). Settings → Agents & sessions gets a checkbox with the same save
model as its neighbors (applies when changed), and the section's Restore defaults puts it back to on, as it does
the section's other settings. The opener's `reachable` reads it at each check (D2); turning it off while handoffs
are held takes effect at the next look (D3, `null`).

### D7. Acceptance carriers: a stand-in service through `ANTHROPIC_BASE_URL`

The probes that open handoffs (`probe:intake`, `probe:remote`) and `scripts/capture-screenshots.mjs` (it writes two
handoffs) set `ANTHROPIC_BASE_URL` in the launched app's environment to a local HTTP stand-in
(`scripts/lib/stub-agent-service.mjs`: an ephemeral port, answers 404 by default or a 302 on request, records
requests with method and headers, can stop listening and listen again on the same port). It goes through D2 as a
user's gateway would — no probe-only branch in the product. The launches spread `process.env` into the app, and
`ptyEnv()` spreads `process.env`, so the value reaches the check. The stub agent ignores it. The launches also delete `CLAUDE_CODE_USE_*` from the
environment they pass: a developer's own Bedrock setting would turn the check off and make the "does not open"
assertions red for a reason unrelated to the product.

The redirect rule (D1) can only be carried by the real `net.request`: a unit test with an injected function proves
nothing about Electron. It is carried by a probe step with the stand-in answering 302.

`--host-resolver-rules` (used by `probe:shell`) cannot stand in: it maps the host to a local listener, and TLS to
`api.anthropic.com` then fails certificate verification, which is "unreachable".

**Not carried by any probe:** the real offline laptop and a real sleep. That is a dogfood check.

## Risks / Trade-offs

- [A network that answers but drops the agent's long requests] → the check passes and the session opens as before.
- [A captive portal] → TLS to the agent's host fails on the portal's certificate: unreachable, the right answer.
- [A provider chosen in Claude Code's settings files, a shell-only proxy] → held while the endpoint is blocked; the
  inbox line names the Settings switch. Accepted by the user.
- [A wake where the network takes longer than a minute] → held handoffs are outside the one-minute rule (modified).
- [A long backlog] → about 15 s per handoff (plus one request's latency); ten take about two and a half minutes. Accepted by the user; handoffs outside the backlog do
  not wait behind it.
- [One more outbound connection] → listed on the website, made only when something is due, no credentials; it
  reaches the service the agent would reach a moment later.

## Migration Plan

None: the preference is new and absent means on; no stored format changes. A handoff held at quit is pending and
unfired, and the next start looks again.
