// config.mjs — per-device settings (the nvoy console config.mjs pattern).
// Stored in localStorage (non-secret — endpoints and PUBLIC keys, never key
// material): the relay set drafts are read from / posts are published to, and
// the AGENT ALLOWLIST — the trust anchor of the whole app. Only grants whose
// seal-verified author is on this list ever reach the Director's eyes.
//
// DOM-free: storage is injectable so Node tests exercise the sanitize path.

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
export const CONFIG_KEY = 'ngage-config'

// Two trust lists, two roles (#9):
//   agents     — the PENS: drafting hands. Their drafts are admitted AND they
//                receive the Director's steering grants.
//   deliverers — the COORDINATORS: delivery runtimes (e.g. the Nactor raising
//                drafts for keyless identities). Their drafts are admitted;
//                they NEVER receive steering — by construction, not curation.
export const defaultConfig = () => ({ relays: [...DEFAULT_RELAYS], agents: [], deliverers: [] })

const validRelay = (u) => { try { return /^wss?:$/.test(new URL(u).protocol) } catch { return false } }
const strip = (u) => u.trim().replace(/\/+$/, '')
const validPub = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)

const pubList = (v) => [...new Set((Array.isArray(v) ? v : [])
  .filter(a => typeof a === 'string').map(a => a.trim().toLowerCase()).filter(validPub))]

/** Coerce anything into a usable config. Broken relay lists fall back to the
 *  defaults (a broken config must never brick the desk); a broken agent list
 *  falls back to EMPTY — fail closed, never open, on the trust anchor. */
export function sanitizeConfig(raw) {
  const cfg = defaultConfig()
  const relays = [...new Set((Array.isArray(raw?.relays) ? raw.relays : [])
    .filter(r => typeof r === 'string').map(strip).filter(validRelay))]
  if (relays.length) cfg.relays = relays
  cfg.agents = pubList(raw?.agents)
  // A pubkey can hold ONE role. If a stale config lists it in both, the pen
  // role wins visibly below — but steering exposure must never be silent, so
  // dedupe here: a deliverer that is already a pen is dropped from deliverers.
  cfg.deliverers = pubList(raw?.deliverers).filter(d => !cfg.agents.includes(d))
  return cfg
}

/** Desk admission = pens ∪ coordinators. Steering NEVER uses this — it seals
 *  to cfg.agents alone (settings.mjs). */
export const admissionList = (cfg) => [...new Set([...(cfg?.agents || []), ...(cfg?.deliverers || [])])]

export function loadConfig(storage = globalThis.localStorage) {
  try { return sanitizeConfig(JSON.parse(storage?.getItem(CONFIG_KEY))) }
  catch { return defaultConfig() }
}

export function saveConfig(cfg, storage = globalThis.localStorage) {
  const clean = sanitizeConfig(cfg)
  storage?.setItem(CONFIG_KEY, JSON.stringify(clean))
  return clean
}

export function resetConfig(storage = globalThis.localStorage) {
  storage?.removeItem(CONFIG_KEY)
  return defaultConfig()
}
