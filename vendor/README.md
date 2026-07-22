# Vendored ESM bundles

Single-file ESM bundles of nostr-tools, served same-origin — the luke
`gate-vendor/` pattern. Ngage feeds a signing ceremony, so the page loads
**no CDN scripts**: the importmap in `index.html` maps the bare
`nostr-tools` / `nostr-tools/pool` / `nostr-tools/nip46` specifiers to these
files, and everything else on the page is sibling ESM from this repo.

Currently bundled from nostr-tools **2.23.12** (the pinned devDependency —
Node tests run against the same version the browser ships). Regenerate after
bumping it:

```bash
npm install
npx esbuild node_modules/nostr-tools/lib/esm/index.js --bundle --format=esm --minify --outfile=vendor/nostr-tools.mjs
npx esbuild node_modules/nostr-tools/lib/esm/pool.js  --bundle --format=esm --minify --outfile=vendor/nostr-tools-pool.mjs
npx esbuild node_modules/nostr-tools/lib/esm/nip46.js --bundle --format=esm --minify --outfile=vendor/nostr-tools-nip46.mjs
```

(or `npm run vendor` with esbuild on the PATH.)

The protocol modules in `lib/` are vendored separately, each with a pinned
provenance header on line 1 — `nipxx.mjs` + `liverelay.mjs` from
JAFairweather/nostr-scoped-data-grants, `nave-connect.mjs` from
JAFairweather/luke (carrying a flagged Ngage extension — see its header),
`nave-titlebar.mjs` from JAFairweather/nave.pub.
