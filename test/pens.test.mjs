// Pens is a roster, not a setting — and splitting it must not fork the admission gate.
//
//   node --test test/pens.test.mjs
//
// WHY THIS EXISTS. "Whose words may reach my signer" is the most consequential question this desk
// answers, and it was rendered inside a Settings page — framed as a preference. It is not one: an entry
// on that list is standing admission for another key's drafts to be assembled and shown for signature.
//
// THE RISK THE SPLIT INTRODUCES is a second gate. Copying the four handlers into a new file would give
// admission two implementations, and the second one to change would be the one nobody noticed. So the
// handlers are EXPORTED and shared, and this suite asserts that rather than trusting it — a source-level
// check, because the alternative is discovering the fork from a pen that could still post after removal.
//
// The other assertion worth its line is the re-render target. A removal on the Pens pane that re-rendered
// SETTINGS would leave the visible roster listing a key that is no longer admitted, which is the worst
// staleness available on an admission screen.

import { test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const pens = read('pens.mjs')
const settings = read('settings.mjs')
const main = read('main.mjs')
const html = read('index.html')

test('the admission handlers are SHARED, not copied', () => {
  assert.match(settings, /export function wireRosters/, 'settings must export the gate')
  assert.match(pens, /import \{ wireRosters \} from '\.\/settings\.mjs'/, 'pens must import it')
  // The tell for a fork: pens declaring its own handler for the same control.
  assert.doesNotMatch(pens, /\$\('agent-add'\)\.onclick/, 'a second copy of the gate is a second gate')
  assert.doesNotMatch(pens, /\$\('deliverer-add'\)\.onclick/)
})

test('settings no longer wires the rosters itself — one call site, one gate', () => {
  // Count DEFINITIONS, not references: the Enter-key shortcut legitimately calls onclick(), so
  // matching bare `.onclick` counts two and says nothing about forking.
  const defs = (settings.match(/\$\('agent-add'\)\.onclick\s*=/g) || []).length
  assert.equal(defs, 1, 'the handler should be DEFINED exactly once, inside wireRosters')
  const before = settings.slice(0, settings.indexOf('export function wireRosters'))
  assert.doesNotMatch(before, /\$\('agent-add'\)\.onclick\s*=/, 'renderSettings must not wire it directly')
  assert.match(settings, /wireRosters\(el, apply\)/)
})

test('Pens re-renders ITSELF on a change, not the hidden Settings pane', () => {
  // Re-rendering Settings would leave the visible roster showing a key that is no longer admitted.
  assert.match(pens, /renderPens\(\)/)
  const applyBlock = pens.slice(pens.indexOf('wireRosters(el,'))
  assert.doesNotMatch(applyBlock, /renderSettings\(\)/)
})

test('both roles are on one screen — one question, two answers', () => {
  // Splitting pens and coordinators across screens is how you end up believing a coordinator is steered.
  assert.match(pens, /the pens/)
  assert.match(pens, /Coordinators/)
})

test('the page states the invariant that nothing on the roster can post', () => {
  assert.match(pens, /<b>Nothing here can post<\/b>/)
})

test('the coordinator/pen distinction is stated as construction, not policy', () => {
  assert.match(pens, /never receives your steering|NEVER receives steering/)
})

test('the tab and its pane both exist, and the tab is registered', () => {
  assert.match(html, /data-tab="pens"/)
  assert.match(html, /id="pens"/)
  assert.match(main, /pens: renderPens/, 'an unregistered tab renders a blank pane')
})

test('Settings points at where the rosters went, rather than dropping them silently', () => {
  assert.match(settings, /moved to <b>Pens<\/b>/)
})

test('the roster markup was MOVED, not rewritten — same ids, so the same wiring binds', () => {
  for (const id of ['agent-npub', 'agent-add', 'agent-err', 'deliverer-npub', 'deliverer-add', 'deliverer-err']) {
    assert.match(pens, new RegExp(`id="${id}"`), `${id} must survive the move`)
    assert.doesNotMatch(settings.slice(0, settings.indexOf('export function wireRosters')),
      new RegExp(`id="${id}"`), `${id} must not still be rendered by Settings`)
  }
})
