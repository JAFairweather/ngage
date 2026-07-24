// inbox.mjs — the desk: pending drafts rendered exactly as a nostr client will
// show the finished note (text, media card, hashtags), each carrying the
// agent's rationale and provenance, and two verbs:
//
//   Post in my hand ✍  — assemble the kind-1 (assemble.mjs), hand it to the
//                        Director's SIGNER, publish the signed event to the
//                        configured relays, record the note id locally.
//   Pass               — a local-only dismissal. Nothing publishes, nothing
//                        is revoked; the agent simply never sees a note appear.
//
// Withdrawn (rotated/vanished) scopes and malformed payloads render inert —
// visible, honest, unpostable. Consumed and passed drafts collapse into the
// history section at the bottom.

import { nip19 } from 'nostr-tools'
import { buildDraftEvent, composeContent, extractHashtags } from './assemble.mjs'
import { draftKey, markPassed, markPosted, recordFor } from './store.mjs'
import { $, esc, short, fmtWhen, state, agentName, rerender, showTab } from './main.mjs'

const AVA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3 C8.5 5.5 7 9 7.5 12.5 L12 21 L16.5 12.5 C17 9 15.5 5.5 12 3 Z"/>
  <path d="M12 20 V13"/><circle cx="12" cy="11" r="1.3" fill="currentColor" stroke="none"/></svg>`

// Escape first, then decorate — the highlighter runs over HTML-safe text only.
const highlight = (text) =>
  esc(text).replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, (_, pre, tag) => `${pre}<span class="htag">#${tag}</span>`)

const postPreview = (draft) => `
  <div class="post">
    <div class="who">
      <span class="ava">${AVA}</span>
      <div><div class="name">You</div>
        <div class="sub">${esc(short(state.me))} · just now</div></div>
    </div>
    <div class="body">${highlight(draft.text)}</div>
    ${draft.image ? `<img class="media" src="${esc(draft.image.url)}" alt="${esc(draft.image.alt ?? '')}"
        loading="lazy" referrerpolicy="no-referrer">
      ${draft.image.alt ? `<div class="alt">alt: ${esc(draft.image.alt)}</div>` : ''}` : ''}
  </div>`

const provenance = (g, draft) => {
  const when = draft?.proposedAt ?? g.issuedAt
  const by = draft?.proposedBy ? `${esc(draft.proposedBy)} — ` : ''
  return `drafted by ${by}${esc(agentName(g.author))} (${esc(short(g.author))}) · ${fmtWhen(when)} UTC
    · scope <b>${esc(g.scopeName)}</b> · gen ${g.generation}`
}

// The exact bytes the signer will be asked to sign — sovereignty means the
// Director can always lift the hood before the pen touches paper.
const exactNote = (draft) => {
  const ev = buildDraftEvent(draft, 0)
  return `<details><summary class="prov" style="cursor:pointer">exact note to be signed</summary>
    <pre class="phrase" style="white-space:pre-wrap;font-size:11.5px">content:
${esc(ev.content)}

tags: ${esc(JSON.stringify(ev.tags))}</pre></details>`
}

// The pen frame (#11): the identity that CRYPTOGRAPHICALLY drafted this wraps
// the card — avatar + name + how the proof holds. A pen-direct draft is proven
// by the seal (the author IS the pen); a courier delivery is proven by the
// embedded attestation the desk itself just verified (drafts.mjs pennedDraft).
const penFrame = (penned) => {
  if (!penned) return ''
  const pk = penned.by
  const pic = state.profiles?.get(pk)?.picture
  return `<div class="penhead">
    ${pic ? `<img class="penava" src="${esc(pic)}" alt="" referrerpolicy="no-referrer">` : `<span class="penava penava-fallback">✒</span>`}
    <span class="penname">✒ penned by <b>${esc(agentName(pk))}</b> <span class="penpk">(${esc(short(pk))})</span></span>
    <span class="penproof">${penned.direct
      ? 'sealed by its key — verified'
      : 'signature over these exact words — verified by this desk'}</span>
  </div>`
}

function pendingCard(d, i) {
  const { grant: g, draft, penned } = d
  const extraTags = (draft.hashtags ?? []).filter(t => !extractHashtags(composeContent(draft.text)).includes(t))
  return `<div class="draft${penned ? ' penned' : ''}" id="d-${i}">
    ${penFrame(penned)}
    <div class="head"><span class="scope">${esc(g.scopeName)}</span>
      <span class="badge ready">awaiting your hand</span></div>
    ${postPreview(draft)}
    ${draft.rationale ? `<p class="why"><b>Why:</b> ${esc(draft.rationale)}</p>` : ''}
    ${extraTags.length ? `<p class="prov">suggested tags not in the text (will NOT ride on the note): ${esc(extraTags.map(t => '#' + t).join(' '))}</p>` : ''}
    <p class="prov">${provenance(g, draft)}</p>
    ${exactNote(draft)}
    <div class="actions">
      <button class="primary" data-post="${i}">Post in my hand ✍</button>
      <button class="ghost" data-pass="${i}">Pass</button>
      <span class="msg" id="msg-${i}"></span>
    </div>
  </div>`
}

