// main.mjs — Ngage shell: sign-in via nave-connect (Alby/NIP-07 extension or
// NIP-46 bunker as the front door; the local key stays a gated advanced path),
// tabs, shared state. The desk itself lives in inbox.mjs (review + post) and
// settings.mjs (agent allowlist + relays); drafts.mjs is the trust/crypto
// pipeline; assemble.mjs the kind-1 wire format.
//
// Sovereignty invariant, enforced by construction: this file wires a SIGNER
// into the app — never key material. The only place a raw key exists is the
// explicitly-advanced local path, in this tab, for demos and recovery.

import { generateSecretKey, nip19 } from 'nostr-tools'
import { LiveRelay } from './lib/liverelay.mjs'
import { localSigner, nip07Signer, nip46Signer, serializeSession, parseSession, signerFromSession } from './lib/nave-connect.mjs'
import { renderTitlebar, updateTitlebar } from './lib/nave-titlebar.mjs'
import { loadConfig, admissionList } from './config.mjs'
import { loadDrafts } from './drafts.mjs'
import { loadStore, recordFor } from './store.mjs'
import { renderDrafts } from './inbox.mjs'
import { renderSettings } from './settings.mjs'
import { renderPens } from './pens.mjs'

export const $ = (id) => document.getElementById(id)
export const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const short = (pk) => { const n = nip19.npubEncode(pk); return n.slice(0, 12) + '…' + n.slice(-4) }
export const fmtWhen = (sec) => new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')

export const state = {
  config: loadConfig(),
  relay: null, signer: null, me: null,
  drafts: [],                 // [{ grant, status, draft? }] from drafts.loadDrafts
  store: {},                  // local consumption ledger (store.mjs)
  profiles: new Map(),        // agent pubkey → kind-0 metadata (presentation only)
}

export const agentName = (pk) =>
  state.profiles.get(pk)?.display_name || state.profiles.get(pk)?.name || short(pk)

function parseKey(input) {
  const s = input.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return Uint8Array.from(s.match(/../g), h => parseInt(h, 16))
  const { type, data } = nip19.decode(s)
  if (type !== 'nsec') throw new Error('not an nsec')
  return data
}

/** Accept npub1… or 64-char hex; return hex pubkey. */
export function parsePub(input) {
  const s = input.trim()
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase()
  const { type, data } = nip19.decode(s)
  if (type !== 'npub') throw new Error('not an npub')
  return data
}

const TABS = { drafts: renderDrafts, pens: renderPens, settings: renderSettings }
let current = 'drafts'
export function showTab(t) {
  current = t
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === t)
  for (const id of Object.keys(TABS)) $(id).style.display = t === id ? '' : 'none'
  TABS[t]()
  location.hash = t
}
for (const b of document.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab)
export const rerender = () => TABS[current]()

/**
 * `#draft/<scopeId>` — the deep link Nact emits, and had nowhere to land.
 *
 * Nact's Queue shows the director-path drafts it raised and cannot sign, with `Open on your Ngage
 * desk ↗` pointing here. Until this existed the link resolved to the desk root: the reader arrived
 * somewhere plausible and had to find the card themselves, which is the failure mode a deep link is
 * for. Worse, with several drafts open it is not obvious they landed on the wrong one.
 *
 * A scope id is opaque, so it is compared as an exact string and never parsed. An unknown id is
 * REPORTED, not silently ignored: the likeliest cause is that the draft was already posted or
 * withdrawn, and "your link is stale" is a different message from showing an unremarkable desk.
 */
export const draftFromHash = () => {
  const seg = (location.hash || '').replace(/^#/, '').split('/')
  return seg[0] === 'draft' && seg[1] ? decodeURIComponent(seg[1]) : null
}

/** Focus one draft card: land on the desk, scroll it in, ring it. Reports a miss rather than hiding it. */
export function focusDraft(scopeId, { found } = {}) {
  showTab('drafts')
  // Restore the deep link showTab() just overwrote, so a reload lands in the same place and the URL
  // still describes what is on screen.
  try { location.hash = `draft/${encodeURIComponent(scopeId)}` } catch {}
  const el = document.querySelector(`[data-scope="${CSS.escape(scopeId)}"]`)
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('deep-focus')
    setTimeout(() => el.classList.remove('deep-focus'), 2600)
    return true
  }
  if (found === false || !el) {
    const note = $('deep-miss')
    if (note) {
      note.textContent = `That link points at a draft this desk cannot show (${scopeId.slice(0, 12)}…). `
        + 'It was most likely already posted or withdrawn — the desk below is everything currently offered.'
      note.style.display = ''
    }
  }
  return false
}

