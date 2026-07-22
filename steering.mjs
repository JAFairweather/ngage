// steering.mjs — the OUTBOUND half of the desk, and the mirror image of
// drafts.mjs. Where drafts.mjs unwraps grants the agent sends the Director,
// this publishes a grant the Director sends the agent: his drafting steering
// (voice, topics, cadence, graphics, house rules), delivered as a NIP-DA
// `steer:draft` scope gift-wrapped to the scribe's npub.
//
// drafts.mjs reimplemented nipxx.giftUnwrap signer-driven (receiveGrantsWithSigner)
// because Ngage never holds a raw key. This is the exact counterpart:
// publishScopeWithSigner + grantWithSigner reimplement nipxx.publishScope /
// grant / giftWrap signer-driven, matching the vendored wire format
// FIELD-FOR-FIELD so the scribe's STOCK nipxx.receiveGrants unwraps them:
//
//   kind-30440 Scoped Data Set  — signed by the Director's SIGNER;
//                                 payload NIP-44'd under the RAW scope key (pure)
//   kind-440   grant rumor       — the scope key, addressed a=30440:<director>:<id>
//     └─ kind-13 seal            — signed by the SIGNER; rumor NIP-44'd to the
//                                  grantee via the SIGNER (nip44Encrypt)
//         └─ kind-1059 gift wrap — a FRESH EPHEMERAL key seals to the grantee
//                                  (pure) — the relay sees only ephemeral→grantee
//
// The Director's secret key never appears here; only his signer does. The one
// piece of raw key material is the per-scope symmetric scope key, which is
// generated in-page, sealed to the grantee, and (deliberately) never persisted
// — every republish rotates it (see the store below).

import { finalizeEvent, generateSecretKey, getEventHash, nip44 } from 'nostr-tools'
import { KIND_DATA_SET, KIND_GRANT, newScopeKey } from './lib/nipxx.mjs'

// ---- wire constants --------------------------------------------------------
// Per the shared contract: BOTH the scope's grant name and the payload's kind
// marker are the literal string "steer:draft". The scribe filters on the
// former; the latter self-describes the decrypted document.
export const STEER_SCOPE_NAME = 'steer:draft'
export const STEER_KIND = 'steer:draft'
export const STEERING_KEY = 'ngage-steering'

// nipxx's now()/fuzz()/b64 are module-private; replicate them verbatim so the
// bytes we emit are indistinguishable from a raw-key nipxx publisher's.
let lastTs = 0
const now = () => (lastTs = Math.max(Math.floor(Date.now() / 1000), lastTs + 1))
const fuzz = () => now() - Math.floor(Math.random() * 2 * 24 * 60 * 60)
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))

// ---- signer-driven crypto (nipxx counterparts) -----------------------------

/** nipxx.giftWrap, verbatim ceremony, signer-driven: the seal is signed and
 *  encrypted by the Director's signer; the wrap rides a fresh ephemeral key. */
async function giftWrapWithSigner(signer, recipientPub, rumor) {
  rumor.id = getEventHash(rumor)
  const seal = await signer.signEvent({
    kind: 13, created_at: fuzz(), tags: [],
    content: await signer.nip44Encrypt(recipientPub, JSON.stringify(rumor)),
  })
  const ephemeral = generateSecretKey()
  return finalizeEvent({
    kind: 1059, created_at: fuzz(), tags: [['p', recipientPub]],
    content: nip44.v2.encrypt(JSON.stringify(seal),
      nip44.v2.utils.getConversationKey(ephemeral, recipientPub)),
  }, ephemeral)
}

/**
 * Publish (or replace) a Scoped Data Set, signer-driven. Mirrors
 * nipxx.publishScope: same tags (['d', scopeId], ['v', generation]), same
 * `updated_at` stamp folded into the payload, same symmetric encryption under
 * the RAW scope key (no signer — the scope key IS the NIP-44 conversation key).
 */
