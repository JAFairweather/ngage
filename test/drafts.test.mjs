// drafts.test.mjs — the unwrap + trust pipeline, driven end-to-end with REAL
// fixtures: fresh keys every run, grants built by the vendored nipxx.mjs (the
// NIP-DA reference — the same code the agent side runs), an in-memory relay
// with exactly the query surface the app uses ({kinds,'#p'} and
// {kinds,authors,'#d'}), and the Director represented by the ngage-extended
// nave-connect localSigner — proving the signer-driven path needs no raw key.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey, getEventHash, finalizeEvent, matchFilter, nip44, verifyEvent } from 'nostr-tools'
import { publishScope, grant, newScopeKey } from '../lib/nipxx.mjs'
import { localSigner } from '../lib/nave-connect.mjs'
import { giftUnwrapWithSigner, receiveGrantsWithSigner, trustedDrafts, readDraftPayload, loadDrafts } from '../drafts.mjs'

// -- the relay stub: NIP-01 storage + filters + addressable replacement ------
const isAddressable = (k) => k >= 30000 && k < 40000
const dTag = (e) => e.tags.find(t => t[0] === 'd')?.[1] ?? ''
class MemRelay {
  events = []
  publish(event) {
    if (!verifyEvent(event)) throw new Error('invalid signature')
    if (isAddressable(event.kind)) {
      const key = `${event.kind}:${event.pubkey}:${dTag(event)}`
      this.events = this.events.filter(e => !(isAddressable(e.kind) && `${e.kind}:${e.pubkey}:${dTag(e)}` === key))
    }
    this.events.push(event)
  }
  query(filter) { return this.events.filter(e => matchFilter(filter, e)).sort((a, b) => b.created_at - a.created_at) }
  inject(event) { this.events.push(event) }   // the hostile-relay door: no checks
}

// -- fixture cast ------------------------------------------------------------
const mk = () => { const sk = generateSecretKey(); return { sk, pub: getPublicKey(sk) } }

const PAYLOAD = {
  text: 'Hand out references, not copies. #Nave #SovereignDrafts',
  image: { url: 'https://nave.pub/assets/cards/grants.png', alt: 'letterpress card' },
  hashtags: ['nave', 'sovereigndrafts'],
  rationale: 'The grants card is the strongest hook this week.',
  proposedBy: 'luke-brain',
  proposedAt: 1700000000,
}

async function seed(relay, agent, director, {
  scopeId = 'p-' + Math.random().toString(36).slice(2, 10),
  scopeName = 'draft:post/w1',
  payload = PAYLOAD,
  generation = 1,
} = {}) {
  const scopeKey = newScopeKey()
  await publishScope(relay, agent.sk, { scopeId, generation, scopeKey, payload })
  await grant(relay, agent.sk, director.pub, { scopeId, generation, scopeKey, scopeName })
  return { scopeId, scopeKey, scopeName, generation }
}

test('happy path: a granted draft unwraps, passes the gates, decodes', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk()
  const { scopeId } = await seed(relay, agent, director)

  const signer = localSigner(director.sk)          // ngage-extended: nip44-capable
  const drafts = await loadDrafts(relay, signer, [agent.pub])

  assert.equal(drafts.length, 1)
  const d = drafts[0]
  assert.equal(d.status, 'ready')
  assert.equal(d.grant.author, agent.pub)          // seal-verified authorship
  assert.equal(d.grant.publisher, agent.pub)
  assert.equal(d.grant.scopeId, scopeId)
  assert.equal(d.grant.scopeName, 'draft:post/w1')
  assert.equal(d.grant.generation, 1)
  assert.equal(d.draft.text, PAYLOAD.text)
  assert.deepEqual(d.draft.image, { url: PAYLOAD.image.url, alt: PAYLOAD.image.alt })
  assert.equal(d.draft.rationale, PAYLOAD.rationale)
  assert.equal(d.draft.proposedBy, 'luke-brain')
  assert.equal(d.draft.proposedAt, 1700000000)
})

test('wrong-recipient wraps are skipped, not fatal', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk(), bystander = mk()

  // a grant addressed to someone else entirely: the '#p' query never sees it
  await seed(relay, agent, bystander)
  const signer = localSigner(director.sk)
  assert.deepEqual(await receiveGrantsWithSigner(relay, signer), [])

  // a hostile relay re-tags that wrap to the Director: ciphertext is still for
  // the bystander, decrypt fails, the wrap is skipped silently
  const [foreign] = relay.query({ kinds: [1059] })
  relay.inject({ ...foreign, id: 'f'.repeat(64), tags: [['p', director.pub]] })
  const grants = await receiveGrantsWithSigner(relay, signer)
  assert.deepEqual(grants, [])

  // and a real grant alongside the junk still comes through
  await seed(relay, agent, director, { scopeName: 'draft:post/w2' })
  assert.equal((await receiveGrantsWithSigner(relay, signer)).length, 1)
})

