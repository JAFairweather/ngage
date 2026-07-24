// drafts.mjs — the sovereign inbox pipeline, and the one NEW crypto piece in
// Ngage: gift-unwrap driven by a SIGNER instead of a raw secret key.
//
// nipxx.receiveGrants(relay, secret) takes key material; Ngage never holds
// any. receiveGrantsWithSigner mirrors nipxx's giftUnwrap ceremony exactly,
// but every decrypt goes through the signer interface (NIP-07 extension,
// NIP-46 bunker, or the local dev signer) — the Director's key stays wherever
// the Director keeps it:
//
//   kind-1059 wrap (p-tagged to us)
//     └─ wrap.content     nip44Decrypt(wrap.pubkey)  → kind-13 seal — VERIFY its signature
//         └─ seal.content nip44Decrypt(seal.pubkey)  → kind-440 grant rumor
//             └─ ENFORCE rumor.pubkey === seal.pubkey   ← the authentication check:
//                the seal's verified signer must BE the rumor's claimed author,
//                or an attacker could put anyone's name on a smuggled rumor.
//
// The authenticated author (rumor.pubkey) then meets the TRUST MODEL — this
// inbox feeds a signing ceremony, so admission is fail-closed on three gates:
//   1. namespace   — scope_name must start 'draft:' (other grants are invisible here)
//   2. provenance  — author must equal the scope publisher in the a-tag
//                    (a re-wrapped grant — real scope, forwarded by a third
//                    party — is REJECTED: drafts are only accepted first-hand)
//   3. allowlist   — author must be on the Director's agent allowlist
//                    (Settings; empty list = empty desk, deliberately)
//
// Scope dereference + decrypt below the grant layer is pure NIP-DA symmetric
// crypto (raw scope key as the NIP-44 conversation key) — vendored nipxx
// primitives, no signer needed there.

import { verifyEvent, getEventHash } from 'nostr-tools'
import { KIND_DATA_SET, KIND_GRANT, fetchScope, latestGrants } from './lib/nipxx.mjs'

const unb64 = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0))

/** nipxx.giftUnwrap, verbatim ceremony, signer-driven. Throws on any breach. */
export async function giftUnwrapWithSigner(signer, wrap) {
  const seal = JSON.parse(await signer.nip44Decrypt(wrap.pubkey, wrap.content))
  if (seal.kind !== 13 || !verifyEvent(seal)) throw new Error('bad seal')
  const rumor = JSON.parse(await signer.nip44Decrypt(seal.pubkey, seal.content))
  if (rumor.pubkey !== seal.pubkey) throw new Error('seal/rumor pubkey mismatch')
  return rumor
}

/**
 * Collect and unwrap all grants addressed to the signer's pubkey.
 * Mirrors nipxx.receiveGrants — same wire parsing, same field names, one
 * addition: `author`, the seal-verified rumor.pubkey, carried out for the
 * trust gates. Wraps that fail to unwrap (not ours, tampered, garbage) are
 * skipped silently — an attacker must not be able to jam the inbox.
 */
export async function receiveGrantsWithSigner(relay, signer) {
  const granteePub = await signer.getPublicKey()
  const wraps = await relay.query({ kinds: [1059], '#p': [granteePub] })
  const grants = []
  for (const wrap of wraps) {
    let rumor
    try { rumor = await giftUnwrapWithSigner(signer, wrap) } catch { continue }
    if (rumor.kind !== KIND_GRANT) continue
    try {
      const [, address, relayHint] = rumor.tags.find(t => t[0] === 'a')
      const [kind, publisher, scopeId] = address.split(':')
      if (Number(kind) !== KIND_DATA_SET) continue
      const { scope_key, scope_name } = JSON.parse(rumor.content)
      grants.push({
        author: rumor.pubkey,           // seal-verified — the trust anchor
        publisher, scopeId, scopeName: scope_name, relayHint,
        generation: Number(rumor.tags.find(t => t[0] === 'v')?.[1] ?? 0),
        scopeKey: unb64(scope_key),
        issuedAt: rumor.created_at,
      })
    } catch { continue }                // malformed grant rumor — inert
  }
  return grants
}

export const isDraftScope = (g) => typeof g.scopeName === 'string' && g.scopeName.startsWith('draft:')

/** The three admission gates, in order. Everything else is invisible. */
export function trustedDrafts(grants, allowlist) {
  const allow = new Set(allowlist)
  return grants
    .filter(isDraftScope)               // 1. namespace
    .filter(g => g.author === g.publisher)   // 2. no re-wraps
    .filter(g => allow.has(g.author))   // 3. Director's allowlist
}