export async function publishScopeWithSigner(relay, signer, { scopeId, generation, scopeKey, payload }) {
  const ts = now()
  const event = await signer.signEvent({
    kind: KIND_DATA_SET,
    created_at: ts,
    tags: [['d', scopeId], ['v', String(generation)]],
    content: nip44.v2.encrypt(JSON.stringify({ ...payload, updated_at: ts }), scopeKey),
  })
  const receipt = await relay.publish(event)
  return { event, ...receipt }
}

/**
 * Issue a Data Grant, signer-driven. Mirrors nipxx.grant field-for-field: the
 * rumor's pubkey is the Director (via signer.getPublicKey), the a-tag is
 * `30440:<director>:<scopeId>`, the content carries { scope_key, scope_name }.
 * Sealed + gift-wrapped to the grantee through giftWrapWithSigner.
 */
export async function grantWithSigner(relay, signer, granteePubkey,
                                      { scopeId, generation, scopeKey, scopeName, relayHint = '' }) {
  const publisherPub = await signer.getPublicKey()
  const rumor = {
    pubkey: publisherPub,
    kind: KIND_GRANT,
    created_at: now(),
    tags: [
      ['a', `${KIND_DATA_SET}:${publisherPub}:${scopeId}`, relayHint],
      ['v', String(generation)],
    ],
    content: JSON.stringify({ scope_key: b64(scopeKey), scope_name: scopeName }),
  }
  const wrap = await giftWrapWithSigner(signer, granteePubkey, rumor)
  const receipt = await relay.publish(wrap)
  return { wrap, ...receipt }
}

// ---- the steering document -------------------------------------------------

/** Coerce loose form state into the canonical field shape (every field
 *  optional). Strings trimmed; lists de-blanked. Never throws. */
export function normalizeSteering(s) {
  const o = s && typeof s === 'object' && !Array.isArray(s) ? s : {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
  return {
    voice: str(o.voice),
    leanInto: list(o.leanInto),
    avoid: list(o.avoid),
    cadence: str(o.cadence),
    graphics: str(o.graphics),
    houseRules: str(o.houseRules),
  }
}

/** The starting steering document — derived from the Director's own published
 *  writing (nave.pub/library/articles), so the panel opens on his actual voice
 *  instead of a blank form. This is only the STARTING point: nothing is granted
 *  to anyone until he reviews and publishes, and a live steering grant always
 *  wins over these defaults. */
export const DEFAULT_STEERING = {
  voice:
    'Structural and argumentative, never announcemental. Open on the claim or the tension, ' +
    'not the news. Be concrete — name the actual mechanism (the kind number, the rotation, ' +
    'the ~300 lines) instead of gesturing at it. State limits out loud: honesty about what ' +
    "something can't do is part of the argument, not a hedge to smooth away. A contrarian " +
    "framing earns its keep when it's true ('the portfolio grew upward, not sideways'). " +
    "No hype, no launch voice, no 'excited to share'.",
  leanInto: [
    'protocols over platforms — building upward on one primitive',
    'revocation as key rotation, and what it honestly cannot undo',
    'scoped, delegated data; agents on a leash',
    'a per-person agent, not a seat in a shared one',
    'self-hosting war stories with the false starts left in',
    'games as proving grounds for protocol',
    "what's still open — the unsolved part",
  ],
  avoid: [
    "launch-announcement voice ('shipped', 'excited to share')",
    'claiming completeness, or smoothing a real limitation away',
    'platform / product marketing register',
    "vague gestures at 'privacy' or 'AI' with no mechanism named",
  ],
  cadence:
    'Fewer, deeper. One developed thought beats three thin ones — do not ration when the ' +
    'material is rich, and do not pad when it is not.',
  graphics:
    'Pick the card whose concept matches the argument (grants, revocation, nactor, nave). ' +
    'Go bare rather than force a mismatched card.',
  houseRules:
    'Reach for the idea inside the work, not the fact that work happened. One nave.pub link ' +
    'and 1–3 lowercase topical hashtags; never #nostr.',
}

/** Assemble the on-wire payload. Empty fields are OMITTED — the scribe tolerates
 *  absence, so a lean steering document stays lean on the relay. */
export function buildSteerPayload(steering, updatedAt = now()) {
  const n = normalizeSteering(steering)
  const payload = { kind: STEER_KIND, updatedAt }
  if (n.voice) payload.voice = n.voice
  if (n.leanInto.length) payload.leanInto = n.leanInto
  if (n.avoid.length) payload.avoid = n.avoid
  if (n.cadence) payload.cadence = n.cadence
  if (n.graphics) payload.graphics = n.graphics
  if (n.houseRules) payload.houseRules = n.houseRules
  return payload
}

/** True when a steering document would carry no actual guidance (blank form) —
 *  the panel uses this to refuse an empty publish. */
export function isSteeringEmpty(steering) {
  const p = buildSteerPayload(steering)
  return !(p.voice || p.leanInto || p.avoid || p.cadence || p.graphics || p.houseRules)
}

/** An opaque 12-byte scope id (hex), like the scribe's draft scopes — semantic
 *  names in a d-tag would leak the disclosure structure to relays. */
export function newScopeId() {
  return b64(crypto.getRandomValues(new Uint8Array(12)))
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16)
}

