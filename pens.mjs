// pens.mjs — who may write in your name.
//
// This roster lived inside Settings, which framed the most consequential question this desk answers —
// "whose words may reach my signer" — as a preference. It is not a preference: an entry here is
// standing admission for another key's drafts to be rendered for your signature, and the safe direction
// is an empty list.
//
// Two roles, and the distinction is enforced by construction rather than by policy: a PEN is a drafting
// hand whose signature the desk verifies and which receives your steering; a COORDINATOR may only put
// another identity's draft on the desk and NEVER receives steering — publishing steering seals to the
// pens alone. Both are shown here because "who can reach my signer" is one question with two answers,
// and splitting them across screens is how you end up believing a coordinator is steered.
//
// The panels are moved verbatim: this is an IA change, not a rewrite. Same markup, same handlers, same
// ids — so the wiring in wirePens() is the same wiring Settings had, and nothing about admission
// changed in a commit whose purpose was to move it.

import { nip19 } from 'nostr-tools'
import { $, esc, state, agentName, short } from './main.mjs'
import { wireRosters } from './settings.mjs'
import { saveConfig } from './config.mjs'
import { setRelays, load } from './main.mjs'

export function renderPens() {
  const cfg = state.config
  const el = $('pens')
  el.innerHTML = `
    <div class="note" style="margin:0 0 14px">Everyone whose drafts this desk will render for your
      signature. A pen's words are shown to you only after the desk verifies the pen signed them; a
      coordinator may deliver another identity's draft but is never steered. <b>Nothing here can post</b> —
      only your own hand does that.</div>
    <div class="panel">
      <span class="kicker">Trusted agents — the pens</span>
      <p class="note">Your drafting hands. Drafts appear on the desk only when the
        grant's <em>seal-verified author</em> is listed here or under Coordinators —
        re-wrapped or forwarded grants are rejected outright; unknown namespaces are
        invisible. Pens are also <b>the only recipients of your steering</b>.
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
      <span class="kicker">Coordinators — delivery only, never steered</span>
      <p class="note">Delivery runtimes that may put drafts on your desk on behalf
        of identities whose keys they don't hold — the Nactor raising a
        director-path draft, for example. Same admission gates as a pen, but a
        coordinator <b>never receives your steering</b>: publishing steering seals
        it to the pens above and to no one else, by construction. A pubkey can hold
        one role — listing a pen here has no effect.</p>
      ${cfg.deliverers.length ? cfg.deliverers.map((a, i) => `
        <div class="lrow">
          <span class="pname">${esc(agentName(a))}</span>
          <span class="grow">${esc(nip19.npubEncode(a))}</span>
          <button class="icon" data-del-deliverer="${i}" title="remove coordinator">✕</button>
        </div>`).join('') : `<div class="lrow" style="color:var(--dim)">no coordinators — box-raised drafts are not admitted</div>`}
      <div class="row" style="margin-top:14px">
        <input id="deliverer-npub" placeholder="npub1… of a delivery runtime (e.g. the Nactor)" autocomplete="off" spellcheck="false">
        <button class="primary" id="deliverer-add">Add coordinator</button>
      </div>
      <div class="jsonerr" id="deliverer-err"></div>`
  // Pens owns its own re-render: a removal here must refresh THIS pane. Passing Settings' apply would
  // redraw a hidden pane and leave the visible roster showing a key that is no longer admitted — which
  // is the worst possible staleness on an admission screen.
  wireRosters(el, (mutate) => {
    const next = { ...state.config }
    mutate(next)
    state.config = saveConfig(next)
    setRelays(state.config.relays)
    renderPens()
    load()
  })
}
