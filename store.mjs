// store.mjs — the local consumption ledger. A draft, once posted or passed,
// must not resurface as pending: entries are keyed by the scope's FULL
// identity — publisher : scopeId # generation — so an agent that rotates the
// scope (a genuinely new draft under the same id) surfaces fresh, while the
// same generation stays consumed forever on this device.
//
// localStorage only — this is per-device judgment, not protocol state. The
// agent learns consumption the nostr-native way: it watches the Director's
// published kind-1s (issue nvoy#14). Records carry enough presentation data
// (name, author, note id) to render the history section standalone, even
// after the grant events themselves have been superseded or expired.

export const STORE_KEY = 'ngage-consumed'

export const draftKey = (g) => `${g.publisher}:${g.scopeId}#${g.generation}`

const read = (storage) => {
  try { return JSON.parse(storage?.getItem(STORE_KEY)) ?? {} } catch { return {} }
}
const write = (storage, map) => storage?.setItem(STORE_KEY, JSON.stringify(map))

/** All consumption records: key → { state: 'posted'|'passed', … }. */
export function loadStore(storage = globalThis.localStorage) {
  const raw = read(storage)
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
}

/** Record a publish: the note id + relay ack count, for the history section. */
export function markPosted(g, { noteId, acks, of }, storage = globalThis.localStorage) {
  const map = loadStore(storage)
  map[draftKey(g)] = {
    state: 'posted', noteId, acks, of,
    name: g.scopeName, author: g.author, at: Math.floor(Date.now() / 1000),
  }
  write(storage, map)
  return map
}

/** Record a pass — a local-only dismissal; nothing was published or revoked. */
export function markPassed(g, storage = globalThis.localStorage) {
  const map = loadStore(storage)
  map[draftKey(g)] = {
    state: 'passed',
    name: g.scopeName, author: g.author, at: Math.floor(Date.now() / 1000),
  }
  write(storage, map)
  return map
}

export const recordFor = (map, g) => map[draftKey(g)] ?? null
