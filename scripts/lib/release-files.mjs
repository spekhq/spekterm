/**
 * What a release commit is, shared by the step that creates one (`release-bump.mjs`, Linux) and the step
 * that only accepts one (`release-check.mjs`, macOS).
 *
 * One list on purpose: if the bump started committing a third file and the check still expected two, every
 * macOS release would be refused — or, the other way round, a hand-made commit touching one more file would
 * pass as a release.
 */

/** The version is declared in these files, and the bump rewrites all of them — the commit must cover each. */
export const VERSION_FILES = ['package.json', 'package-lock.json']

/** The subject of the commit that bumps the version to `version`. */
export function releaseSubject(version) {
  return `chore(release): ${version}`
}
