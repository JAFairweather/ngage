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
