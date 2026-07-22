// steering.test.mjs — the OUTBOUND wire, proven against the STOCK grantee path.
//
// The whole point of the signer-driven publish/grant is that its bytes are
// indistinguishable from a raw-key nipxx publisher's — so the scribe, running
// the vendored (stock) nipxx.receiveGrants with a RAW secret key, unwraps what
// the Director's SIGNER sealed. Every round-trip here builds with the
// ngage-extended localSigner (no raw key in the publish path) and reads with
// stock nipxx.receiveGrants + fetchScope: cross-implementation, byte-exact.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, matchFilter, verifyEvent } from 'nostr-tools'
import { receiveGrants, latestGrants, fetchScope, newScopeKey } from '../lib/nipxx.mjs'
import { localSigner } from '../lib/nave-connect.mjs'
import {
  publishScopeWithSigner, grantWithSigner, publishSteering, saveAndPublishSteering,
  buildSteerPayload, normalizeSteering, isSteeringEmpty, newScopeId,
  loadSteering, saveSteering, STEER_SCOPE_NAME,
} from '../steering.mjs'

// -- the relay stub: NIP-01 storage + filters + addressable replacement ------
const isAddressable = (k) => k >= 30000 && k < 40000
const dTag = (e) => e.tags.find(t => t[0] === 'd')?.[1] ?? ''
class MemRelay {
  events = []
  publish(event) {
    if (!verifyEvent(event)) throw new Error('invalid signature')   // signer output must be valid
    if (isAddressable(event.kind)) {
      const key = `${event.kind}:${event.pubkey}:${dTag(event)}`
      this.events = this.events.filter(e => !(isAddressable(e.kind) && `${e.kind}:${e.pubkey}:${dTag(e)}` === key))
    }
    this.events.push(event)
    return { acks: 1, of: 1, rejections: [] }
  }
  query(filter) { return this.events.filter(e => matchFilter(filter, e)).sort((a, b) => b.created_at - a.created_at) }
}

const mk = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) } }
const memStorage = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const STEERING = {
  voice: 'Plain, first person, dry. No hype, no emoji, no engagement bait.',
  leanInto: ['sovereign identity', 'nostr protocol design', 'shipping notes'],
  avoid: ['price talk', 'subtweets', 'hot takes on other projects'],
  cadence: 'At most two a day; skip days with nothing worth signing.',
  graphics: 'Prefer the letterpress cards when on-topic; personal notes ride bare.',
  houseRules: 'Never tag #nostr. A nave.pub link only when the post is about the Nave.',
}

test('signer-built steer:draft round-trips through STOCK nipxx.receiveGrants', async () => {
  const relay = new MemRelay()
  const director = mk(), scribe = mk()
  const signer = localSigner(director.sk)                 // NO raw key in the publish path
  const scopeId = newScopeId(), scopeKey = newScopeKey()
  const payload = buildSteerPayload(STEERING, 1700000000)

  await publishScopeWithSigner(relay, signer, { scopeId, generation: 1, scopeKey, payload })
  await grantWithSigner(relay, signer, scribe.pub, { scopeId, generation: 1, scopeKey, scopeName: STEER_SCOPE_NAME })

  // the scribe: stock grantee path, RAW secret key
  const grants = await receiveGrants(relay, scribe.sk)
  assert.equal(grants.length, 1)
  const g = grants[0]
  assert.equal(g.scopeName, 'steer:draft')
  assert.equal(g.publisher, director.pub)                 // a-tag publisher = the Director
  assert.equal(g.generation, 1)

  const scope = await fetchScope(relay, g)
  assert.equal(scope.status, 'ok')
  assert.equal(scope.data.kind, 'steer:draft')
  assert.equal(scope.data.voice, STEERING.voice)
  assert.deepEqual(scope.data.leanInto, STEERING.leanInto)
  assert.deepEqual(scope.data.avoid, STEERING.avoid)
  assert.equal(scope.data.cadence, STEERING.cadence)
  assert.equal(scope.data.graphics, STEERING.graphics)
  assert.equal(scope.data.houseRules, STEERING.houseRules)
  assert.equal(scope.data.updatedAt, 1700000000)
})

test('publishSteering seals to every grantee; each recovers the same document', async () => {
  const relay = new MemRelay()
  const director = mk(), scribeA = mk(), scribeB = mk()
  const { payload } = await publishSteering(relay, localSigner(director.sk), [scribeA.pub, scribeB.pub],
    { scopeId: newScopeId(), generation: 1, scopeKey: newScopeKey(), steering: STEERING })

  for (const scribe of [scribeA, scribeB]) {
    const [g] = latestGrants(await receiveGrants(relay, scribe.sk))
    const scope = await fetchScope(relay, g)
    assert.equal(scope.status, 'ok')
    assert.equal(scope.data.voice, payload.voice)
    assert.deepEqual(scope.data.leanInto, payload.leanInto)
  }
})