/** Swap the relay set live (Settings). */
export function setRelays(urls) {
  try { state.relay?.close() } catch { /* best effort */ }
  state.relay = new LiveRelay(urls)
}

export async function login(signer, remember) {
  state.signer = signer
  try { state.me = await signer.getPublicKey() }   // nip46: first use → lazy bunker connect
  catch (err) {
    state.signer = null
    try { await signer.close?.() } catch { /* best effort */ }
    $('err').textContent = `sign-in failed: ${err.message}`
    return
  }
  if (remember) sessionStorage.setItem('ngage-login', remember)
  state.relay ??= new LiveRelay(state.config.relays)
  $('login').style.display = 'none'
  $('tabs').style.display = 'flex'
  updateTitlebar('#titlebar', {
    npub: nip19.npubEncode(state.me), kind: signer.kind,
    onRefresh: () => load(), onLogout: logout,
  })
  // A `#draft/<id>` hash is a DESK link, not a tab name, so it must resolve to the desk rather than
  // falling through to the default and discarding the id. renderDrafts() then lands it.
  const hash = location.hash.slice(1)
  showTab(draftFromHash() ? 'drafts' : (Object.keys(TABS).includes(hash) ? hash : 'drafts'))
  load()
}

/** Reload the desk: unwrap grants through the signer, apply the trust gates,
 *  dereference each draft scope, refresh the local ledger + agent profiles. */
export async function load() {
  const { relay, signer, config } = state
  $('status').textContent = 'reading your sealed drafts from the relays…'
  try {
    state.store = loadStore()
    // Desk admission = pens ∪ coordinators (#9). Steering never uses this
    // union — it seals to config.agents alone (settings.mjs).
    const admitted = admissionList(config)
    state.drafts = await loadDrafts(relay, signer, config)   // {agents, deliverers} — the pen rule needs both lists (#11)

    // kind-0 profiles for admitted senders — presentation only
    state.profiles = new Map()
    if (admitted.length) {
      for (const ev of await relay.query({ kinds: [0], authors: admitted, limit: admitted.length * 3 })) {
        if (!state.profiles.has(ev.pubkey)) {
          try { state.profiles.set(ev.pubkey, JSON.parse(ev.content)) } catch { /* skip */ }
        }
      }
    }

    const pending = state.drafts.filter(d =>
      d.status === 'ready' && !recordFor(state.store, d.grant)).length
    $('status').textContent = admitted.length
      ? `${config.agents.length} pen${config.agents.length === 1 ? '' : 's'}` +
        `${config.deliverers.length ? ` + ${config.deliverers.length} coordinator${config.deliverers.length === 1 ? '' : 's'}` : ''} · ` +
        `${pending} draft${pending === 1 ? '' : 's'} awaiting your hand. ` +
        `Only seal-verified, first-hand grants from your lists are shown.`
      : 'No trusted agents configured — the desk shows nothing until you allowlist your agent in Settings.'
    rerender()
  } catch (err) { $('status').textContent = `relay error: ${err.message}` }
}

// nave-connect's localSigner (ngage-extended: nip44-capable) is the whole
// local path — no separate key store, nothing persisted beyond the tab session.
const hexOf = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

// NIP-46: the bunker may want a one-time interactive approval — surface its
// auth_url as a link rather than window.open (popup blockers eat those).
function onAuthUrl(url) {
  $('bunker-auth').style.display = ''
  $('bunker-auth').innerHTML = `The bunker asks for a one-time approval:
    <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">open its dashboard</a>,
    approve, then return here.`
}

$('bunker-go').onclick = async () => {
  const uri = $('bunker-uri').value.trim()
  if (!uri) { $('err').textContent = 'Paste the bunker:// URI from your remote signer first.'; return }
  $('err').textContent = 'connecting to the bunker over its relays… (approve there if asked)'
  $('bunker-go').disabled = true
  try {
    const signer = nip46Signer(uri, { onAuthUrl })
    await login(signer, serializeSession('nip46', { uri, clientSecretHex: signer.clientSecretHex }))
    if (state.me) { $('err').textContent = ''; $('bunker-auth').style.display = 'none' }
  } finally { $('bunker-go').disabled = false }
}
$('bunker-uri').onkeydown = (e) => { if (e.key === 'Enter') $('bunker-go').onclick() }

// The local key is deliberately not a headline option: available, behind
// this explicit reveal, for demos and recovery.
$('advanced-toggle').onclick = () => {
  const open = $('advanced').style.display === 'none'
  $('advanced').style.display = open ? '' : 'none'
  $('advanced-toggle').textContent = open
    ? 'Hide the local-key option'
    : 'Advanced: use a local key in this tab (demo / recovery)'
  if (open) $('nsec').focus()
}

