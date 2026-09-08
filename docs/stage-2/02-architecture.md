# Architecture: Stage 2 Additions

## The pieces added this stage

| Piece | File | Role |
|---|---|---|
| Skill | [.claude/skills/generate-image/SKILL.md](../../.claude/skills/generate-image/SKILL.md) | Owns argument parsing (`--type`/`--model`/`--size`/`--filename`/`--image`), `.env` credential handling, the Worker call, and response handling. The one place all four callers below share. |
| Slash command (updated) | [.claude/commands/generate-image.md](../../.claude/commands/generate-image.md) | Now a one-line delegator to the Skill, instead of duplicating its logic. |
| Character Agent | [.claude/agents/character-generator.md](../../.claude/agents/character-generator.md) | `--type`/`--size` fixed; caller supplies only the context statement and (optionally) a filename. |
| Item Agent | [.claude/agents/item-generator.md](../../.claude/agents/item-generator.md) | `--type`/`--size` required from the caller; the Agent asks rather than guessing. |
| Scene Agent | [.claude/agents/scene-generator.md](../../.claude/agents/scene-generator.md) | `--size` constrained to widescreen/standard/A4; `--type` still required from the caller. |
| Worker (updated) | [src/worker.js](../../src/worker.js) | Adds `images` (img2img via `image`, gated to the one model that actually supports it) and `clampDimensions()` (256–2048px, multiple-of-8, aspect-ratio-preserving). |

## Request flow, updated

```
 Person, or the slide-deck pipeline
     │  "generate a character/item/scene: <description> [--type] [--size] [--image...]"
     ▼
 character-generator / item-generator / scene-generator   (.claude/agents/*.md)
     │  Each enforces its own rule for where --type/--size come from,
     │  then hands off a fully-specified invocation.
     ▼
 generate-image Skill   (.claude/skills/generate-image/SKILL.md)
     │  1. Strip --flags from the prompt text
     │  2. Base64-encode any --image=path files, in order
     │  3. Read PROD_CLOUDFLARE_WORKER_URL / PROD_CLOUDFLARE_API_TOKEN from .env
     │  4. Build JSON body: { prompt, model?, width?, height?, images? }
     ▼
 POST https://ai-image-generator.<account>.workers.dev
     │
     ▼
 src/worker.js   (Cloudflare edge)
     │  - existing auth/validation checks (unchanged from Stage 1)
     │  - clampDimensions(width, height) -> fits 256-2048px, multiple of 8,
     │    keeps aspect ratio
     │  - images[0], if present AND model is the one img2img-capable model,
     │    -> params.image (decoded to a raw byte array); ignored otherwise
     │  - env.AI.run(model, params)
     ▼
 Workers AI
     │  flux-1-schnell:  prompt, steps, seed only — no size, no image input
     │  stable-diffusion-xl-base-1.0: prompt, width, height — image input
     │    documented but confirmed NOT actually implemented (see below)
     │  stable-diffusion-v1-5-img2img: the model that does implement image
     │    input — but this account can't reach it (see below)
     ▼
 Same response normalization as Stage 1 (base64-JSON vs. raw binary)
```

## Why clamping lives in the Worker, not in each Agent

`scene-generator`'s "A4" option (`2480x3506`) exceeds stable-diffusion-xl's
documented 256–2048px-per-side range. The clamp could have been written once
per Agent that needs it — but it's a property of the *model*, not of any
particular caller, so it belongs in `src/worker.js`, the one place that
already knows which model is being called. Any future Agent that requests an
oversized dimension gets the same protection automatically, without having
to remember to implement it again.

```
clampDimensions(2480, 3506)
  largest = 3506 > 2048  → scale = 2048/3506 ≈ 0.5843
  w ≈ 1449, h ≈ 2048 (range-clamped, but 1449 is not a multiple of 8)
  → round each to the nearest multiple of 8: width = 1448, height = 2048
```

The multiple-of-8 rounding step was added mid-stage, not part of the
original design — see [03-build-log.md](03-build-log.md) for how it was
found. `widescreen` (1920x1080) and `standard` (1024x768) both already sit
inside 256–2048 *and* are already multiples of 8, so they pass through the
same function unchanged — there's no separate "is this one of the three
known sizes" branch; the clamp is generic.

## Why reference images don't actually work yet, on any reachable model

Cloudflare's Workers AI documentation for stable-diffusion-xl-base-1.0 lists
`image` (an array of 8-bit pixel values) and `image_b64` (a base64 string) as
supported img2img inputs. Live testing shows the deployed model rejects both
(`"input tensor 'image' is not present in the model"`) — a confirmed
Cloudflare docs/platform gap, not a mistake in how this project called it.
The model that actually implements img2img,
`@cf/runwayml/stable-diffusion-v1-5-img2img`, returns `5018: This account is
not allowed to access` it.

So `images` in the Worker's request body is an array (matching the
user-facing "one or more reference images" requirement), and the Worker
correctly forwards only `images[0]` — as `image`, a raw byte array — but
*only* when the resolved model is exactly
`@cf/runwayml/stable-diffusion-v1-5-img2img`. For flux and sdxl, `images` is
silently ignored, matching how an unsupported `width`/`height` was already
handled. Every layer that surfaces this to a caller (Skill,
`item-generator`, `scene-generator`, `character-generator`) says plainly
that reference images don't currently work, rather than implying they do.
