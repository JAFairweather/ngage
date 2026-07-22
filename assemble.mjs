// assemble.mjs — deterministic kind-1 assembly from an approved draft. This is
// the LAST code the note passes through before the Director's signer, so it is
// pure, dependency-free, and unit-tested byte-for-byte (test/assemble.test.mjs).
// The wire format mirrors the fleet's established posting rules (luke's
// post-format.mjs — do not hand-roll a second dialect):
//
//   content = text  +  blank line  +  image URL     (image URL is the LAST line;
//                                                    clients render a trailing
//                                                    media URL inline)
//   tags    = [ ['imeta', 'url <u>', 'm image/png', 'alt <alt>'],   (NIP-92, when an image rides along)
//               ['t', '<tag>']  per lowercase hashtag IN THE TEXT ] (NIP-24 t-tags — hashtag feeds)

// Hashtags as clients index them: lowercase, no '#', deduped, in order of
// appearance. Matches letters/digits/underscore (the common client tokenizer).
export function extractHashtags(text) {
  const seen = new Set()
  for (const m of String(text || '').matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const tag = m[1].toLowerCase()
    if (!seen.has(tag)) seen.add(tag)
  }
  return [...seen]
}

// Final note content: the draft prose with the image URL as the last line.
export function composeContent(text, imageUrl) {
  const t = String(text || '').trimEnd()
  return imageUrl ? `${t}\n\n${imageUrl}` : t
}

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

// NIP-92 imeta tag (space-delimited key/value strings). The mime rides from
// the URL's extension; the fleet's cards are PNG, so image/png is the default
// when the extension is unrecognized — the `m` entry is always present.
export function imetaTag(url, alt) {
  const ext = (String(url).split('?')[0].match(/\.(\w+)$/) || [])[1]?.toLowerCase()
  const parts = [`url ${url}`, `m ${IMAGE_MIME[ext] ?? 'image/png'}`]
  if (alt) parts.push(`alt ${alt}`)
  return ['imeta', ...parts]
}

/**
 * The unsigned kind-1 template for an approved draft — everything except
 * pubkey/id/sig, which are the SIGNER'S business (that is the sovereignty
 * property: assembly is pure data; authorship happens only in the
 * Director's signer). `createdAt` is injectable for byte-exact tests.
 */
export function buildDraftEvent(draft, createdAt = Math.floor(Date.now() / 1000)) {
  const url = draft.image?.url
  const content = composeContent(draft.text, url)
  const tags = []
  if (url) tags.push(imetaTag(url, draft.image?.alt))
  for (const t of extractHashtags(content)) tags.push(['t', t])
  return { kind: 1, created_at: createdAt, tags, content }
}
