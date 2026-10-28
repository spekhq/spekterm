## MODIFIED Requirements

### Requirement: The landing page states what spekterm is and where it runs

The landing page, in both languages, SHALL contain, in the page's own content (not its header or footer):

- a statement of what spekterm is that names Claude Code and OpenSpec;
- a screenshot showing a session next to the OpenSpec side panel;
- the platform status: builds are available for Linux (x86_64) and for macOS on Apple Silicon, and
  Windows and Intel Macs are not supported yet — stated next to the first download button;
- a download link (see "Downloads link to the latest release");
- links to the documentation, the source repository, and the releases, and to spek's landing page;
- an introduction of spekterm for Android: a phone screenshot, a link to the app's Google Play listing, a link
  to that language's documentation page about using spekterm on a phone, and the statement that the phone
  app works only while spekterm runs on the user's computer.

Every page and the not-found page SHALL carry a statement that spekterm and spek are not affiliated with
Anthropic or the OpenSpec project.

Neither the site nor the repository's READMEs SHALL describe spekterm as an app for Linux only — the
platform status describes the current builds, not a design limit. The same holds for macOS: no page SHALL
describe spekterm as an app for Linux and macOS only.

The download call to action SHALL NOT name a single platform's file format as if it were the only download.

#### Scenario: The landing page carries the required content

- **WHEN** the main content of the built landing page is read in either language, without the footer
- **THEN** it names Claude Code and OpenSpec, includes the side-panel screenshot, states the platform
  status naming Linux and macOS on Apple Silicon, and links to the download, the documentation, the
  repository, the releases, and spek's landing page

#### Scenario: The landing page introduces the Android app

- **WHEN** the main content of the built landing page is read in either language, without the footer
- **THEN** it includes a phone screenshot, links to the Android app's Google Play listing and to that
  language's page about using spekterm on a phone, and contains that language's wording that spekterm must be
  running on the computer

#### Scenario: Every page carries the disclaimer

- **WHEN** every page of the built site and the not-found page are read
- **THEN** each contains the non-affiliation statement, naming spekterm and spek as separate words

#### Scenario: Nothing says Linux only

- **WHEN** the text of every built page, `README.md`, and `README.zh-TW.md` is searched,
  case-insensitively, for "Linux only", "Linux-only", 「只支援 Linux」, 「僅支援 Linux」, and 「Linux 專用」
- **THEN** there is no match

#### Scenario: Nothing says macOS is unsupported

- **WHEN** the text of every built page, `README.md`, and `README.zh-TW.md` is searched,
  case-insensitively and with whitespace normalised, for "macOS and Windows are not supported",
  "macOS is not supported", "A macOS build is tracked", 「macOS 與 Windows 尚未支援」, 「尚未支援 macOS」,
  and 「macOS 版的進度」
- **THEN** there is no match

#### Scenario: Nothing says Linux and macOS only

- **WHEN** the same text is searched, case-insensitively, for "Linux and macOS only", "macOS and Linux
  only", 「只支援 Linux 與 macOS」, and 「僅支援 Linux 與 macOS」
- **THEN** there is no match

#### Scenario: The download call to action names no single format

- **WHEN** the download buttons of the built landing page and documentation home are read in either
  language
- **THEN** none of them reads "Download for Linux (AppImage)" or 「下載 Linux 版（AppImage）」, nor names
  `AppImage` or `dmg` as the only download

### Requirement: The documentation is the user guide

The site SHALL publish spekterm documentation covering at least: installation; setting up a first
workspace; terminals and sessions (restore, hibernation, worktrees); the OpenSpec side panel; the
conversation view; files and quick open; the inbox and Slack; handoffs; remote access; using spekterm on a
phone with spekterm for Android; keyboard shortcuts; settings; data and network; and troubleshooting. (spek's documentation is its own requirement.)

The repository's READMEs SHALL link to the documentation and SHALL keep what `desktop-packaging` requires
the README to state, so that someone reading the repository can install without leaving it.

#### Scenario: Every required topic has a page

- **WHEN** the built site's pages are listed in either language
- **THEN** each topic above has a page

#### Scenario: The READMEs point to the documentation

- **WHEN** `README.md` and `README.zh-TW.md` are read
- **THEN** each links to `https://spekterm.com/docs/`

### Requirement: Screenshots come only from the capture script

Every screenshot on the site SHALL be written by the repository's capture script: captured (spekterm's and
spek's) as described here, or imported (spekterm for Android's) as described below. A captured screenshot is
taken in an environment built from an allow-list (an invented home directory, the started programs' usage statistics turned off, and only
display variables from the process that runs it). For spekterm it runs the app with a fresh user-data
directory, the invented home's shell prompt and git identity, fixture repositories at a fixed generic path,
and a stand-in agent. For spek it builds a static spek page from the same fixture repository with spek's own
static-page builder, from a spek checkout the maintainer names that is clean and at a spek release tag
(`v<major>.<minor>.<patch>`), and records that tag; then it shows that page. A screenshot taken from anyone's working session — including the
screenshots committed in spek's repository — SHALL NOT be committed.

