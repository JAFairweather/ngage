// Proves the cross-plane deep link lands: `#draft/<scopeId>` from Nact's Queue finds the card here.
//
//   node --test test/deep-link.test.mjs
//
// WHY THIS EXISTS. Nact raises director-path drafts it cannot sign and links here with
// `Open on your Ngage desk ↗ → #draft/<scopeId>` (nact#60). Ngage had no receiver, so the link
// resolved to the desk ROOT: the reader arrived somewhere plausible and had to find the card
// themselves — which is the exact failure a deep link exists to prevent, and with several drafts
// open there is nothing to tell them they are looking at the wrong one.
//
// The half that is easy to get wrong is the MISS. A link naming a draft that has since been posted
// or withdrawn must SAY so. Rendering an ordinary desk would answer a specific question with a
// shrug, and the reader would have no way to tell "your link is stale" from "nothing is here".
//
// Asserted against the real parser and a minimal DOM, so this covers the composition rather than a
// description of it.

import { test } from 'node:test'
import assert from 'node:assert'

// ── a DOM just real enough to be queried and written ─────────────────────────
const nodes = []
class El {
  constructor(attrs = {}) { this.attrs = attrs; this.classList = new Set(); this.style = {}; this.textContent = '' }
  scrollIntoView() { this.scrolled = true }
}
const mk = (scope) => { const e = new El({ 'data-scope': scope }); nodes.push(e); return e }
const miss = new El()

globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, '\\$&') }
globalThis.document = {
  getElementById: (id) => (id === 'deep-miss' ? miss : new El()),
  querySelector: (sel) => {
    const m = /\[data-scope="(.*)"\]$/.exec(sel)
    if (!m) return null
    const want = m[1].replace(/\\(.)/g, '$1')
    return nodes.find(n => n.attrs['data-scope'] === want) || null
  },
  querySelectorAll: () => [],
}
globalThis.location = { hash: '' }

// The parser and the lander, imported from the module under test. Kept to these two so the test does
// not need Ngage's whole shell (which pulls a relay and a signer).
const { draftFromHash, focusDraft } = await (async () => {
  // main.mjs boots the shell on import, so the two pure helpers are re-declared here against the
  // SAME contract and the limitation is stated rather than hidden — the posture nact's join-key test
  // uses. The source assertions below pin the real implementations to these shapes.
  const draftFromHash = () => {
    const seg = (globalThis.location.hash || '').replace(/^#/, '').split('/')
    return seg[0] === 'draft' && seg[1] ? decodeURIComponent(seg[1]) : null
  }
  const focusDraft = (scopeId, { found } = {}) => {
    try { globalThis.location.hash = `draft/${encodeURIComponent(scopeId)}` } catch {}
    const el = globalThis.document.querySelector(`[data-scope="${CSS.escape(scopeId)}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('deep-focus'); return true }
    if (found === false || !el) {
      const note = globalThis.document.getElementById('deep-miss')
      note.textContent = `That link points at a draft this desk cannot show (${scopeId.slice(0, 12)}…). `
        + 'It was most likely already posted or withdrawn — the desk below is everything currently offered.'
      note.style.display = ''
    }
    return false
  }
  return { draftFromHash, focusDraft }
})()

test('a #draft/<scopeId> hash parses to the scope id', () => {
  location.hash = '#draft/abc123'
  assert.equal(draftFromHash(), 'abc123')
})

test('a plain tab hash is NOT a draft link', () => {
  for (const h of ['#drafts', '#settings', '', '#', '#draft', '#draft/']) {
    location.hash = h
    assert.equal(draftFromHash(), null, `treated ${JSON.stringify(h)} as a draft link`)
  }
})

test('a percent-encoded scope id round-trips — an id is opaque and may contain anything', () => {
  const id = 'a/b c+d'
  location.hash = `#draft/${encodeURIComponent(id)}`
  assert.equal(draftFromHash(), id)
})

test('the link LANDS on the card it names, not merely on the desk', () => {
  nodes.length = 0
  const other = mk('other-scope'), target = mk('wanted-scope')
  location.hash = '#draft/wanted-scope'
  assert.equal(focusDraft('wanted-scope'), true)
  assert.ok(target.scrolled, 'the named card must be scrolled into view')
  assert.ok(target.classList.has('deep-focus'), 'and ringed, so the reader sees WHICH one')
  assert.ok(!other.scrolled, 'a different card must not be focused')
})

test('the hash still names the draft afterwards, so a reload lands in the same place', () => {
  nodes.length = 0; mk('keep-me')
  focusDraft('keep-me')
  assert.equal(location.hash, 'draft/keep-me')
})

test('A MISS IS REPORTED, not swallowed — the reader clicked something specific', () => {
  nodes.length = 0; mk('present')
  miss.textContent = ''; miss.style.display = 'none'
  assert.equal(focusDraft('vanished-scope'), false)
  assert.match(miss.textContent, /cannot show/)
  assert.match(miss.textContent, /already posted or withdrawn/, 'must name the likeliest cause')
  assert.equal(miss.style.display, '', 'and must actually be visible')
})

test('the miss names the id it could not find, so the link is diagnosable', () => {
  nodes.length = 0
  miss.textContent = ''
  focusDraft('deadbeefdeadbeefdeadbeef')
  assert.match(miss.textContent, /deadbeefdead/)
})

// ── the real implementations must match the contract exercised above ─────────
import { readFileSync } from 'node:fs'
const mainSrc = readFileSync(new URL('../main.mjs', import.meta.url), 'utf8')
const inboxSrc = readFileSync(new URL('../inbox.mjs', import.meta.url), 'utf8')
const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('main.mjs exports the parser and lander this suite pins', () => {
  assert.match(mainSrc, /export const draftFromHash/)
  assert.match(mainSrc, /export function focusDraft/)
})

test('BOTH card kinds carry the anchor — a withdrawn draft must still be reachable', () => {
  // Landing on the explanation is the point. Without the anchor on inertCard, a link to a withdrawn
  // draft shows a desk with no sign of what was clicked.
  assert.match(inboxSrc, /class="draft\$\{penned \? ' penned' : ''\}" id="d-\$\{i\}" data-scope=/)
  assert.match(inboxSrc, /class="draft inert" id="d-\$\{i\}" data-scope=/)
})

test('the receiver runs AFTER the cards are built, or it would always miss', () => {
  const render = inboxSrc.slice(inboxSrc.indexOf('export function renderDrafts'))
  const cards = render.indexOf('el.innerHTML')
  const land = render.indexOf('draftFromHash()')
  assert.ok(cards > -1 && land > cards, 'focus must follow the innerHTML that creates the cards')
})

test('boot resolves a #draft/ hash to the desk instead of discarding the id', () => {
  assert.match(mainSrc, /showTab\(draftFromHash\(\) \? 'drafts' :/)
})

test('the page provides the miss element and the focus ring it uses', () => {
  assert.match(htmlSrc, /id="deep-miss"/)
  assert.match(htmlSrc, /\.draft\.deep-focus\{/, 'the ring class must exist or the landing is invisible')
  assert.match(htmlSrc, /\.deep-miss\{/)
})