/**
 * Tolerant draft-payload reader. Schema (every field optional):
 *   { text, image: { url, alt }, hashtags?, rationale, proposedBy, proposedAt }
 * Absent fields render as absent; a payload that cannot make a post at all
 * (no text AND no image URL) — or one whose shape lies — is MALFORMED: shown
 * inert, never assemblable. Only http(s) image URLs survive (this string goes
 * into a signed note verbatim).
 */
export function readDraftPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false }
  const str = (v) => typeof v === 'string' ? v : undefined
  const text = str(data.text)
  let image
  // `null` means "no image", exactly like an absent key — the scribe writes
  // `image: p.image || null` and a bare personal draft carries no card. Only a
  // PRESENT image object whose url is unusable is a lying shape.
  if (data.image !== undefined && data.image !== null) {
    const url = str(data.image?.url)
    let okUrl = false
    try { okUrl = !!url && /^https?:$/.test(new URL(url).protocol) } catch { okUrl = false }
    if (!okUrl) return { ok: false }
    image = { url, alt: str(data.image.alt) }
  }
  if (!text && !image) return { ok: false }
  const hashtags = Array.isArray(data.hashtags)
    ? data.hashtags.filter(t => typeof t === 'string').map(t => t.replace(/^#/, '').toLowerCase())
    : []
  return {
    ok: true,
    draft: {
      text: text ?? '', image, hashtags,
      rationale: str(data.rationale),
      proposedBy: str(data.proposedBy),
      proposedAt: Number.isFinite(data.proposedAt) ? data.proposedAt : undefined,
    },
  }
}

/**
 * The pen rule, desk half (#11; nact#44). A PEN proves itself — the grant's
 * seal-verified author IS the pen. A COORDINATOR is a courier: its payload
 * must carry `pen`, the draft JSON signed by an allowlisted pen, and the desk
 * renders FROM those attested bytes — WYSIWYS from the pen, not the courier.
 *
 * Returns { penned: { by, direct } , core } for a good draft, or
 * { unpenned: <reason> }. NOTE the P4 lesson (nact lib/channel-binding):
 * this nostr-tools verifyEvent checks the sig over the STORED id without
 * recomputing the hash — recompute and match, or a lone pen signature could
 * be reused under swapped content.
 */
export function pennedDraft(data, author, pens, deliverers) {
  if (!deliverers.includes(author)) {
    return { penned: { by: author, direct: true }, core: data }   // the author IS the pen
  }
  const pen = data?.pen
  if (!pen || typeof pen !== 'object' || typeof pen.sig !== 'string') {
    return { unpenned: 'the courier delivered words no pen signed' }
  }
  if (getEventHash(pen) !== pen.id) return { unpenned: 'pen attestation id does not match its content — signature reuse, refused' }
  if (!verifyEvent(pen)) return { unpenned: 'pen attestation signature does not verify' }
  if (!pens.includes(pen.pubkey)) return { unpenned: 'signed, but not by one of YOUR pens' }
  let core
  try { core = JSON.parse(pen.content) } catch { return { unpenned: 'pen attestation content is not a draft' } }
  return { penned: { by: pen.pubkey, direct: false }, core }
}

/**
 * The whole desk: unwrap → trust gates → newest generation per scope →
 * dereference each 30440 and decrypt with the raw scope key → the pen rule.
 * Returns [{ grant, status: 'ready'|'withdrawn'|'malformed'|'unpenned',
 * draft?, penned?, why? }] — 'withdrawn' is a rotated/superseded/vanished
 * scope (the agent took the draft back); 'malformed' is a payload that
 * decrypts but cannot post; 'unpenned' is a courier delivery whose words no
 * allowlisted pen signed — visible, accusatory, never signable.
 *
 * `cfg` is { agents, deliverers } (the two lists of #9); a plain array is
 * still accepted as { agents: list, deliverers: [] } for the tests' sake.
 */
export async function loadDrafts(relay, signer, cfg) {
  const pens = Array.isArray(cfg) ? cfg : (cfg?.agents || [])
  const deliverers = Array.isArray(cfg) ? [] : (cfg?.deliverers || [])
  const allowlist = [...new Set([...pens, ...deliverers])]
  const grants = latestGrants(trustedDrafts(await receiveGrantsWithSigner(relay, signer), allowlist))
  return Promise.all(grants.map(async (grant) => {
    const scope = await fetchScope(relay, grant)
    if (scope.status !== 'ok') return { grant, status: 'withdrawn' }
    const verdict = pennedDraft(scope.data, grant.author, pens, deliverers)
    if (verdict.unpenned) return { grant, status: 'unpenned', why: verdict.unpenned }
    const payload = readDraftPayload(verdict.core)
    if (!payload.ok) return { grant, status: 'malformed' }
    return { grant, status: 'ready', draft: payload.draft, penned: verdict.penned }
  }))
}