$('go').onclick = () => {
  try { const k = parseKey($('nsec').value); login(localSigner(k), hexOf(k)) }
  catch { $('err').textContent = 'Expected nsec1… or 64 hex chars.' }
}
$('nsec').onkeydown = (e) => { if (e.key === 'Enter') $('go').onclick() }
$('gen').onclick = () => {
  // The key is shown in-page (selectable, with a Copy button) — an alert()
  // can't be copied, and this key is the only way back in.
  const k = generateSecretKey()
  $('err').textContent = ''
  $('newkey').style.display = ''
  $('newkey-nsec').textContent = nip19.nsecEncode(k)
  $('newkey-copy').onclick = async () => {
    await navigator.clipboard.writeText(nip19.nsecEncode(k))
    $('newkey-copy').textContent = 'Copied ✓'
    setTimeout(() => { $('newkey-copy').textContent = 'Copy' }, 2000)
  }
  $('newkey-continue').onclick = () => login(localSigner(k), hexOf(k))
}
$('nip07').onclick = () => {
  if (!window.nostr?.nip44) { $('err').textContent = 'No NIP-07 extension found (needs nip44 support — Alby or nos2x).'; return }
  login(nip07Signer(), 'nip07')
}
function logout() {
  try { state.signer?.close?.() } catch { /* best effort */ }   // drop a live bunker pairing
  sessionStorage.removeItem('ngage-login'); location.hash = ''; location.reload()
}

// The unified Nave title bar: boots signed out (brand only — the login card
// in <main> is the sign-in affordance); login() flips it via updateTitlebar.
const NGAGE_SEAL = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="#0b0906" stroke="#c39a56" stroke-opacity=".5" stroke-width="1.2"/>
  <g transform="translate(4 4)" fill="none" stroke="#c39a56" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3 C8.5 5.5 7 9 7.5 12.5 L12 21 L16.5 12.5 C17 9 15.5 5.5 12 3 Z"/>
    <path d="M12 20 V13"/>
    <circle cx="12" cy="11" r="1.4" fill="#c39a56" stroke="none"/>
  </g>
</svg>`
renderTitlebar('#titlebar', { appName: 'Ngage', tagline: 'the posting desk', sealSvg: NGAGE_SEAL })

// --- stale-tab guard --------------------------------------------------------
// The real cache class isn't the headers (every module is served no-cache) —
// it's a tab left OPEN across a deploy: its in-memory modules are the old code,
// and an action (e.g. Publish steering) silently runs the stale build. A hard
// refresh fixes it, but you have to KNOW to. This watches the served bundle's
// ETag and, when a newer one deploys, shows a one-click reload banner — so a
// stale tab announces itself instead of quietly doing the wrong thing.
;(function watchForUpdate() {
  const probe = () => fetch('./main.mjs', { method: 'HEAD', cache: 'no-store' })
    .then(r => r.headers.get('etag') || r.headers.get('last-modified')).catch(() => null)
  probe().then(loaded => {
    if (!loaded) return
    let shown = false
    const check = async () => {
      if (shown || document.hidden) return
      const now = await probe()
      if (now && now !== loaded) {
        shown = true
        const bar = document.createElement('div')
        bar.setAttribute('role', 'status')
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:center;padding:10px 14px;background:var(--accent,#c39a56);color:#12100a;font:600 13px/1.3 system-ui,sans-serif'
        bar.textContent = 'A newer Ngage has been deployed — reload so your actions use the latest build. '
        const btn = document.createElement('button')
        btn.textContent = 'Reload now'
        btn.style.cssText = 'padding:5px 12px;border:1px solid #12100a;border-radius:6px;background:#12100a;color:var(--accent,#c39a56);cursor:pointer;font:inherit'
        btn.onclick = () => location.reload()
        bar.appendChild(btn)
        document.body.appendChild(bar)
      }
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    setInterval(check, 5 * 60 * 1000)   // also poll, for a tab that never blurs
  })
})()

// Boot order: any tab-session sign-in first (nave-connect parses all three
// kinds — a bare-hex remember reads as `local`), else the login screen.
const saved = sessionStorage.getItem('ngage-login')
const sess = parseSession(saved)
if (sess?.kind === 'nip07') setTimeout(() => { if (window.nostr?.nip44) login(nip07Signer(), 'nip07') }, 250)
else if (sess?.kind === 'nip46') login(signerFromSession(sess, { onAuthUrl }), saved)
else if (sess?.kind === 'local') login(localSigner(parseKey(sess.hexKey)), saved)
