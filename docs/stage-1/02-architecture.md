# Architecture: What Exists Right Now

## The pieces

| Piece | File | Role |
|---|---|---|
| Slash command | [.claude/commands/generate-image.md](../../.claude/commands/generate-image.md) | Teaches Claude how to parse a `/generate-image` invocation (context statement + `--type`/`--size`/`--model`/`--filename` flags) into a Worker call. |
| Worker | [src/worker.js](../../src/worker.js) | Edge function: validates a bearer token, calls `env.AI.run(model, params)`, normalizes the response into image bytes. |
| Deployment config | [wrangler.toml](../../wrangler.toml) | Binds `env.AI` (Workers AI) to the Worker; deployed as `ai-image-generator`. |
| Local config | `.env` (gitignored) / [.env.example](../../.env.example) | `CLOUDFLARE_WORKER_URL` + `CLOUDFLARE_API_TOKEN`, read at call time only — never hard-coded, never echoed into chat. |
| Reference art | [characters/](../../characters/) | Recurring character assets (`bob-001.svg`, `bob-002.jpg`) intended to keep imagery visually consistent. Not yet consumed by the Worker — see [05-next-steps.md](05-next-steps.md). |

## Request flow

```
 User / workshop attendee
     │  "/generate-image <context statement> --type=... --size=... --filename=..."
     ▼
 Claude (this session)
     │  1. Parses $ARGUMENTS: strips --flags, keeps the rest as the prompt
     │  2. Reads CLOUDFLARE_WORKER_URL / CLOUDFLARE_API_TOKEN from .env
     │  3. Builds JSON body: { prompt, model?, width?, height? }
     ▼
 POST https://ai-image-generator.<account>.workers.dev
 Authorization: Bearer <token>
     │
     ▼
 src/worker.js  (Cloudflare edge)
     │  - reject non-POST            -> 405
     │  - reject missing secret      -> 500
     │  - reject bad/missing token   -> 401
     │  - reject missing prompt      -> 400
     │  - env.AI.run(model, params)
     ▼
 Workers AI (hosted model catalog)
     │  flux-1-schnell            -> { image: "<base64>" }  (JPEG)
     │  stable-diffusion-xl-base  -> raw binary stream       (PNG)
     ▼
 src/worker.js normalizes both shapes into a Response
     │
     ▼
 Claude saves the bytes locally (e.g. characters/bob.jpg) and reports
 filename + size back to the user.
```

## Why two models, and why it matters for the demo

The Worker defaults to `@cf/black-forest-labs/flux-1-schnell` (fast, but
**always returns a fixed 1024x1024 image** — `width`/`height` are silently
ignored) and optionally uses `@cf/stabilityai/stable-diffusion-xl-base-1.0`
(slower, but actually honors `width`/`height`). The two models also return
genuinely different response shapes (base64-JSON vs. raw binary), which is
why `src/worker.js` has to branch on `typeof result.image === "string"`
rather than assuming one format.

This is a good live-demo moment: request a non-square size with the default
model, show that it's ignored, then switch `--type=png` and show the same
size actually taking effect. See [04-lessons-learned.md](04-lessons-learned.md).
