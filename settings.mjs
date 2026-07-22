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

export function renderSettings() {
  const el = $('settings')
  const cfg = state.config
  el.innerHTML = `
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
}
