## Purpose

The public website at `spekterm.com` — a landing page and the user documentation, in English and
Traditional Chinese — built from this repository, kept out of the desktop app, and held to the same
honesty about the app's behavior (platforms, network, screenshots) that the app's own specs require.

## ADDED Requirements

### Requirement: The site is built from the repository and stays out of the app

The website SHALL be built from a self-contained directory of this repository with its own dependency
declaration and lockfile. The root project SHALL NOT declare the site's directory as a workspace or list
it in its lockfile, and the desktop packaging configuration SHALL NOT select any file under the site's
directory. (Root and site may depend on some of the same packages; that is not a leak.)

In this capability, **a page** is a page listed in the built site's sitemap. The not-found page is not one:
it exists in English only, its language switch is exempt from the parity rules, and it SHALL still carry
the disclaimer and the third-party notices link.

#### Scenario: Packaging selects nothing from the site

- **WHEN** the desktop packaging configuration's file selections (included files, extra files, extra
  resources) are matched against a path under the site's directory
- **THEN** none selects it

#### Scenario: The root project does not adopt the site

- **WHEN** the root `package.json` and root lockfile are read
- **THEN** no workspace names the site's directory and the lockfile has no entry for the site's package or
  any path under the site's directory

### Requirement: spekterm.com is the canonical host

