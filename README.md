# AI Slide Deck Image Generator (Skills/Agents test)

Test harness for generating slide-deck images: send a prompt over HTTPS to a
Cloudflare Worker (`src/worker.js`), which calls a Workers AI text-to-image
model via the `AI` binding and streams the image back.

See [PRD.md](PRD.md) for the full product/requirements writeup.

## Project layout

- `src/worker.js` — the Cloudflare Worker (deployed edge code). Validates a
  bearer token, calls `env.AI.run(model, { prompt, width?, height?, image? })`,
  clamps width/height to the target model's supported range (and to a valid
  multiple of 8), and returns the image bytes.
- `wrangler.toml` — Worker deployment config, including the `AI` binding.
- `characters/` — reference character art (e.g. for keeping a recurring
  character visually consistent across generated images).
- `.claude/skills/generate-image/SKILL.md` — the `generate-image` Skill: owns
  parsing `--type`/`--model`/`--size`/`--filename`/`--image` and calling the
  deployed Worker. Shared by the slash command and all three Agents below.
- `.claude/commands/generate-image.md` — a Claude Code slash command
  (`/generate-image`) that delegates straight to the `generate-image` Skill.
- `.claude/agents/character-generator.md`,
  `.claude/agents/item-generator.md`,
  `.claude/agents/scene-generator.md` — three Agents that call the
  `generate-image` Skill, each with different rules for where `--type`/`--size`
  come from (fixed, caller-required, or chosen from a fixed list — see
  [PRD.md §12](PRD.md#12-stage-2-skill--three-agents--reference-images)).
- `.env` / `.env.example` — local config. `.env` is gitignored; never commit it.

There is no local client script — Claude (or any HTTP client, e.g. `curl`)
calls the deployed Worker directly.

## Setup

### Cloudflare Worker (`src/worker.js`)

```bash
npm install
wrangler login          # one-time, opens a browser
wrangler secret put CLOUDFLARE_API_TOKEN   # paste the same value as your local PROD_CLOUDFLARE_API_TOKEN
wrangler deploy
```

If `wrangler login`/`wrangler deploy` fail with an invalid-Authorization-header
error, check whether `CLOUDFLARE_API_TOKEN` is set as an ambient shell
variable — wrangler reads that exact name for its own Cloudflare account
auth, and a value meant for something else (like this project's own bearer
secret) will break it. This project's `.env` avoids the collision entirely
by naming its own variables `PROD_CLOUDFLARE_WORKER_URL` /
`PROD_CLOUDFLARE_API_TOKEN` instead (see `.env.example`).

`wrangler deploy --dry-run` (or `npm run dry-run`) validates the Worker bundles
correctly and lists its bindings without touching the live deployment or
requiring login.

### Calling the deployed Worker

Copy `.env.example` to `.env` and fill in:

- `PROD_CLOUDFLARE_WORKER_URL` — the deployed Worker's URL.
- `PROD_CLOUDFLARE_API_TOKEN` — bearer token; must match the Worker's
  `CLOUDFLARE_API_TOKEN` secret (a different, unprefixed name — see the
  `.env.example` header comment for why these two names don't match).

```bash
curl -X POST "$PROD_CLOUDFLARE_WORKER_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PROD_CLOUDFLARE_API_TOKEN" \
  -d '{"prompt": "A futuristic cybernetic city at sunset, cinematic lighting"}' \
  --output generated_image.png
```

`model` is optional in the request body; it defaults to
`@cf/black-forest-labs/flux-1-schnell`. `width`/`height` are optional, only
honored by models that support sized output (e.g. `stable-diffusion-xl-base-1.0`),
and clamped server-side to that model's supported 256–2048px-per-side range,
rounded to a multiple of 8 (confirmed live — non-multiples fail upstream).
`images` (optional array of base64-encoded reference images) is currently a
no-op for every model reachable via `--type`: sdxl is documented to support
image input but doesn't in practice, and the model that actually does
(`@cf/runwayml/stable-diffusion-v1-5-img2img`, reachable only via an explicit
`model` override) currently isn't accessible on this Cloudflare account — see
[PRD.md §12](PRD.md#12-stage-2-skill--three-agents--reference-images).

### `/generate-image` slash command, or the `generate-image` Skill directly

```
/generate-image A futuristic cybernetic city at sunset --type=png --size=1024x768 --filename=slides/city.png
```

The slash command delegates to `.claude/skills/generate-image/SKILL.md`, which
also underlies `character-generator`, `item-generator`, and `scene-generator`
(see `.claude/agents/`). See the Skill file for the full option list
(`--type=jpeg|png`, `--model=<id>`, `--size=WxH`, `--filename=path`,
`--image=path`, repeatable for reference images — only the first is honored).
**Requires the current `src/worker.js` (with `width`/`height` clamping and
`images` support) to be deployed** — redeploy with `wrangler deploy` if size or
reference-image options appear to be ignored.

## Verification performed

- `wrangler deploy --dry-run` bundles cleanly and reports `env.AI` bound
  correctly (see `wrangler.toml`).
- `src/worker.js` is deployed and live at `PROD_CLOUDFLARE_WORKER_URL`, with
  the `CLOUDFLARE_API_TOKEN` secret set. Confirmed end-to-end:
  - Valid prompt + correct bearer token → `200`, `image/jpeg`, a genuine
    1024x1024 image.
  - No `Authorization` header, or an incorrect token → `401`.
  - Missing `prompt` in the body → `400`.
  - Requested `width`/`height` are genuinely applied for sdxl (e.g.
    `1920x1080`, `1024x768` come back exactly as requested; a print-
    resolution A4 request comes back clamped to `1448x2048`).
  - Reference images (`images`) do **not** currently change generation for
    any reachable model — see PRD §12/§13 for the full finding.

## Notes / open items

- `src/worker.js` defaults to `@cf/black-forest-labs/flux-1-schnell`; the
  Workers AI model catalog changes over time, so confirm the model ID is
  still current before relying on it.
- The character reference art in `characters/` still isn't consumed as a
  generation input by `character-generator` — that Agent is fixed to the
  jpeg/flux path, which has no image-input capability at all. This isn't
  really flux-specific: no reachable model currently supports image input
  at all (see next item).
- **Reference-image conditioning is currently a dead end for every model
  this account can reach.** `stable-diffusion-xl-base-1.0` is documented by
  Cloudflare to accept an image for img2img but actually rejects it (a
  known Cloudflare docs/platform gap,
  [cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835)).
  The model that actually implements it, `@cf/runwayml/stable-diffusion-v1-5-img2img`,
  returns a `5018` "this account is not allowed to access" error. Nothing in
  this project's own code is broken; unblocking this needs either Cloudflare
  fixing the sdxl gap or this account being granted access to the img2img
  model — see PRD §12/§13.
- See [docs/README.md](docs/README.md) for the full stage-by-stage
  write-up, including `docs/stage-2/` for this stage's build log and
  lessons learned.
