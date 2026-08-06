// nvoy-index.mjs — record Ngage's steering grant into the Director's Grant
// Index, so **Nvoy is the single source of truth for ALL grants** (Director's
// standing rule, 2026-07-23). Ngage used to publish the steering scope + wraps
// to the relays and stop; the grant was real but invisible in the grant
// console. This writes it into the same kind-10440 index Nvoy reads, so it
// appears on the grantee's agent card and in the Ledger like any delegation.
//
// The ledger-event SHAPES here mirror nvoy/console/ledgerlog.mjs — that file is
// the canonical definition; if it changes, mirror it. (They are tiny and
// stable; a cross-repo import isn't available at runtime, so they're inlined,
// and ngage's test asserts Ngage's output against Nvoy's REAL deriveDelegations
// to catch drift.)
//
// Concurrency: this loads the index fresh immediately before writing, so it
// merges with (does not clobber) Nvoy's other grants. If Nvoy writes in the
// sub-second window between this load and save, last-writer-wins — acceptable
// for a single Director with two of his own apps; the real fix is the P3
// mergeable index. We never touch entries for other scopes.

import { loadGrantIndex, saveGrantIndex, toIssuedEntry } from './lib/nipxx.mjs'

const nowSec = () => Math.floor(Date.now() / 1000)
const LEDGER_CAP = 500

// --- ledger-event constructors (shapes mirror nvoy/console/ledgerlog.mjs) ---
export const grantedEvent = ({ scope, agent, v, terms = null, name, at = nowSec() }) =>
  ({ t: 'granted', at, scope, agent, v, terms, name })
export const revokedEvent = ({ scope, agent, v, reason = null, notice = false, at = nowSec() }) =>
  ({ t: 'revoked', at, scope, agent, v, reason, notice: !!notice })
const ledgerOf = (index) => index.nvoy_ledger ?? []
const appendLedger = (index, event) => {
  const log = [...ledgerOf(index), event]
  return log.length > LEDGER_CAP ? log.slice(log.length - LEDGER_CAP) : log
}

/**
 * Merge a steering grant into the Director's Grant Index and re-publish it.
 * Idempotent per (scopeId, grantees): re-saving the same steering just bumps
 * the issued entry's generation/key; adding/dropping a trusted agent appends a
 * granted/revoked ledger event so the history is honest.
 *
 * @param relay   the LiveRelay
 * @param signer  the Director's signer (self-encrypts the index)
 * @param grant   { scopeId, scopeName, generation, scopeKey, grantees: hex[] }
 * @returns { added, dropped, total }  — for the caller to report
 */
export async function recordSteeringInIndex(relay, signer, { scopeId, scopeName, generation, scopeKey, grantees }) {
  const index = await loadGrantIndex(relay, signer)   // fresh — merge, don't clobber
  index.issued = index.issued ?? []
  index.nvoy_agents = index.nvoy_agents ?? []

  const prior = index.issued.find(e => e.scope === scopeId)
  const priorGrantees = prior?.grantees ?? []
  const now = new Set(grantees)
  const before = new Set(priorGrantees)

  // Upsert the single steering entry — never duplicate, never touch others.
  index.issued = index.issued.filter(e => e.scope !== scopeId)
    .concat(toIssuedEntry({ scopeId, scopeName, generation, scopeKey }, grantees))

  // Audit: newly-granted agents get a `granted` event; dropped agents (a
  // rotation cut them off) get a `revoked` event.
  for (const agent of grantees) if (!before.has(agent))
    index.nvoy_ledger = appendLedger(index, grantedEvent({ scope: scopeId, agent, v: generation, name: scopeName }))
  for (const agent of priorGrantees) if (!now.has(agent))
    index.nvoy_ledger = appendLedger(index, revokedEvent({ scope: scopeId, agent, v: generation, reason: 'dropped from steering' }))

  // Registry: a trusted agent must appear in nvoy_agents to render its card.
  const known = new Set(index.nvoy_agents.map(a => a.pub))
  for (const agent of grantees) if (!known.has(agent))
    index.nvoy_agents.push({ pub: agent, added_at: nowSec() })

  await saveGrantIndex(relay, signer, index)
  const added = grantees.filter(a => !before.has(a)).length
  const dropped = priorGrantees.filter(a => !now.has(a)).length
  return { added, dropped, total: grantees.length }
}

// --- the INBOUND direction (Wave 4) ----------------------------------------
export const consumedEvent = ({ scope, publisher, name, outcome, noteId = null, at = nowSec() }) =>
  ({ t: 'consumed', at, scope, publisher, name: name ?? null, outcome, noteId })

/**
 * Record that the Director acted on a draft an agent granted TO him.
 *
 * Until now this landed in `localStorage['ngage-consumed']` and nowhere else, so half of what this desk
 * did was invisible in the console that is meant to be the source of truth for ALL grants — invisible by
 * construction, which is the same class of defect as the agent that showed in Nvoy and not in Nact.
 *
 * WHY THIS IS NOT AN `issued` ENTRY. `index.issued` is what the Director granted. This grant came the
 * other way. Adding it there would invert the direction of authority in the audit log to save defining a
 * word, and a reader would reasonably conclude he had delegated something. Nvoy's `receivedActions()`
 * reads these separately for exactly that reason.
 *
 * The local ledger stays: it is the desk's own idempotence key (`draftKey`), it works offline, and it
 * must not depend on a relay write succeeding. This ADDS the mirror; it does not move the record.
 *
 * @param outcome 'posted' | 'passed'
 * @returns { mirrored: true } | { mirrored: false, why }  — the caller shows the pill either way
 */
export async function recordConsumptionInIndex(relay, signer, { scopeId, scopeName, publisher, outcome, noteId = null }) {
  if (outcome !== 'posted' && outcome !== 'passed') return { mirrored: false, why: `unknown outcome ${outcome}` }
  try {
    const index = await loadGrantIndex(relay, signer)   // fresh — merge, don't clobber
    // Idempotent per (scope, outcome): re-posting the same draft twice is not two consumptions, and a
    // retry after a failed relay write must not double-record.
    const already = (index.nvoy_ledger ?? []).some(e =>
      e?.t === 'consumed' && e.scope === scopeId && e.outcome === outcome)
    if (already) return { mirrored: true, already: true }
    index.nvoy_ledger = appendLedger(index, consumedEvent({
      scope: scopeId, publisher, name: scopeName, outcome, noteId,
    }))
    await saveGrantIndex(relay, signer, index)
    return { mirrored: true }
  } catch (err) {
    // REPORTED, never swallowed. The post already happened — the Director signed it — so failing here
    // means the note is real and the record is not. Saying so is what the retry pill is for.
    return { mirrored: false, why: err?.message || String(err) }
  }
}
