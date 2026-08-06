// The inbound half of "Nvoy is the source of truth for ALL grants".
//
//   node --test test/consume-mirror.test.mjs
//
// Ngage recorded a consumed draft in `localStorage['ngage-consumed']` and NOWHERE ELSE, so half of what
// this desk did was invisible in the console that claims to be the source of truth for every grant —
// invisible BY CONSTRUCTION, which is the same class of defect as the agent that showed in Nvoy and not
// in Nact. An absence is the one thing nobody can see.
//
// THE DESIGN DECISION THIS SUITE PROTECTS. A consumed draft is NOT an `issued` entry. `index.issued` is
// what the Director granted; this grant came the other way. Filing it there would have been the easy fix
// and the wrong one — it inverts the direction of authority in the audit log to avoid defining a word,
// and a reader would reasonably conclude he had delegated something. So there is one new event,
// `consumed`, with `publisher` = the agent that issued it, and Nvoy reads it through a separate reader.
//
// Asserted against Nvoy's REAL `receivedActions` and `deriveDelegations`, imported by absolute path, so
// any drift between the two apps' index shape fails here rather than in production — the same posture as
// nvoy-index.test.mjs.

import { test } from 'node:test'
import assert from 'node:assert'
import { consumedEvent } from '../nvoy-index.mjs'
// Nvoy's actual readers — the source of truth for how a record appears.
import { receivedActions, deriveDelegations } from '/Users/fairwja/Projects/nvoy/console/ledgerlog.mjs'

const AGENT = 'a'.repeat(64)
const idx = (log) => ({ issued: [], received: [], nvoy_ledger: log })

test('a consumed post is readable by Nvoy, with the direction intact', () => {
  const ev = consumedEvent({ scope: 'draft:post/ab12', publisher: AGENT, name: 'the shape of a week', outcome: 'posted', noteId: 'note1', at: 100 })
  const { rows, dropped } = receivedActions(idx([ev]))
  assert.equal(dropped, 0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].publisher, AGENT, 'publisher is the AGENT that granted it, never the Director')
  assert.equal(rows[0].outcome, 'posted')
  assert.equal(rows[0].noteId, 'note1')
})

test('a PASS is recorded too — declining is a decision worth auditing', () => {
  const { rows } = receivedActions(idx([consumedEvent({ scope: 'draft:x', publisher: AGENT, outcome: 'passed', at: 5 })]))
  assert.equal(rows[0].outcome, 'passed')
})

test('THE DESIGN DECISION: a consumed draft never appears as a DELEGATION', () => {
  // If this fails, the Ledger tells the Director he delegated something an agent granted to him.
  const rows = deriveDelegations(idx([consumedEvent({ scope: 'draft:x', publisher: AGENT, outcome: 'posted', at: 5 })]))
  assert.equal(rows.length, 0, 'deriveDelegations answers "what did I grant" and must not claim this')
})

test('…and it does not disturb real delegations sharing the log', () => {
  const log = [
    { t: 'granted', at: 1, scope: 'house-style', agent: AGENT, v: 1, terms: null, name: 'house-style' },
    consumedEvent({ scope: 'draft:x', publisher: AGENT, outcome: 'posted', at: 2 }),
  ]
  const index = { issued: [{ scope: 'house-style', scope_name: 'house-style', grantees: [AGENT] }], received: [], nvoy_ledger: log }
  const dels = deriveDelegations(index)
  assert.equal(dels.length, 1, 'the real delegation still derives')
  assert.equal(dels[0].scope, 'house-style')
  assert.equal(receivedActions(index).rows.length, 1, 'and the consumption still reads')
})

test('records read newest-first, so the Ledger shows the latest decision first', () => {
  const { rows } = receivedActions(idx([
    consumedEvent({ scope: 'a', publisher: AGENT, outcome: 'posted', at: 10 }),
    consumedEvent({ scope: 'b', publisher: AGENT, outcome: 'passed', at: 20 }),
  ]))
  assert.deepEqual(rows.map(r => r.scope), ['b', 'a'])
})

