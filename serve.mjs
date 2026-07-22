// serve.mjs — minimal static server for local development, mirroring the
// production serving model exactly: the REPO ROOT served as-is, .mjs with a
// JavaScript content-type, Cache-Control no-cache (the fleet's Caddy does the
// same at https://ngage.nave.pub). No build step; the importmap in index.html
// resolves nostr-tools to the same-origin vendor/ bundles.
//
//   node serve.mjs   →   http://localhost:8420/

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = normalize(join(fileURLToPath(import.meta.url), '..'))
const types = {
  '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') path = '/index.html'
  const file = normalize(join(root, path))
  try {
    if (!file.startsWith(root)) throw new Error('outside root')
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(8420, () => console.log('Ngage → http://localhost:8420/'))
