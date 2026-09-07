# AI Slide Deck Image Generator (Skills/Agents test)

Test harness for generating slide-deck images: send a prompt over HTTPS to a
Cloudflare Worker (`src/worker.js`), which calls a Workers AI text-to-image
model via the `AI` binding and streams the image back.

See [PRD.md](PRD.md) for the full product/requirements writeup.

## Project layout

- `src/worker.js` — the Cloudflare Worker (deployed edge code). Validates a
  bearer token, calls `env.AI.run(model, { prompt, width?, height? })`, returns
  the image bytes.
- `wrangler.toml` — Worker deployment config, including the `AI` binding.
- `characters/` — reference character art (e.g. for keeping a recurring
  character visually consistent across generated images).
- `.claude/commands/generate-image.md` — a Claude Code slash command
  (`/generate-image`) that calls the deployed Worker with a context statement
  plus `--type`/`--size`/`--filename` options.
- `.env` / `.env.example` — local config. `.env` is gitignored; never commit it.

There is no local client script — Claude (or any HTTP client, e.g. `curl`)
calls the deployed Worker directly.

## Setup

### Cloudflare Worker (`src/worker.js`)

```bash
npm install
wrangler login          # one-time, opens a browser
wrangler secret put CLOUDFLARE_API_TOKEN   # paste the same value as your local CLOUDFLARE_API_TOKEN
wrangler deploy
```

`wrangler deploy --dry-run` (or `npm run dry-run`) validates the Worker bundles
correctly and lists its bindings without touching the live deployment or
requiring login.

### Calling the deployed Worker

Copy `.env.example` to `.env` and fill in:

- `CLOUDFLARE_WORKER_URL` — the deployed Worker's URL.
- `CLOUDFLARE_API_TOKEN` — bearer token; must match the Worker's
  `CLOUDFLARE_API_TOKEN` secret.

```bash
curl -X POST "$CLOUDFLARE_WORKER_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"prompt": "A futuristic cybernetic city at sunset, cinematic lighting"}' \
  --output generated_image.png
```

`model` is optional in the request body; it defaults to
`@cf/black-forest-labs/flux-1-schnell`. `width`/`height` are optional and only
honored by models that support sized output (e.g. `stable-diffusion-xl-base-1.0`).

### `/generate-image` slash command

```
/generate-image A futuristic cybernetic city at sunset --type=png --size=1024x768 --filename=slides/city.png
```

See `.claude/commands/generate-image.md` for the full option list
(`--type=jpeg|png`, `--model=<id>`, `--size=WxH`, `--filename=path`).
**Requires the current `src/worker.js` (with `width`/`height` forwarding) to be
deployed** — redeploy with `wrangler deploy` if size options were previously
ignored.

## Verification performed

- `wrangler deploy --dry-run` bundles cleanly and reports `env.AI` bound
  correctly (see `wrangler.toml`).
- `src/worker.js` is deployed and live at `CLOUDFLARE_WORKER_URL`, with the
  `CLOUDFLARE_API_TOKEN` secret set. Confirmed end-to-end:
  - Valid prompt + correct bearer token → `200`, `image/jpeg`, a genuine
    1024x1024 image.
  - No `Authorization` header, or an incorrect token → `401`.
  - Missing `prompt` in the body → `400`.

## Notes / open items

- `src/worker.js` defaults to `@cf/black-forest-labs/flux-1-schnell`; the
  Workers AI model catalog changes over time, so confirm the model ID is
  still current before relying on it.
- The character reference image in `characters/` isn't consumed by the Worker
  yet — how it should condition generation (image-to-image input vs. a style
  reference) is still an open question (see PRD §9).
