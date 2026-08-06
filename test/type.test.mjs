// The signed artifact is the ONLY serif — a named DESIGN.md exception, pinned so it cannot erode.
//
//   node --test test/type.test.mjs
//
// nave.pub `design/DESIGN.md` §Type: sans throughout, with one named exception — "where a surface shows
// the thing the Director is about to sign … that body may use `--serif`. The artifact must not look like
// chrome: the reader has to be able to tell, at a glance, which words are the app talking and which
// words will carry their signature."
//
// Ngage was the inverse: its whole body was Georgia, so the note and the buttons around it read as one
// voice, and the artifact had no visual claim to being different from the interface.
//
// TWO WAYS THIS ERODES, and both are asserted:
//
//   · the exception SPREADS — someone adds a serif to a label because it "matches", and the artifact
//     stops being distinguishable. So the count of serif rules is pinned to exactly one.
//   · the exception VANISHES — a later sweep converts the last serif to sans for consistency, the
//     ceremony loses its centrepiece, and nothing complains because everything still looks tidy.
//
// The second is the likelier one, which is why it gets a named assertion rather than a comment.

import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const serifRules = [...html.matchAll(/^\s*([^\n{]*)\{[^}]*var\(--serif\)/gm)].map(m => m[1].trim())

test('the chrome is sans — the body font is not serif any more', () => {
  const body = html.slice(html.indexOf('  body {'), html.indexOf('  body {') + 400)
  assert.match(body, /font-family: var\(--sans\)/)
  assert.doesNotMatch(body, /font-family: var\(--serif\)/)
})

test('--sans is actually defined, so the chrome does not silently fall back', () => {
  assert.match(html, /--sans:\s*-apple-system/)
})

test('THE EXCEPTION EXISTS: the note body still carries the serif', () => {
  // If this fails, a consistency sweep removed the one thing that distinguishes the artifact from the
  // interface, and every screen still looks fine.
  assert.match(html, /\.post \.body \{ font-family: var\(--serif\)/)
})

test('THE EXCEPTION IS EXACTLY ONE RULE — it must not spread', () => {
  assert.deepEqual(serifRules, ['.post .body'],
    `serif is allowed on the signed artifact only; found: ${serifRules.join(' | ') || '(none)'}`)
})

test('the exception is documented AT the rule, not only in a distant doc', () => {
  const at = html.indexOf('.post .body { font-family: var(--serif)')
  const above = html.slice(Math.max(0, at - 900), at)
  assert.match(above, /THE SIGNED ARTIFACT/)
  assert.match(above, /DESIGN\.md/, 'the rule must name the doc that authorises it')
})

test('a kind-0 display name is NOT the artifact — it is chrome', () => {
  // This file's own doctrine treats kind-0 as a hint rather than authority, so a display name is not
  // part of what gets signed and must not borrow the artifact's face.
  assert.match(html, /\.post \.who \.name \{[^}]*var\(--sans\)/)
})

test('roster names are chrome too', () => {
  assert.match(html, /\.lrow \.pname \{[^}]*var\(--sans\)/)
})
