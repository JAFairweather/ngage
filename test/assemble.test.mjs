// assemble.test.mjs — the kind-1 wire format, byte for byte. This is the last
// pure step before the Director's signer, so the fixture is exact: any drift
// in content bytes or tag shapes fails loudly here before it can ship.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDraftEvent, composeContent, extractHashtags, imetaTag } from '../assemble.mjs'

test('kind-1 assembly matches the wire spec byte-exactly', () => {
  const draft = {
    text: 'Hand out references, not copies. #Nave #SovereignDrafts',
    image: { url: 'https://nave.pub/assets/cards/grants.png', alt: 'letterpress card' },
  }
  const ev = buildDraftEvent(draft, 1700000000)

  assert.equal(ev.kind, 1)
  assert.equal(ev.created_at, 1700000000)
  assert.equal(ev.content,
    'Hand out references, not copies. #Nave #SovereignDrafts\n\nhttps://nave.pub/assets/cards/grants.png')
  assert.deepEqual(ev.tags, [
    ['imeta', 'url https://nave.pub/assets/cards/grants.png', 'm image/png', 'alt letterpress card'],
    ['t', 'nave'],
    ['t', 'sovereigndrafts'],
  ])
})

test('the image URL is the LAST line; no image → no imeta, no URL line', () => {
  assert.equal(composeContent('words #tag  \n', 'https://x.dev/a.png'), 'words #tag\n\nhttps://x.dev/a.png')
  assert.ok(composeContent('words', 'https://x.dev/a.png').endsWith('\nhttps://x.dev/a.png'))

  const ev = buildDraftEvent({ text: 'plain thought, no media #nave' }, 1)
  assert.equal(ev.content, 'plain thought, no media #nave')
  assert.deepEqual(ev.tags, [['t', 'nave']])
})

test('hashtags: lowercase, deduped, order of appearance, URL fragments ignored', () => {
  assert.deepEqual(extractHashtags('#Alpha then #beta then #ALPHA again'), ['alpha', 'beta'])
  assert.deepEqual(extractHashtags('mid#word is not a tag'), [])
  assert.deepEqual(extractHashtags('but a line-start works\n#Nave_2'), ['nave_2'])
  assert.deepEqual(extractHashtags('https://x.dev/page#anchor'), [])
  assert.deepEqual(extractHashtags(''), [])
  // and via assembly: tags come from the text, not from any payload field
  const ev = buildDraftEvent({ text: 'One #Tag only', image: { url: 'https://x.dev/i.png' } }, 1)
  assert.deepEqual(ev.tags.filter(t => t[0] === 't'), [['t', 'tag']])
})

test('imeta: mime from the extension, png default, alt only when present', () => {
  assert.deepEqual(imetaTag('https://x.dev/a.jpg', 'pic'), ['imeta', 'url https://x.dev/a.jpg', 'm image/jpeg', 'alt pic'])
  assert.deepEqual(imetaTag('https://x.dev/a.webp'), ['imeta', 'url https://x.dev/a.webp', 'm image/webp'])
  assert.deepEqual(imetaTag('https://x.dev/card?sig=abc.def'), ['imeta', 'url https://x.dev/card?sig=abc.def', 'm image/png'])
  assert.deepEqual(imetaTag('https://x.dev/a.PNG', ''), ['imeta', 'url https://x.dev/a.PNG', 'm image/png'])
})