test('seal/rumor pubkey mismatch is rejected — the authentication check', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk(), mallory = mk()

  // Mallory seals a rumor that CLAIMS the agent authored it. The seal verifies
  // (she signed it properly) — but the rumor's name is not hers.
  const rumor = {
    pubkey: agent.pub, kind: 440, created_at: 1700000000,
    tags: [['a', `30440:${agent.pub}:sx`, ''], ['v', '1']],
    content: JSON.stringify({ scope_key: btoa('k'.repeat(32)), scope_name: 'draft:post/forged' }),
  }
  rumor.id = getEventHash(rumor)
  const seal = finalizeEvent({
    kind: 13, created_at: 1700000000, tags: [],
    content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(mallory.sk, director.pub)),
  }, mallory.sk)
  const eph = generateSecretKey()
  const wrap = finalizeEvent({
    kind: 1059, created_at: 1700000000, tags: [['p', director.pub]],
    content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(eph, director.pub)),
  }, eph)

  const signer = localSigner(director.sk)
  await assert.rejects(giftUnwrapWithSigner(signer, wrap), /seal\/rumor pubkey mismatch/)
  relay.publish(wrap)
  assert.deepEqual(await receiveGrantsWithSigner(relay, signer), [])   // skipped in the sweep
})

test('untrusted author is filtered by the allowlist gate', async () => {
  const relay = new MemRelay()
  const trusted = mk(), stranger = mk(), director = mk()
  await seed(relay, trusted, director, { scopeName: 'draft:post/in' })
  await seed(relay, stranger, director, { scopeName: 'draft:post/out' })

  const drafts = await loadDrafts(relay, localSigner(director.sk), [trusted.pub])
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].grant.author, trusted.pub)

  // empty allowlist = empty desk
  assert.deepEqual(await loadDrafts(relay, localSigner(director.sk), []), [])
})

test('non-draft namespaces are invisible to this app', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk()
  await seed(relay, agent, director, { scopeName: 'contact:home' })
  await seed(relay, agent, director, { scopeName: 'drafting:not-quite' })   // prefix must be exactly draft:
  assert.deepEqual(await loadDrafts(relay, localSigner(director.sk), [agent.pub]), [])
})

test('re-wrapped grants are rejected even from an allowlisted author', async () => {
  const relay = new MemRelay()
  const agent = mk(), mallory = mk(), director = mk()

  // the agent's real scope exists…
  const { scopeId, scopeKey } = await seed(relay, agent, director, { scopeName: 'draft:post/real' })

  // …and Mallory — holding the real key — re-grants it under HER seal, with
  // the a-tag still pointing at the agent's scope. author ≠ publisher.
  const rumor = {
    pubkey: mallory.pub, kind: 440, created_at: 1700000001,
    tags: [['a', `30440:${agent.pub}:${scopeId}`, ''], ['v', '1']],
    content: JSON.stringify({ scope_key: btoa(String.fromCharCode(...scopeKey)), scope_name: 'draft:post/real' }),
  }
  rumor.id = getEventHash(rumor)
  const seal = finalizeEvent({
    kind: 13, created_at: 1700000001, tags: [],
    content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(mallory.sk, director.pub)),
  }, mallory.sk)
  const eph = generateSecretKey()
  relay.publish(finalizeEvent({
    kind: 1059, created_at: 1700000001, tags: [['p', director.pub]],
    content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(eph, director.pub)),
  }, eph))

  const signer = localSigner(director.sk)
  const all = await receiveGrantsWithSigner(relay, signer)
  const rewrap = all.find(g => g.author === mallory.pub)
  assert.ok(rewrap, 'the re-wrap DOES unwrap — rejection is the trust gate, not the crypto')
  assert.equal(rewrap.publisher, agent.pub)

  // Mallory is on the allowlist — the first-hand gate still rejects her re-wrap
  const admitted = trustedDrafts(all, [agent.pub, mallory.pub])
  assert.deepEqual(admitted.map(g => g.author), [agent.pub])
})

test('a rotated scope reads stale → withdrawn by agent', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk()
  const { scopeId } = await seed(relay, agent, director)

  // the agent thinks better of it: new key, new generation, granted to no one
  await publishScope(relay, agent.sk, { scopeId, generation: 2, scopeKey: newScopeKey(), payload: {} })

  const [d] = await loadDrafts(relay, localSigner(director.sk), [agent.pub])
  assert.equal(d.status, 'withdrawn')
  assert.equal(d.draft, undefined)
})

test('a rotation re-granted supersedes: only the newest generation surfaces', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk()
  const { scopeId, scopeName } = await seed(relay, agent, director)

  const k2 = newScopeKey()
  const v2 = { ...PAYLOAD, text: 'Second thoughts, better words. #Nave' }
  await publishScope(relay, agent.sk, { scopeId, generation: 2, scopeKey: k2, payload: v2 })
  await grant(relay, agent.sk, director.pub, { scopeId, generation: 2, scopeKey: k2, scopeName })

  const drafts = await loadDrafts(relay, localSigner(director.sk), [agent.pub])
  assert.equal(drafts.length, 1)                    // latestGrants collapsed gen1
  assert.equal(drafts[0].grant.generation, 2)
  assert.equal(drafts[0].status, 'ready')
  assert.equal(drafts[0].draft.text, v2.text)
})

