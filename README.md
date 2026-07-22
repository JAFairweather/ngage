# Ngage — the Director's sovereign posting desk

**https://ngage.nave.pub** · a [nave.pub](https://nave.pub) app

Your agent drafts posts *for* you. Ngage is where you read them — rendered
exactly as a nostr client will show the finished note — and where the ones you
approve are published **in your own hand**: assembled in the open, signed by
*your* signer, issued as *your* kind-1. The agent proposes; only you publish.

This is the inverted delegation of
[nvoy#14](https://github.com/JAFairweather/nvoy/issues/14): instead of you
granting authority to an agent, the agent grants *drafts* to **you** — each one
a [NIP-DA scoped data grant](https://github.com/nostr-protocol/nips/pull/2411)
(kind-30440 scope, kind-440 grant rumor, NIP-59 gift wrap) in a
`draft:` namespace, encrypted end to end. Relays see ciphertext and an
ephemeral sender; the audit trail is nostr-native the whole way down.

## The sovereignty property

**Your secret key never touches a server — or this app.** Ngage speaks only to
a *signer*:

- **Alby / any NIP-07 extension** (with NIP-44) — the desktop front door,
- **NIP-46 bunker** — remote signing; pair once, the key stays on your device,
- a **local key in the tab** — an explicitly-advanced demo/recovery path.

Everything cryptographic that *receives* runs through that signer interface
(`getPublicKey` / `nip44Decrypt`), and the one thing that *writes* — the
approved post — is a plain unsigned template handed to `signEvent`. Each draft
card shows the **exact note to be signed** before you commit. The event author
is your pubkey because your signer made the signature; there is no role key, no
server-side posting, nothing to leak.

## The trust model

A draft reaches the desk only after four checks, in order — all fail-closed:

1. **Gift-unwrap authentication** (`drafts.mjs`, mirroring the NIP-DA
   reference): the kind-1059 wrap decrypts to a kind-13 seal whose signature is
   **verified**; the seal decrypts to the kind-440 grant rumor; and the rumor's
   claimed author must **equal the seal's verified signer** — nobody can put
   another key's name on a smuggled draft.
2. **Namespace**: only scopes named `draft:…` appear here. Every other grant
   (contact scopes, anything unknown) is invisible to this app.
3. **First-hand only**: the grant author must equal the scope's publisher (the
   `a`-tag). A *re-wrapped* grant — a real scope forwarded by a third party —
   is rejected outright: drafts are accepted only from the hand that wrote them.
4. **Your allowlist**: the author must be on the agent allowlist you manage in
   Settings (stored locally, npub-validated). An **empty list shows nothing** —
   trust is granted explicitly, never inferred from the wire.

Below the grant layer, the 30440 scope payload decrypts with the raw symmetric
scope key (NIP-44 v2, key used directly as the conversation key) — pure
vendored `nipxx.mjs` primitives. Malformed payloads render **inert** (visible,
never signable). A rotated or deleted scope reads stale and shows as
**withdrawn by agent**. Posted/passed drafts are remembered per device by
`publisher : scopeId # generation`, so a rotation (a genuinely new draft)
surfaces fresh while a settled generation stays settled.

## What publishing does

`Post in my hand ✍` assembles the kind-1 to the fleet's posting rules
(`assemble.mjs`, unit-tested byte-for-byte):

- `content` = draft text, blank line, image URL (media URL as the last line);
- `tags` = one NIP-92 `imeta` tag (`url` / `m` / `alt`) when an image rides
  along, plus a lowercase `t` tag per hashtag appearing in the text;

then your signer signs and the event publishes to your relay set (Settings;
defaults `relay.damus.io`, `nos.lol`, `relay.primal.net`). You get back the
`note1…` id and the count of relays that accepted. `Pass` dismisses locally —
nothing publishes, nothing is revoked.

## Local development

Static ESM, no build step, no CDN — the repo root is the deployable site
(production Caddy serves it as-is at ngage.nave.pub):

```bash
node serve.mjs          # → http://localhost:8420/  (correct .mjs mime, no-cache)
```

Tests build real NIP-DA fixtures (fresh keys, in-memory relay) and drive the
same modules the browser runs:

```bash
npm install             # nostr-tools, pinned to the vendored bundle version
npm test                # node --test: unwrap, trust gates, assembly, byte-exact wire format
```

`vendor/` holds the same-origin nostr-tools bundles (see `vendor/README.md`
for provenance and the regenerate recipe); `lib/` holds the vendored protocol
modules, each pinned to its canonical commit on line 1.
