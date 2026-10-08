/**
 * The verdict on what the app shows before a website screenshot is taken (`project-website`:
 * "Screenshots come only from the capture script"). Pure, so its control groups run as unit tests
 * (`scripts/screenshot-manifest.test.mjs`) without starting the app.
 */
import { hygieneHits } from './public-hygiene.mjs'

/**
 * `null` when the text may be captured; otherwise why not.
 *
 * @param {string} text everything on screen: page text, text-field values, terminal contents
 * @param {{ fixtureName: string, hashes?: Set<string> }} options `fixtureName` must appear — a read of an
 *   empty or wrong page would otherwise pass with zero hits
 */
export function screenVerdict(text, { fixtureName, hashes } = {}) {
  if (!text.includes(fixtureName)) return `the screen does not show ${fixtureName} — reading the wrong page or nothing`
  const hits = hygieneHits(text, hashes ? { hashes } : undefined)
  if (hits.words.length > 0) return `the screen shows an internal word (${hits.words.join(', ')})`
  if (hits.homePath) return 'the screen shows a maintainer home path'
  return null
}