spekterm for Android is a native phone app that this repository cannot run, so its screenshots are
**imported, not captured**: the script reads, byte for byte, the phone screenshots of the app's Google Play
listing **as committed at a release tag** (`v<major>.<minor>.<patch>`) of a spekterm-android repository the
maintainer names — never its working tree — writes them into the screenshot directory of the matching
language, and records that tag beside the screenshots. It imports a fixed set of screenshots per language; when
the named directory is not the top of a git repository, the tag does not exist or is not a release tag (or
none is named and the repository has no release tag), or any of the set is missing at that tag or is not a
1080 × 1920 PNG image, it imports none of them, leaves the committed phone screenshots, their hashes and the
recorded tag as they were, and exits non-zero, naming the reason. The screenshot directory SHALL hold no phone screenshot outside the imported set,
and SHALL record the release tag whenever it holds them; a unit test SHALL fail otherwise.

Before each capture the script SHALL read the text on screen — the page text, the values of text fields,
and the terminals' contents — and abort if it contains a word or path that the repository's
content-hygiene rules forbid. The same read SHALL abort if it does not contain a known fixture text that
that page shows, so that reading an empty or wrong page cannot pass. An imported phone screenshot has no
screen to read: the script does not read its text, and what it shows is held only by the maintainer's review
below.

The script SHALL record a hash of every screenshot it writes. A unit test SHALL fail when a committed
screenshot is not recorded or does not match its hash, or when a recorded screenshot is missing. Every
screenshot SHALL be reviewed by the maintainer before it is committed.

#### Scenario: Forbidden text on screen aborts the capture

- **WHEN** the text on screen at capture time contains a word on the content-hygiene list or a
  maintainer home path
- **THEN** the capture is aborted for that screenshot and the script exits non-zero

#### Scenario: An empty read aborts the capture

- **WHEN** the text read at capture time does not contain the known fixture text for that page
- **THEN** the capture is aborted and the script exits non-zero

#### Scenario: A screenshot not written by the script fails the test

- **WHEN** a screenshot in the site's screenshot directory is replaced or added without updating the
  recorded hashes
- **THEN** the unit test fails and names the file

#### Scenario: A recorded screenshot that is missing fails the test

- **WHEN** a recorded screenshot is deleted
- **THEN** the unit test fails and names the file

#### Scenario: A spek checkout that is not a clean release aborts the spek shots

- **WHEN** the spek checkout has uncommitted changes or its HEAD carries no `v<major>.<minor>.<patch>` tag
- **THEN** the spek shots are not captured and the script exits non-zero, naming the reason

#### Scenario: A tag that is not a release imports no phone screenshot

- **WHEN** the phone import is given a tag that does not exist or is not of the form
  `v<major>.<minor>.<patch>`, or is given no tag and the repository has no release tag, or the named directory
  is not the top of a git repository
- **THEN** no phone screenshot is imported and the script exits non-zero, naming the reason

#### Scenario: A listing missing a phone screenshot imports none

- **WHEN** one of the set's screenshots, in either language, is missing at the tag or is not a 1080 × 1920
  PNG image
- **THEN** no phone screenshot is imported, the committed phone screenshots, their hashes and the recorded tag
  are unchanged,
  and the script exits non-zero, naming the file

#### Scenario: An imported phone screenshot is recorded like a captured one

- **WHEN** the phone screenshots are imported
- **THEN** each is written byte for byte as committed at the tag, its hash is in the recorded hashes, and the
  tag is recorded beside the screenshots

#### Scenario: A phone screenshot outside the set fails the test

- **WHEN** the recorded hashes name a phone screenshot that is not in the imported set, or the set is
  incomplete in either language, or phone screenshots are present without a recorded release tag
- **THEN** the unit test fails and names the problem