const inertCard = (d, i, badge, note) => `<div class="draft inert" id="d-${i}">
    <div class="head"><span class="scope">${esc(d.grant.scopeName)}</span>
      <span class="badge ${badge}">${badge === 'withdrawn' ? 'withdrawn by agent' : badge === 'unpenned' ? '✒ unpenned — refused' : 'malformed — inert'}</span></div>
    <p class="why">${note}</p>
    <p class="prov">${provenance(d.grant)}</p>
    <div class="actions"><button class="ghost" data-pass="${i}">Clear</button></div>
  </div>`

const historyRow = (rec) => `<div class="hrow">
    <span class="when">${fmtWhen(rec.at)}</span>
    <span class="badge ${rec.state}">${rec.state}</span>
    <span class="hname">${esc(rec.name ?? '?')}</span>
    <span>by ${esc(agentName(rec.author))}</span>
    ${rec.state === 'posted' ? `<span class="note">${esc(rec.noteId)} · ${rec.acks}/${rec.of} relays</span>` : ''}
  </div>`

export function renderDrafts() {
  const el = $('drafts')
  if (!state.config.agents.length) {
    el.innerHTML = `<div class="empty"><span class="kicker">an empty desk, by design</span>
      Ngage shows only drafts granted by agents on <em>your</em> allowlist —
      and the list is empty. Add your agent's <code>npub</code> under
      <a id="goto-settings" style="cursor:pointer">Settings</a> and refresh.</div>`
    document.getElementById('goto-settings').onclick = () => showTab('settings')
    return
  }

  const history = Object.values(state.store).sort((a, b) => b.at - a.at)

  const cards = []
  state.drafts.forEach((d, i) => {
    if (recordFor(state.store, d.grant)) return
    if (d.status === 'ready') cards.push(pendingCard(d, i))
    else if (d.status === 'withdrawn') cards.push(inertCard(d, i, 'withdrawn',
      'The agent rotated or removed this draft scope after granting it — the text is no longer readable with your key. Nothing to sign.'))
    else if (d.status === 'unpenned') cards.push(inertCard(d, i, 'unpenned',
      `The pen rule: a coordinator may only courier what a pen signed — and ${esc(d.why || 'this delivery carries no verifiable pen signature')}. It stays inert; nothing unpenned ever reaches your signer.`))
    else cards.push(inertCard(d, i, 'malformed',
      'This grant unwrapped and decrypted, but the payload is not a well-formed draft. It stays inert — nothing malformed ever reaches your signer.'))
  })

  el.innerHTML = (cards.length ? cards.join('') : `<div class="empty">
      <span class="kicker">the desk is clear</span>
      No drafts await your hand. When your agent next proposes a post,
      it will appear here — rendered exactly as it will publish.</div>`) +
    (history.length ? `<details class="history"><summary>history — ${history.length} settled draft${history.length === 1 ? '' : 's'}</summary>
      ${history.map(historyRow).join('')}</details>` : '')

  for (const b of el.querySelectorAll('[data-post]')) b.onclick = () => postInMyHand(Number(b.dataset.post))
  for (const b of el.querySelectorAll('[data-pass]')) b.onclick = () => {
    const d = state.drafts[Number(b.dataset.pass)]
    state.store = markPassed(d.grant)
    rerender()
  }
}

/** The ceremony: pure assembly → the Director's signer → the relay set. */
async function postInMyHand(i) {
  const d = state.drafts[i]
  const msg = $(`msg-${i}`)
  const btn = document.querySelector(`[data-post="${i}"]`)
  btn.disabled = true
  msg.className = 'msg'
  msg.textContent = 'asking your signer… (approve there)'
  try {
    const template = buildDraftEvent(d.draft)
    const signed = await state.signer.signEvent(template)   // ← authorship happens HERE, in YOUR signer
    msg.textContent = 'publishing to your relays…'
    const receipt = await state.relay.publish(signed)
    const noteId = nip19.noteEncode(signed.id)
    state.store = markPosted(d.grant, { noteId, acks: receipt.acks, of: receipt.of })
    msg.className = 'msg ok'
    msg.textContent = `${noteId} · accepted by ${receipt.acks}/${receipt.of} relays`
    setTimeout(rerender, 2500)                              // let the receipt be read, then settle to history
  } catch (err) {
    msg.className = 'msg err'
    msg.textContent = `not posted — ${err.message}`
    btn.disabled = false
  }
}