/**
 * Publish steering to one or more grantees: one Scoped Data Set, then a sealed
 * grant of it to EACH grantee (the scribe's npub — the same shape whether one
 * agent or several). Returns per-grantee publish receipts.
 */
export async function publishSteering(relay, signer, grantees, { scopeId, generation, scopeKey, steering }) {
  const payload = buildSteerPayload(steering)
  const scope = await publishScopeWithSigner(relay, signer, { scopeId, generation, scopeKey, payload })
  const grants = []
  for (const grantee of grantees) {
    grants.push(await grantWithSigner(relay, signer, grantee,
      { scopeId, generation, scopeKey, scopeName: STEER_SCOPE_NAME }))
  }
  return { scope, grants, payload }
}

// ---- store: NON-SECRET steering cache (config.mjs discipline) --------------
// localStorage holds ONLY { scopeId, generation, steering } — never a scope
// key. Reusing scopeId keeps every republish the SAME addressable scope (the
// relay replaces the prior generation); bumping generation + a fresh key each
// save IS the rotation. So the cache is safe to persist in the clear: it is
// endpoints and the Director's own words, not key material.

export function loadSteering(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(STEERING_KEY))
    if (!raw || typeof raw !== 'object') return { scopeId: null, generation: 0, steering: normalizeSteering() }
    return {
      scopeId: typeof raw.scopeId === 'string' ? raw.scopeId : null,
      generation: Number.isFinite(raw.generation) ? raw.generation : 0,
      steering: normalizeSteering(raw.steering),
    }
  } catch { return { scopeId: null, generation: 0, steering: normalizeSteering() } }
}

export function saveSteering(record, storage = globalThis.localStorage) {
  const clean = {
    scopeId: typeof record.scopeId === 'string' ? record.scopeId : null,
    generation: Number.isFinite(record.generation) ? record.generation : 0,
    steering: normalizeSteering(record.steering),
  }
  storage?.setItem(STEERING_KEY, JSON.stringify(clean))
  return clean
}

/**
 * Save steering to the relays and advance the local cache. Mints a scopeId on
 * first use; thereafter reuses it and bumps the generation, rotating to a fresh
 * scope key every time (republish = rotate). Grantees receive the new key
 * sealed to them; anyone dropped from `grantees` is thereby cut off.
 * Returns { record, result } — the persisted cache row and the publish receipts.
 */
export async function saveAndPublishSteering(relay, signer, grantees, steering, storage = globalThis.localStorage) {
  const prev = loadSteering(storage)
  const scopeId = prev.scopeId ?? newScopeId()
  const generation = (prev.generation ?? 0) + 1
  const scopeKey = newScopeKey()
  const result = await publishSteering(relay, signer, grantees, { scopeId, generation, scopeKey, steering })
  const record = saveSteering({ scopeId, generation, steering }, storage)
  return { record, result }
}
