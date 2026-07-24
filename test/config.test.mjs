// config.test.mjs — the two localStorage stores, with an injectable stub:
// settings sanitization fails CLOSED on the trust anchor (agents) and falls
// back to defaults on relays; the consumption ledger keys by full scope
// identity so a rotation surfaces fresh while a settled generation stays put.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RELAYS, sanitizeConfig, loadConfig, saveConfig, admissionList } from '../config.mjs'
import { draftKey, loadStore, markPosted, markPassed, recordFor } from '../store.mjs'

const memStorage = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

test('sanitizeConfig: relays fall back to defaults, agents fall back to EMPTY', () => {
  assert.deepEqual(sanitizeConfig(undefined), { relays: DEFAULT_RELAYS, agents: [], deliverers: [] })
  assert.deepEqual(sanitizeConfig({ relays: ['nonsense', 42], agents: 'not-a-list' }),
    { relays: DEFAULT_RELAYS, agents: [], deliverers: [] })
  const ok = sanitizeConfig({ relays: ['wss://r.example/ ', 'wss://r.example'], agents: [PK_A.toUpperCase(), PK_A, 'npub1nothex'] })
  assert.deepEqual(ok.relays, ['wss://r.example'])          // trimmed, deduped
  assert.deepEqual(ok.agents, [PK_A])                       // hex-validated, lowercased, deduped
})

test('config round-trips through injected storage; garbage loads as defaults', () => {
  const s = memStorage()
  saveConfig({ relays: ['ws://localhost:7777'], agents: [PK_A] }, s)
  assert.deepEqual(loadConfig(s), { relays: ['ws://localhost:7777'], agents: [PK_A], deliverers: [] })
  s.setItem('ngage-config', '{corrupt')
  assert.deepEqual(loadConfig(s), { relays: DEFAULT_RELAYS, agents: [], deliverers: [] })
})

// --- pens vs coordinators (#9): two lists, two trust grants ----------------
test('deliverers: sanitized like agents, and a pubkey holds ONE role (pen wins)', () => {
  const cfg = sanitizeConfig({ agents: [PK_A], deliverers: [PK_B.toUpperCase(), PK_B, 'garbage', PK_A] })
  assert.deepEqual(cfg.deliverers, [PK_B], 'validated, lowercased, deduped — and the pen dropped')
  assert.deepEqual(sanitizeConfig({ deliverers: 'not-a-list' }).deliverers, [], 'fail closed')
})

test('admissionList: pens ∪ coordinators — and steering must never use it', () => {
  const cfg = sanitizeConfig({ agents: [PK_A], deliverers: [PK_B] })
  assert.deepEqual(admissionList(cfg), [PK_A, PK_B])
  assert.deepEqual(admissionList(sanitizeConfig(undefined)), [], 'empty desk by default')
  // The boundary this split exists for: the steering publish target is
  // cfg.agents ALONE. A coordinator in the steering audience is the leak the
  // Director caught (#9) — pin the property here so a refactor can't regress it.
  assert.ok(!cfg.agents.includes(PK_B), 'coordinator is not in the steering audience')
})

test('consumption ledger: keyed by publisher:scopeId#generation', () => {
  const s = memStorage()
  const g1 = { publisher: PK_A, scopeId: 'p1', generation: 1, scopeName: 'draft:post/x', author: PK_A }
  const g2 = { ...g1, generation: 2 }

  markPosted(g1, { noteId: 'note1abc', acks: 2, of: 3 }, s)
  let store = loadStore(s)
  assert.equal(recordFor(store, g1).state, 'posted')
  assert.equal(recordFor(store, g1).noteId, 'note1abc')
  assert.equal(recordFor(store, g2), null)                  // the rotation surfaces fresh

  markPassed(g2, s)
  store = loadStore(s)
  assert.equal(recordFor(store, g2).state, 'passed')
  assert.notEqual(draftKey(g1), draftKey(g2))
})
