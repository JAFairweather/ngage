// settings.mjs — the two per-device dials, both localStorage (config.mjs):
//
//   AGENT ALLOWLIST — the trust anchor. A draft reaches the desk only when its
//   grant's seal-verified author is on this list (drafts.mjs gate 3). Empty
//   list = empty desk: trust is granted here, explicitly, npub by npub —
//   never inferred from whatever arrives over the wire.
//
//   RELAYS — where sealed grants are read from and where approved notes are
//   published. Defaults are the fleet's public set.

import { nip19 } from 'nostr-tools'
import { DEFAULT_RELAYS, saveConfig, resetConfig } from './config.mjs'
import { $, esc, short, state, agentName, parsePub, setRelays, load } from './main.mjs'
import { loadSteering, saveAndPublishSteering, isSteeringEmpty, DEFAULT_STEERING } from './steering.mjs'

export function renderSettings() {
  const el = $('settings')
  const cfg = state.config
  el.innerHTML = `
    <div id="steering-panel"></div>

    <div class="panel">
      <span class="kicker">Trusted agents — the allowlist</span>
      <p class="note">Drafts appear on the desk only when the grant's
        <em>seal-verified author</em> is listed here. Re-wrapped or forwarded
        grants are rejected outright; unknown namespaces are invisible.
        An empty list means an empty desk — that is the safe direction.</p>
      ${cfg.agents.length ? cfg.agents.map((a, i) => `
        <div class="lrow">
          <span class="pname">${esc(agentName(a))}</span>
          <span class="grow">${esc(nip19.npubEncode(a))}</span>
          <button class="icon" data-del-agent="${i}" title="remove from allowlist">✕</button>
        </div>`).join('') : `<div class="lrow" style="color:var(--dim)">no agents trusted yet</div>`}
      <div class="row" style="margin-top:14px">
        <input id="agent-npub" placeholder="npub1… of your drafting agent" autocomplete="off" spellcheck="false">
        <button class="primary" id="agent-add">Trust</button>
      </div>
      <div class="jsonerr" id="agent-err"></div>
    </div>

    <div class="panel">
      <span class="kicker">Relays</span>
      <p class="note">Sealed drafts are read from — and your signed notes are
        published to — this set.</p>
      ${cfg.relays.map((r, i) => `
        <div class="lrow"><span class="grow">${esc(r)}</span>
          <button class="icon" data-del-relay="${i}" title="remove relay">✕</button></div>`).join('')}
      <div class="row" style="margin-top:14px">
        <input id="relay-url" placeholder="wss://…" autocomplete="off" spellcheck="false">
        <button class="primary" id="relay-add">Add</button>
        <button class="ghost" id="relay-reset" title="${esc(DEFAULT_RELAYS.join(' · '))}">Defaults</button>
      </div>
      <div class="jsonerr" id="relay-err"></div>
    </div>

    <div class="panel">
      <span class="kicker">What this desk never does</span>
      <p class="note" style="margin:0">It never sees your secret key — signatures come from your
        signer (extension or bunker). It never posts on its own — every note is
        assembled in the open (see “exact note to be signed” on each draft) and
        signed by your hand. And it never trusts a sender the wire claims:
        authorship is proven by the NIP-59 seal before a draft is even decrypted.</p>
    </div>`

  const apply = (mutate) => {
    const next = { ...state.config }
    mutate(next)
    state.config = saveConfig(next)
    setRelays(state.config.relays)
    renderSettings()
    load()
  }

  $('agent-add').onclick = () => {
    $('agent-err').textContent = ''
    try {
      const pk = parsePub($('agent-npub').value)
      if (state.config.agents.includes(pk)) { $('agent-err').textContent = 'already on the allowlist'; return }
      apply(c => { c.agents = [...c.agents, pk] })
    } catch { $('agent-err').textContent = 'expected npub1… or 64-char hex' }
  }
  $('agent-npub').onkeydown = (e) => { if (e.key === 'Enter') $('agent-add').onclick() }
  for (const b of el.querySelectorAll('[data-del-agent]')) b.onclick = () => {
    const pk = state.config.agents[Number(b.dataset.delAgent)]
    if (!confirm(`Remove ${short(pk)} from the allowlist?\n\nIts pending drafts disappear from the desk immediately.`)) return
    apply(c => { c.agents = c.agents.filter((_, i) => i !== Number(b.dataset.delAgent)) })
  }

  $('relay-add').onclick = () => {
    $('relay-err').textContent = ''
    const url = $('relay-url').value.trim()
    if (!/^wss?:\/\//.test(url)) { $('relay-err').textContent = 'expected a ws:// or wss:// URL'; return }
    apply(c => { c.relays = [...c.relays, url] })
  }
  $('relay-url').onkeydown = (e) => { if (e.key === 'Enter') $('relay-add').onclick() }
  for (const b of el.querySelectorAll('[data-del-relay]')) b.onclick = () =>
    apply(c => { c.relays = c.relays.filter((_, i) => i !== Number(b.dataset.delRelay)) })
  $('relay-reset').onclick = () => { state.config = resetConfig(); setRelays(state.config.relays); renderSettings(); load() }

  renderSteering()
}

// ── Steering: the outbound delegation. Fields the Director edits to tailor how
// the scribe drafts — published as a `steer:draft` scope and sealed to every
// trusted agent (drafts flow agent → Director; steering flows Director → agent).
//
// The list fields (lean into / avoid) are staged in `steerForm` and only reach
// the relays on Publish. Text fields write straight to `steerForm` so a list
// edit's re-render never drops an in-progress sentence. Loaded from the local
// cache (steering.mjs) so the panel opens showing what is already live.
let steerForm = null
const steerBusy = { on: false }

const captureSteerText = () => {
  if (!$('steer-voice')) return
  steerForm.voice = $('steer-voice').value
  steerForm.cadence = $('steer-cadence').value
  steerForm.graphics = $('steer-graphics').value
  steerForm.houseRules = $('steer-houseRules').value
}

function steerList(field, label) {
  const items = steerForm[field]
  return `
    <label class="steer-label">${esc(label)}</label>
    ${items.length ? `<div class="chips">${items.map((t, i) => `
      <span class="chip">${esc(t)}<button class="chip-x" data-steer-del="${field}:${i}" title="remove">✕</button></span>`).join('')}</div>` : ''}
    <div class="row">
      <input id="steer-${field}-input" placeholder="${esc('add a topic…')}" autocomplete="off" spellcheck="false">
      <button class="ghost" data-steer-add="${field}">Add</button>
    </div>`
}

export function renderSteering() {
  const host = $('steering-panel')
  if (!host) return
  const live = loadSteering()
  // Nothing steering the scribe yet → open on the derived defaults (the
  // Director's own voice, distilled from his published writing) so this is a
  // review-and-approve, not a blank page. A live steering grant always wins,
  // and nothing reaches the scribe until he presses Publish.
  if (!steerForm) steerForm = isSteeringEmpty(live.steering) ? { ...DEFAULT_STEERING } : { ...live.steering }
  const agents = state.config.agents
  const gen = live.generation

  host.innerHTML = `
    <div class="panel">
      <span class="kicker">Steering — how your scribe drafts for you</span>
      <p class="note">Your drafting instructions, delegated the same way drafts come
        back to you: a <em>steer:draft</em> grant, encrypted end to end and sealed to
        every trusted agent below. Edit freely and republish — each save rotates the
        grant, so the newest steering supersedes the last.
        ${gen ? `<span class="steer-live">live · generation ${gen}</span>` : `<span class="steer-live dim">not yet published</span>`}</p>

      <label class="steer-label">Voice &amp; register</label>
      <textarea id="steer-voice" rows="2" placeholder="e.g. plain, first person, dry wit; no hype, no emoji spam">${esc(steerForm.voice)}</textarea>

      ${steerList('leanInto', 'Lean into')}
      ${steerList('avoid', 'Avoid')}

      <label class="steer-label">Cadence &amp; volume</label>
      <textarea id="steer-cadence" rows="2" placeholder="e.g. at most 2 a day; skip days with nothing worth saying">${esc(steerForm.cadence)}</textarea>

      <label class="steer-label">Graphics preference <span class="dim">(a card-selection hint)</span></label>
      <textarea id="steer-graphics" rows="2" placeholder="e.g. prefer the letterpress cards; bare posts for personal notes">${esc(steerForm.graphics)}</textarea>

      <label class="steer-label">House rules</label>
      <textarea id="steer-houseRules" rows="3" placeholder="e.g. never tag #nostr; a nave.pub link only when the post is about the Nave">${esc(steerForm.houseRules)}</textarea>

      <div class="row" style="margin-top:16px; align-items:center">
        <button class="primary" id="steer-publish" ${agents.length ? '' : 'disabled'}>Publish steering</button>
        <span class="steer-msg" id="steer-msg">${agents.length
          ? `sealed to ${agents.length} trusted agent${agents.length === 1 ? '' : 's'} on save`
          : 'add a trusted agent below first — steering needs a recipient'}</span>
      </div>
      <div class="jsonerr" id="steer-err"></div>
    </div>`

  // text → steerForm on every keystroke, so a chip add/remove re-render keeps it
  for (const id of ['steer-voice', 'steer-cadence', 'steer-graphics', 'steer-houseRules'])
    $(id).oninput = () => captureSteerText()

  for (const b of host.querySelectorAll('[data-steer-add]')) {
    const field = b.dataset.steerAdd
    const add = () => {
      const input = $(`steer-${field}-input`)
      const val = input.value.trim()
      if (!val) return
      captureSteerText()
      if (!steerForm[field].includes(val)) steerForm[field] = [...steerForm[field], val]
      renderSteering()
    }
    b.onclick = add
    $(`steer-${field}-input`).onkeydown = (e) => { if (e.key === 'Enter') add() }
  }
  for (const b of host.querySelectorAll('[data-steer-del]')) b.onclick = () => {
    const [field, i] = b.dataset.steerDel.split(':')
    captureSteerText()
    steerForm[field] = steerForm[field].filter((_, j) => j !== Number(i))
    renderSteering()
  }

  $('steer-publish').onclick = async () => {
    captureSteerText()
    $('steer-err').textContent = ''
    if (!state.signer || !state.relay) { $('steer-err').textContent = 'sign in first'; return }
    if (!state.config.agents.length) { $('steer-err').textContent = 'no trusted agent to steer — add one below'; return }
    if (isSteeringEmpty(steerForm)) { $('steer-err').textContent = 'nothing to publish — fill in at least one field'; return }
    if (steerBusy.on) return
    steerBusy.on = true
    const btn = $('steer-publish'), msg = $('steer-msg')
    btn.disabled = true
    msg.textContent = 'sealing to your agents and publishing to the relays…'
    msg.className = 'steer-msg'
    try {
      const { record, result } = await saveAndPublishSteering(
        state.relay, state.signer, state.config.agents, steerForm)
      const acks = result.scope.acks ?? 0
      renderSteering()   // reflect the new generation, then message the fresh node
      const m = $('steer-msg')
      if (m) {
        m.textContent = `published — generation ${record.generation}, sealed to ${result.grants.length} agent${result.grants.length === 1 ? '' : 's'} (${acks} relay${acks === 1 ? '' : 's'})`
        m.className = 'steer-msg ok'
      }
    } catch (err) {
      msg.textContent = ''
      $('steer-err').textContent = `publish failed: ${err.message}`
    } finally { steerBusy.on = false; if ($('steer-publish')) $('steer-publish').disabled = false }
  }
}