test('a malformed record is dropped and COUNTED, never silently lost', () => {
  // Losing one silently would reintroduce, at a new layer, the exact defect this event was added to end.
  const { rows, dropped } = receivedActions(idx([
    consumedEvent({ scope: 'ok', publisher: AGENT, outcome: 'posted', at: 1 }),
    { t: 'consumed', at: 2, scope: 5, publisher: AGENT, outcome: 'posted' },
    { t: 'consumed', at: 3, scope: 'x', publisher: AGENT, outcome: 'maybe' },
  ]))
  assert.equal(rows.length, 1)
  assert.equal(dropped, 2)
})

test('an unknown outcome is refused at construction as well as on read', () => {
  // Both ends, because a writer that emits an unreadable record is a writer that reports success wrongly.
  const { rows } = receivedActions(idx([consumedEvent({ scope: 'x', publisher: AGENT, outcome: 'shredded' })]))
  assert.equal(rows.length, 0)
})

test('an empty or missing log is not an error', () => {
  assert.deepEqual(receivedActions(idx([])).rows, [])
  assert.deepEqual(receivedActions({}).rows, [])
  assert.deepEqual(receivedActions(undefined).rows, [])
})

// ── the writer's contract, at the source level ──────────────────────────────
import { readFileSync } from 'node:fs'
const inbox = readFileSync(new URL('../inbox.mjs', import.meta.url), 'utf8')
const writer = readFileSync(new URL('../nvoy-index.mjs', import.meta.url), 'utf8')

test('the mirror runs AFTER the local record, in BOTH consume paths', () => {
  // Scoped per function on purpose: a whole-file indexOf found the PASS path's mirror, which sits
  // earlier in the file than the POST path's local write, and reported a false failure. The invariant is
  // per path — the local ledger is that path's idempotence key and must not depend on a relay.
  const post = inbox.slice(inbox.indexOf('async function postInMyHand'))
  assert.ok(post.indexOf('markPosted(d.grant') > -1)
  assert.ok(post.indexOf('recordConsumptionInIndex(state.relay') > post.indexOf('markPosted(d.grant'),
    'post: local record first')

  const pass = inbox.slice(inbox.indexOf("[data-pass]"))
  assert.ok(pass.indexOf('markPassed(d.grant') > -1)
  assert.ok(pass.indexOf('recordConsumptionInIndex(state.relay') > pass.indexOf('markPassed(d.grant'),
    'pass: local record first')
})

test('passing never BLOCKS on the relay — an inert card has no message slot to report into', () => {
  const pass = inbox.slice(inbox.indexOf("[data-pass]"), inbox.indexOf("[data-pass]") + 1200)
  assert.doesNotMatch(pass, /await recordConsumptionInIndex/, 'awaiting here would stall the decline')
  assert.match(pass, /console\.warn/, 'a mirror failure must at least be said out loud')
})

test('a failed mirror is REPORTED, and says the note is nonetheless posted', () => {
  // By then the Director has signed. The note is real and the record is not, and only one is retryable.
  assert.match(inbox, /⚠ not recorded in Nvoy/)
  assert.match(inbox, /the note IS posted/)
})

test('a successful mirror carries the pill the estate standardised on', () => {
  assert.match(inbox, /· recorded in Nvoy/)
})

test('the write is idempotent per (scope, outcome), so a retry cannot double-record', () => {
  assert.match(writer, /e\?\.t === 'consumed' && e\.scope === scopeId && e\.outcome === outcome/)
})

test('the writer merges a FRESH index rather than clobbering Nvoy\'s other grants', () => {
  const body = writer.slice(writer.indexOf('export async function recordConsumptionInIndex'))
  assert.match(body, /loadGrantIndex\(relay, signer\)/)
})

test('the writer never touches index.issued — the direction is preserved in code, not just in docs', () => {
  const body = writer.slice(writer.indexOf('export async function recordConsumptionInIndex'))
  assert.doesNotMatch(body, /index\.issued/)
})
