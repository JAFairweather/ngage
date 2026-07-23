// Proves the Director's rule: after a steering save, the grant is visible in
// NVOY — the single source of truth for all grants. The test writes the index
// through Ngage's recordSteeringInIndex and then renders it with Nvoy's REAL
// deriveDelegations (imported by absolute path), so any drift between the two
// apps' index shape fails here rather than in production.
//
//   node --test test/nvoy-index.test.mjs   (or: node test/nvoy-index.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert'
import { recordSteeringInIndex } from '../nvoy-index.mjs'
// Nvoy's actual renderer — the source of truth for how a grant appears.
import { deriveDelegations } from '/Users/fairwja/Projects/nave-spine/nvoy/console/ledgerlog.mjs'

const AGENT_A = 'a'.repeat(64)   // James's Quill, say
const AGENT_B = 'b'.repeat(64)
const SCOPE = 'steerscope1'

// A fake relay backing loadGrantIndex/saveGrantIndex with an in-memory index,
// and a signer that self-encrypts as a plain JSON passthrough (nip44 not
// exercised — we test the index MERGE + render, not the crypto).
function harness(seedIndex = { issued: [], received: [], nvoy_ledger: [], nvoy_agents: [] }) {
  let stored = JSON.parse(JSON.stringify(seedIndex))
  const signer = {
    getPublicKey: async () => 'd'.repeat(64),
    nip44Encrypt: async (_pk, pt) => pt,          // passthrough
    nip44Decrypt: async (_pk, ct) => ct,
    signEvent: async (e) => ({ ...e, id: 'x', sig: 'y' }),
  }
  const relay = {
    async query() { return stored.__event ? [stored.__event] : [] },
    async publish(event) { stored = JSON.parse(event.content); stored.__event = event; return { acks: 1 } },
  }
  // Prime the "stored event" so loadGrantIndex finds it.
  relay.__seed = () => { stored.__event = { content: JSON.stringify(stored), pubkey: 'd'.repeat(64) } }
  relay.__seed()
  return { relay, signer, read: () => stored }
}

test('a steering save makes the grant renderable by Nvoy as an active delegation', async () => {
  const { relay, signer, read } = harness()
  const r = await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 1, scopeKey: new Uint8Array(32), grantees: [AGENT_A] })
  assert.deepStrictEqual(r, { added: 1, dropped: 0, total: 1 })

  const idx = read()
  // Nvoy's OWN renderer must show the steering grant, active, to AGENT_A.
  const dels = deriveDelegations(idx)
  const row = dels.find(d => d.scope === SCOPE && d.agent === AGENT_A)
  assert.ok(row, 'the steering delegation is present in Nvoy\'s derived list')
  assert.strictEqual(row.status, 'active')
  assert.strictEqual(row.scopeName, 'steer:draft')
  // …and the grantee is in the registry so its agent card exists.
  assert.ok(idx.nvoy_agents.some(a => a.pub === AGENT_A), 'grantee added to nvoy_agents')
})

test('re-saving steering (rotation) keeps ONE active row, bumped generation', async () => {
  const { relay, signer, read } = harness()
  await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 1, scopeKey: new Uint8Array(32), grantees: [AGENT_A] })
  await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 2, scopeKey: new Uint8Array(32), grantees: [AGENT_A] })
  const idx = read()
  assert.strictEqual(idx.issued.filter(e => e.scope === SCOPE).length, 1, 'never duplicated')
  assert.strictEqual(idx.issued.find(e => e.scope === SCOPE).v, 2, 'generation advanced')
  const dels = deriveDelegations(idx).filter(d => d.scope === SCOPE)
  assert.strictEqual(dels.length, 1)
  assert.strictEqual(dels[0].status, 'active')
})

test('adding a second trusted agent grants it; dropping one revokes it — both visible in Nvoy', async () => {
  const { relay, signer, read } = harness()
  await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 1, scopeKey: new Uint8Array(32), grantees: [AGENT_A] })
  // add B
  const r2 = await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 2, scopeKey: new Uint8Array(32), grantees: [AGENT_A, AGENT_B] })
  assert.deepStrictEqual(r2, { added: 1, dropped: 0, total: 2 })
  // drop A (cut the old ghostwriter off)
  const r3 = await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 3, scopeKey: new Uint8Array(32), grantees: [AGENT_B] })
  assert.deepStrictEqual(r3, { added: 0, dropped: 1, total: 1 })

  const dels = deriveDelegations(read())
  assert.strictEqual(dels.find(d => d.agent === AGENT_B && d.scope === SCOPE).status, 'active')
  assert.strictEqual(dels.find(d => d.agent === AGENT_A && d.scope === SCOPE).status, 'revoked',
    'the dropped agent shows revoked in Nvoy, not vanished')
})

test('recording steering never clobbers OTHER grants already in the index', async () => {
  const seed = {
    issued: [{ scope: 'other1', scope_name: 'credential:google', v: 1, key: 'AAA', grantees: [AGENT_B] }],
    received: [], nvoy_ledger: [{ t: 'granted', at: 1, scope: 'other1', agent: AGENT_B, v: 1, name: 'credential:google' }],
    nvoy_agents: [{ pub: AGENT_B, added_at: 1 }],
  }
  const { relay, signer, read } = harness(seed)
  await recordSteeringInIndex(relay, signer,
    { scopeId: SCOPE, scopeName: 'steer:draft', generation: 1, scopeKey: new Uint8Array(32), grantees: [AGENT_A] })
  const idx = read()
  assert.ok(idx.issued.some(e => e.scope === 'other1'), 'the pre-existing credential grant survives')
  const dels = deriveDelegations(idx)
  assert.ok(dels.some(d => d.scope === 'other1' && d.status === 'active'), 'and still renders active')
  assert.ok(dels.some(d => d.scope === SCOPE && d.status === 'active'), 'alongside the new steering grant')
})