test('malformed payloads are inert, never signable', async () => {
  const relay = new MemRelay()
  const agent = mk(), director = mk()
  await seed(relay, agent, director, { payload: { memo: 'not a draft at all' } })
  await seed(relay, agent, director, {
    scopeName: 'draft:post/evil',
    payload: { text: 'looks fine', image: { url: 'javascript:alert(1)' } },   // non-http image → malformed
  })

  const drafts = await loadDrafts(relay, localSigner(director.sk), [agent.pub])
  assert.equal(drafts.length, 2)
  assert.ok(drafts.every(d => d.status === 'malformed' && d.draft === undefined))

  // the tolerant reader, directly: absence is fine, wrong shapes are not
  assert.equal(readDraftPayload({ text: 'just words' }).ok, true)
  assert.equal(readDraftPayload({ image: { url: 'https://x.dev/a.png' } }).ok, true)
  assert.equal(readDraftPayload({ text: 'x', image: {} }).ok, false)       // image present but no url
  assert.equal(readDraftPayload(null).ok, false)
  assert.equal(readDraftPayload(['array']).ok, false)
})

// Regression: the scribe writes `image: p.image || null`, so every bare
// personal draft carries an explicit null. That is "no image", not a lying
// shape — treating it as malformed made every card-less draft inert.
test('readDraftPayload: an explicit null image is absent, not malformed', () => {
  const r = readDraftPayload({ text: 'a bare personal draft', image: null, proposedBy: 'luke' })
  assert.equal(r.ok, true, 'null image must not be malformed')
  assert.equal(r.draft.image, undefined)
  assert.equal(r.draft.text, 'a bare personal draft')
  // a present-but-broken image object is still malformed
  assert.equal(readDraftPayload({ text: 'x', image: { url: 'javascript:alert(1)' } }).ok, false)
  assert.equal(readDraftPayload({ text: 'x', image: {} }).ok, false)
})

// The pen rule (#11; nact#44): a PEN proves itself by the seal; a COORDINATOR
// is a courier whose payload must carry the draft SIGNED by an allowlisted
// pen — and the desk renders from those attested bytes, not the courier's.
test('the pen rule: coordinators may only courier pen-signed words', async () => {
  const relay = new MemRelay()
  const pen = mk()             // jaf-quill — the pen (key off-box in prod)
  const courier = mk()         // the Nactor — a coordinator
  const stranger = mk()
  const director = mk()
  const cfg = { agents: [pen.pub], deliverers: [courier.pub] }
  const core = { text: 'penned words ride', hashtags: ['nave'], rationale: 'the pen said so' }
  const attest = finalizeEvent({ kind: 24140, created_at: 1700000001, tags: [], content: JSON.stringify(core) }, pen.sk)

  await seed(relay, courier, director, { scopeName: 'draft:post/a1', payload: { text: 'courier words (must never render)', pen: attest } })
  await seed(relay, courier, director, { scopeName: 'draft:post/a2', payload: { text: 'no pen at all' } })
  const wrongKey = finalizeEvent({ kind: 24140, created_at: 1700000002, tags: [], content: JSON.stringify(core) }, stranger.sk)
  await seed(relay, courier, director, { scopeName: 'draft:post/a3', payload: { text: 'x', pen: wrongKey } })
  const forged = { ...attest, content: JSON.stringify({ text: 'attacker words' }) }   // sig reuse under swapped bytes
  await seed(relay, courier, director, { scopeName: 'draft:post/a4', payload: { text: 'x', pen: forged } })
  await seed(relay, pen, director, { scopeName: 'draft:post/a5', payload: { text: 'direct from the pen' } })

  const drafts = await loadDrafts(relay, localSigner(director.sk), cfg)
  const by = (n) => drafts.find(d => d.grant.scopeName === `draft:post/${n}`)

  assert.equal(by('a1').status, 'ready', 'courier + valid pen → ready')
  assert.equal(by('a1').draft.text, 'penned words ride', 'the ATTESTED bytes render, never the courier\'s')
  assert.deepEqual(by('a1').penned, { by: pen.pub, direct: false }, 'penned by the pen, via the courier')
  assert.equal(by('a2').status, 'unpenned', 'courier without a pen → inert')
  assert.equal(by('a3').status, 'unpenned', 'signed, but not by one of YOUR pens → inert')
  assert.equal(by('a4').status, 'unpenned', 'signature reuse under swapped content → inert (recomputed hash)')
  assert.equal(by('a5').status, 'ready', 'the pen-direct lane is untouched')
  assert.deepEqual(by('a5').penned, { by: pen.pub, direct: true }, 'the seal-verified author IS the pen')
})
