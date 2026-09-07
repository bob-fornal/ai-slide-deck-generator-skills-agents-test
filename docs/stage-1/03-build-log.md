# Build Log

A rough chronological account of how this stage was actually built — useful
as a script for a live walkthrough, since it includes the dead ends, not just
the finished result.

## 1. Define the contract before writing code

[PRD.md](../../PRD.md) was written first: what problem this solves (slide
imagery without a human sourcing it), what's explicitly out of scope (the
full slide-deck pipeline, a UI, batching), and what "done" means for this
stage (real image bytes, end to end, with credentials never leaving `.env`).

## 2. Build and deploy the Worker

[src/worker.js](../../src/worker.js) + [wrangler.toml](../../wrangler.toml):
validate a bearer token against a `CLOUDFLARE_API_TOKEN` secret, forward a
`prompt` (and optional `model`/`width`/`height`) to `env.AI.run(...)`, return
the bytes. `wrangler deploy --dry-run` confirmed the bundle and the `AI`
binding before ever touching the live deployment.

Verified directly with `curl` before any Claude-side tooling existed:

- Valid prompt + correct bearer token → `200 image/jpeg`, a genuine
  1024x1024 image from `@cf/black-forest-labs/flux-1-schnell`.
- Missing/incorrect `Authorization` → `401`.
- Missing `prompt` → `400`.

## 3. Add the `/generate-image` slash command

[.claude/commands/generate-image.md](../../.claude/commands/generate-image.md)
turned "hand-write a `curl` call every time" into a one-line command:
`/generate-image <context statement> --type=... --size=... --filename=...`.
This is the layer a workshop audience would actually type.

## 4. Generate the reference character — and hit the model's real limits

The recurring character asset — generated as `characters/bob.jpg`, since
renamed to `characters/bob-002.jpg` — took **five** iterations
of the same slash command before the framing was acceptable. That iteration
is itself the most instructive part of this stage:

| # | What changed in the prompt | Result |
|---|---|---|
| 1 | "a bald 57-year-old with glasses and a crazy beard... keep the background empty" | 1024x1024 JPEG generated; requested `--size=300x900` silently ignored. |
| 2 | Beard color specified ("crazy white beard") | Same framing issue persisted — color wasn't the problem. |
| 3 | Added "Show the full body" | Still cropped — descriptive wording alone didn't fix composition. |
| 4 | Added "(do not cut off the legs)" | Still a square crop — the model was fighting a square canvas, not misreading intent. |
| 5 | Reframed as "Create a complete anime character, from head to toe" | Improved, but still constrained by the fixed square output. |
| 6 | Enumerated body parts explicitly ("head, torso, arms, legs, and shoes... this is not a portrait, but a complete person") | Best result yet, still inside a fixed 1024x1024 square. |

The recurring root cause, confirmed at every step: `--type=jpg` routes to
`flux-1-schnell`, which **always returns a fixed 1024x1024 square** — no
prompt wording fixes a framing problem that the model's fixed output shape
causes. The correct fix, documented but not yet exercised for `bob.jpg`
itself, is `--type=png` (stable-diffusion-xl), which actually honors
`--size` and can produce a genuinely tall canvas.

See [characters/bob-002.md](../../characters/bob-002.md) for the exact
command that produced `characters/bob-002.jpg`, and
[04-lessons-learned.md](04-lessons-learned.md) for why this is worth walking
through live rather than skipping to the "right" answer.

## 5. Document the command, then document the stage

[characters/bob-002.md](../../characters/bob-002.md) captured the exact reproducible
command for the current asset. This `docs/` folder captures the stage as a
whole, on the assumption it becomes part of a presentation/workshop rather
than staying an internal note.