test('a non-Director publisher is filterable by publisher pubkey', async () => {
  const relay = new MemRelay()
  const director = mk(), impostor = mk(), scribe = mk()
  await publishSteering(relay, localSigner(director.sk), [scribe.pub],
    { scopeId: newScopeId(), generation: 1, scopeKey: newScopeKey(), steering: STEERING })
  await publishSteering(relay, localSigner(impostor.sk), [scribe.pub],
    { scopeId: newScopeId(), generation: 1, scopeKey: newScopeKey(), steering: { voice: 'forged voice' } })

  const all = latestGrants((await receiveGrants(relay, scribe.sk)).filter(g => g.scopeName === STEER_SCOPE_NAME))
  assert.equal(all.length, 2)                              // both are steer:draft grants to the scribe

  // the scribe's trust gate: only the Director's own publications survive
  const trusted = all.filter(g => g.publisher === director.pub)
  assert.equal(trusted.length, 1)
  assert.equal((await fetchScope(relay, trusted[0])).data.voice, STEERING.voice)
})

test('republish rotates: a new generation supersedes the last', async () => {
  const relay = new MemRelay()
  const director = mk(), scribe = mk()
  const signer = localSigner(director.sk)
  const scopeId = newScopeId()
  await publishSteering(relay, signer, [scribe.pub], { scopeId, generation: 1, scopeKey: newScopeKey(), steering: { voice: 'first voice' } })
  await publishSteering(relay, signer, [scribe.pub], { scopeId, generation: 2, scopeKey: newScopeKey(), steering: { voice: 'second voice' } })

  const grants = latestGrants(await receiveGrants(relay, scribe.sk))
  assert.equal(grants.length, 1)                           // gen1 collapsed
  assert.equal(grants[0].generation, 2)
  const scope = await fetchScope(relay, grants[0])
  assert.equal(scope.status, 'ok')
  assert.equal(scope.data.voice, 'second voice')
})

test('buildSteerPayload omits empty fields; normalizeSteering is total', () => {
  const p = buildSteerPayload({ voice: '  hi  ', leanInto: ['a', '', '  b '], avoid: [], cadence: '', graphics: undefined, houseRules: null }, 42)
  assert.deepEqual(p, { kind: 'steer:draft', updatedAt: 42, voice: 'hi', leanInto: ['a', 'b'] })
  assert.equal('avoid' in p, false)
  assert.equal('cadence' in p, false)

  assert.equal(isSteeringEmpty({}), true)
  assert.equal(isSteeringEmpty({ leanInto: [] }), true)
  assert.equal(isSteeringEmpty({ houseRules: 'x' }), false)

  assert.deepEqual(normalizeSteering(null), { voice: '', leanInto: [], avoid: [], cadence: '', graphics: '', houseRules: '' })
  assert.deepEqual(normalizeSteering({ leanInto: 'not a list' }).leanInto, [])
})

test('the steering cache round-trips and never persists key material', () => {
  const storage = memStorage()
  assert.deepEqual(loadSteering(storage), { scopeId: null, generation: 0, steering: normalizeSteering() })

  saveSteering({ scopeId: 'abc123', generation: 3, steering: STEERING }, storage)
  const back = loadSteering(storage)
  assert.equal(back.scopeId, 'abc123')
  assert.equal(back.generation, 3)
  assert.equal(back.steering.voice, STEERING.voice)
  assert.deepEqual(back.steering.avoid, STEERING.avoid)

  const raw = storage.getItem('ngage-steering')
  assert.equal(/scope_?key/i.test(raw), false)             // NON-secret cache — no key material
})

test('saveAndPublishSteering mints then reuses scopeId, bumping generation each save', async () => {
  const relay = new MemRelay()
  const director = mk(), scribe = mk()
  const signer = localSigner(director.sk)
  const storage = memStorage()

  const first = await saveAndPublishSteering(relay, signer, [scribe.pub], { voice: 'v1' }, storage)
  assert.equal(first.record.generation, 1)
  assert.ok(first.record.scopeId)

  const second = await saveAndPublishSteering(relay, signer, [scribe.pub], { voice: 'v2' }, storage)
  assert.equal(second.record.generation, 2)
  assert.equal(second.record.scopeId, first.record.scopeId)   // same addressable scope, rotated key

  const grants = latestGrants(await receiveGrants(relay, scribe.sk))
  assert.equal(grants.length, 1)
  assert.equal(grants[0].generation, 2)
  assert.equal((await fetchScope(relay, grants[0])).data.voice, 'v2')
})
