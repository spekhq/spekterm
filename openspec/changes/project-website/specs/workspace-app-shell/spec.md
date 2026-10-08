## ADDED Requirements

### Requirement: The browser engine opens no connection at startup that nothing asked for

The app SHALL NOT use Electron's built-in spell checker, and SHALL NOT download its dictionaries. With a
fresh user-data directory, and with one an earlier version left behind, starting the app SHALL NOT make
the browser engine open any network connection. Afterwards, every connection the browser engine opens is
one the user asked for, configured, or that content the user opened requests (for example a remote image
in a markdown file).

The spell checker was on by default and downloaded a dictionary from a third-party server at every start
with a fresh profile, before the user touched anything, for a feature no part of the app uses.

Dictionary files downloaded by earlier versions MAY remain in the user-data directory; they are not used.
The `Dictionaries` directory itself may still be created, so its absence is not evidence of anything.

This requirement's check covers the browser engine's network stack only, for host names other than
`localhost`, within a bounded window after startup. Connections made by the main process's own code are
covered by "The app's own code connects only where its allow-list says"; connections to IP literals do not
pass through host-name resolution and are not observed.

#### Scenario: Startup with a fresh profile opens no connection

- **WHEN** the app is started with a fresh user-data directory, every host name except `localhost`
  resolving to a local listener that was already listening before the app started, and is left untouched
  for the settle window
- **THEN** the listener has received no connection

#### Scenario: Startup with an earlier version's profile opens no connection

- **WHEN** the app is started the same way with a user-data directory in which an earlier version
  registered a spell-check dictionary that is not present on disk (never downloaded, or deleted)
- **THEN** the listener has received no connection

#### Scenario: The check can see a connection

- **WHEN**, in the same run and after the settle window, the app's window loads an image from a remote
  `https:` host
- **THEN** the listener receives a connection for that host — so a check that saw nothing above was not
  blind

### Requirement: The app's own code connects only where its allow-list says

A unit test SHALL fail when the source of the main process, the preload, or the code they share
references a network-capable API, or imports a package or built-in module (not a file of this
repository) — statically, through `import()`, or through `require` — that is not on an allow-list; and
SHALL fail when an allow-list entry no longer matches anything. The allow-list SHALL name the
documentation page that states the app's network behavior (`project-website`), which is revisited
whenever the allow-list changes.

A URL handed to the user's browser because the user clicked a link is not a connection the app makes and
is not listed.

#### Scenario: A new network reference fails the test

- **WHEN** a source file in the main process gains a reference to the global `fetch` that is not on the
  allow-list — called, passed by reference, read from `globalThis`, or aliased
- **THEN** the test fails and names the file and the reference

#### Scenario: A new module import fails the test

- **WHEN** a source file in the main process, the preload, or the shared code imports a package or
  built-in module that is not on the allow-list, with or without the `node:` prefix
- **THEN** the test fails and names the file and the module

#### Scenario: A stale allow-list entry fails the test

- **WHEN** an allow-list entry matches no reference in the source
- **THEN** the test fails and names the entry