The site SHALL be served at `https://spekterm.com`. Requests to `www.spekterm.com`, `spekterm.app`, and
`www.spekterm.app` SHALL be answered with a permanent redirect to `https://spekterm.com`, preserving the
path and query. Every page SHALL declare its canonical URL on `https://spekterm.com`, so that any other
host serving the same build (such as the hosting provider's own host name) points back to it.

#### Scenario: A redirecting host keeps the path

- **WHEN** a client requests `https://spekterm.app/docs/install/?x=1`
- **THEN** the response is a permanent redirect to `https://spekterm.com/docs/install/?x=1`
- **AND** the same holds for `www.spekterm.com` and `www.spekterm.app`

#### Scenario: Every page names its canonical URL

- **WHEN** every page of the built site is read
- **THEN** each declares a canonical URL whose host is `spekterm.com` and whose path is that page's path

### Requirement: Both languages carry the same pages

The site SHALL be published in English at the root path and in Traditional Chinese under `/zh-tw/`, and
every page SHALL offer a switch to the same page in the other language. Every page, every interface string
of the site's own components, and every screenshot SHALL exist in both languages. The site's build SHALL
fail when any of them exists in only one language.

Whether a translation says the same thing as its source is not machine-checkable; it is reviewed by the
maintainer.

#### Scenario: A page in one language only fails the build

- **WHEN** a documentation page is added in English with no Traditional Chinese counterpart, and the site
  is built
- **THEN** the build fails and names the page that lacks a counterpart

#### Scenario: A component string in one language only fails the build

- **WHEN** an interface string of a site component is defined for one language only, and the site is built
- **THEN** the build fails and names the string

#### Scenario: A screenshot in one language only fails the build

- **WHEN** a screenshot exists for English and not for Traditional Chinese, and the site is built
- **THEN** the build fails and names the screenshot

#### Scenario: The language switch leads to the same page

- **WHEN** the language switch of every page of the built site is read
- **THEN** on each, the other language's entry targets that page's counterpart (for example `/docs/install/`
  offers `/zh-tw/docs/install/`)

### Requirement: The landing page states what spekterm is and where it runs

The landing page, in both languages, SHALL contain:

- a statement of what spekterm is that names Claude Code and OpenSpec;
- a screenshot showing a session next to the OpenSpec side panel;
- the platform status: builds are available for Linux, and macOS and Windows are not supported yet;
- a download link (see "Downloads link to the latest release");
- links to the documentation, the source repository, and the releases;
- a statement that spekterm is not affiliated with Anthropic or the OpenSpec project, which SHALL also
  appear on every other page and on the not-found page.

Neither the site nor the repository's READMEs SHALL describe spekterm as an app for Linux only — the
platform status describes the current builds, not a design limit.

#### Scenario: The landing page carries the required content

- **WHEN** the built landing page is read in either language
- **THEN** it names Claude Code and OpenSpec, includes the side-panel screenshot, states the platform
  status, and links to the download, the documentation, the repository, and the releases

#### Scenario: Every page carries the disclaimer

- **WHEN** every page of the built site and the not-found page are read
- **THEN** each contains the non-affiliation statement

#### Scenario: Nothing says Linux only

- **WHEN** the text of every built page, `README.md`, and `README.zh-TW.md` is searched,
  case-insensitively, for "Linux only", "Linux-only", 「只支援 Linux」, 「僅支援 Linux」, and 「Linux 專用」
- **THEN** there is no match

### Requirement: The documentation is the user guide

The site SHALL publish documentation covering at least: installation; setting up a first workspace;
terminals and sessions (restore, hibernation, worktrees); the OpenSpec side panel; the conversation view;
files and quick open; the inbox and Slack; handoffs; keyboard shortcuts; settings; data and network; and
troubleshooting.

The repository's READMEs SHALL link to the documentation and SHALL keep what `desktop-packaging` requires
the README to state, so that someone reading the repository can install without leaving it.

#### Scenario: Every required topic has a page

- **WHEN** the built site's pages are listed in either language
- **THEN** each topic above has a page

#### Scenario: The READMEs point to the documentation

- **WHEN** `README.md` and `README.zh-TW.md` are read
- **THEN** each links to `https://spekterm.com/docs/`

### Requirement: Downloads link to the latest release

Every download link on the site SHALL point to the latest release page of the source repository. The site's
pages SHALL NOT carry an app version number, so that publishing a release never requires rebuilding the
site. Releases are published as full (not pre-release) releases; the latest release page shows the newest
of those.

#### Scenario: Download links target the latest release page

- **WHEN** every link on the built site whose target is the source repository's releases is collected
- **THEN** each targets `https://github.com/spekhq/spekterm/releases/latest`

#### Scenario: The pages do not carry a version number

- **WHEN** the HTML pages of the built site (not the third-party notices) are searched for every version
  the app has been released under (the repository's `v*` tags, without the `v`) and for the version in the
  root `package.json`
- **THEN** there is no match

### Requirement: The site does not track its readers

The site SHALL NOT set cookies and SHALL NOT load any script, style sheet, font, image, or frame from an
origin other than its own; links that the reader follows are not loads. This SHALL hold for what the
hosting serves, not only for what the build produces, because the hosting can inject content without any
change to the repository.

The site's build SHALL fail when the built output references a resource from another origin. References a
script would make at run time are not visible to the build; the site's scripts SHALL NOT make any.

The served site SHALL be checked after deployment and after any change to the hosting's settings; that
check needs a deployed site and is run by the maintainer.

#### Scenario: A resource from another origin fails the build

- **WHEN** a built page — including its `<style>` elements and `style` attributes — or a built style
  sheet references a script, style sheet, font, image, or frame on another origin, and the site is built
- **THEN** the build fails and names the reference

#### Scenario: Inline data and plain links do not fail the build

- **WHEN** the built output contains `data:` URLs and hyperlinks to other origins
- **THEN** the build does not fail on them

#### Scenario: The served site matches the build and sets no cookie

- **WHEN** the maintainer runs the live check against the site deployed from a given commit
- **THEN** every page, the third-party notices, and the response to a path that does not exist are served
  without a `Set-Cookie` header and with a body identical to the corresponding file of that commit's build
  (the last with status 404 and the not-found page's body)

### Requirement: The documentation states the app's network behavior

The documentation SHALL state, in a page about data and network:

- what the app itself connects to and when: Slack (or the endpoint the user configured) only after Slack
  credentials are saved; remote `https:` images in rendered markdown; links the user opens, in the user's
  browser;
- which programs the app starts that make their own connections: the `claude` CLI; the `openspec` CLI,
  including that it sends anonymous usage statistics and how to turn them off in a way that works however
  spekterm is started; and the user's login shell at startup;
- that the app's own checks cannot observe what those programs do.

The page SHALL be revisited whenever the app's network allow-list (`workspace-app-shell`) changes; the
allow-list names this page.

#### Scenario: The page states the app's own connections and the started programs

- **WHEN** the data and network page of the built site is read in either language
- **THEN** it names Slack, remote images, the `claude` CLI, the `openspec` CLI with its usage statistics and
  the `openspec config set telemetry.enabled false` opt-out, and the login shell, and says the app cannot
  observe the started programs' connections

### Requirement: Screenshots come only from the capture script

Every screenshot on the site SHALL be produced by the repository's capture script, which runs the app with
a fresh user-data directory, an invented home directory, shell prompt, and git identity, fixture
repositories at a fixed generic path, an environment built from an allow-list (taking only display
variables from the process that runs it), and a stand-in agent. A screenshot taken from anyone's working
session SHALL NOT be committed.

Before each capture the script SHALL read the text the app shows — the page text, the values of text
fields, and the terminals' contents — and abort if it contains a word or path that the repository's
content-hygiene rules forbid. The same read SHALL abort if it does not contain a known fixture name, so
that reading an empty or wrong page cannot pass.

The script SHALL record a hash of every screenshot it writes. A unit test SHALL fail when a committed
screenshot is not recorded or does not match its hash, or when a recorded screenshot is missing. Every
screenshot SHALL be reviewed by the maintainer before it is committed.

#### Scenario: Forbidden text on screen aborts the capture

- **WHEN** the text the app shows at capture time contains a word on the content-hygiene list or a
  maintainer home path
- **THEN** the capture is aborted for that screenshot and the script exits non-zero

#### Scenario: An empty read aborts the capture

- **WHEN** the text read at capture time does not contain the fixture repository name
- **THEN** the capture is aborted and the script exits non-zero

#### Scenario: A screenshot not written by the script fails the test

- **WHEN** a screenshot in the site's screenshot directory is replaced or added without updating the
  recorded hashes
- **THEN** the unit test fails and names the file

#### Scenario: A recorded screenshot that is missing fails the test

- **WHEN** a recorded screenshot is deleted
- **THEN** the unit test fails and names the file

### Requirement: The site publishes its third-party notices

The site SHALL publish, at a stable path linked from every page and from the not-found page, the name and
license text of every third-party package whose code or styles are shipped to the reader's browser. When it
is unclear whether a package ships, it SHALL be listed.

#### Scenario: The notices list what the browser receives

- **WHEN** the site is built
- **THEN** the notices file exists and lists, with license text, each package whose files appear in the
  built scripts and style sheets

#### Scenario: Every page links to the notices

- **WHEN** every page of the built site and the not-found page are read
- **THEN** each links to the notices file

### Requirement: The site's build is the gate to publishing

The site SHALL be published only from the `master` branch, by the hosting building the site's directory,
and only when that build succeeds. Other branches SHALL NOT be published at any address. The build SHALL
fail — and therefore nothing SHALL be published — when any check this capability assigns to the build
fails, and when any of these fails: the site's type check; the repository's content-hygiene check and its
restrictive-license-wording check; a broken link or anchor in the documentation's content.

#### Scenario: A content-hygiene violation stops the build

- **WHEN** a page under the site's directory contains a word on the content-hygiene list, and the site is
  built
- **THEN** the build exits non-zero

#### Scenario: A broken documentation link stops the build

- **WHEN** a documentation page links to a page or anchor that does not exist, and the site is built
- **THEN** the build exits non-zero and names the link

#### Scenario: A failed build leaves the published site in place

- **WHEN** the hosting's build of a new `master` commit fails
- **THEN** the previously published site keeps being served
