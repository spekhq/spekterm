# Security Policy

## Supported versions

spekterm is distributed as a Linux AppImage built from this repository. Security fixes are applied to
the **latest released version** only. Please make sure you can reproduce an issue on the latest
release (or on `master`) before reporting.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues or pull requests.**

Instead, report privately by **email to cpckewang@gmail.com**.

Please include as much of the following as you can:

- The spekterm version (Settings → About shows the version, build time, and commit).
- A description of the vulnerability and its impact.
- Step-by-step instructions to reproduce it, ideally with a minimal proof of concept.
- Any suggested remediation, if you have one.

## What to expect

- We aim to acknowledge your report within **5 business days**.
- We'll confirm the issue, keep you updated on progress, and let you know when a fix ships.
- We're happy to credit you in the release notes once the fix is public, unless you'd prefer to
  stay anonymous.

## Scope notes

spekterm is a local desktop app that hosts real terminal sessions (including AI coding agents) and
renders untrusted content — Markdown and files from your repositories, terminal output, and
messages from external sources such as Slack. The surfaces most worth scrutiny are:

- **The renderer ↔ main-process boundary.** The renderer addresses files only as
  `(folderId, relativePath)` and every filesystem check runs in the main process. Any way for the
  renderer to read or write outside the workspace folders you added — path traversal, symlink
  tricks, or reaching an API not on the preload allowlist — is in scope.
- **Rendering untrusted content.** Markdown, file contents, and terminal output must not execute
  script, navigate the app window away, or open links without going through the system browser.
  Bypasses of the Content-Security-Policy or the navigation guard are in scope.
- **The inbox and agent handoffs.** Items from external producers (for example Slack mentions) are
  shown to you before any session is created; handoffs written by your own agents are routed only
  to folders in your workspace. Ways to make spekterm create a session in a folder you did not choose,
  or to forge where an item came from, are in scope.
- **Stored credentials.** Tokens you give spekterm (for example for Slack) must only ever be sent to
  the service they belong to, and must never reach terminal sessions' environment.

Out of scope: anything an agent or a command can do **inside a terminal session you started** —
a terminal is a terminal, and spekterm does not sandbox what runs in it.

Thank you for helping keep spekterm and its users safe.
