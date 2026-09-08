# Build Log

## 1. Research the actual Workers AI model schemas before designing anything

Rather than guess at what parameters `stable-diffusion-xl-base-1.0` and
`flux-1-schnell` accept, their Cloudflare documentation pages were fetched
directly. This mattered: it's what surfaced that

- stable-diffusion-xl accepts `image`/`image_b64` for img2img, but only a
  **single** image — not an array — and its `width`/`height` range is
  **256–2048px**, not unbounded.
- flux-1-schnell accepts only `prompt`, `steps`, `seed` — confirming, with a
  primary source rather than inference, that it has no size or image input
  at all.

Both facts directly shaped the initial design: the "one or more reference
images" requirement becomes "accept an array, but only the first is ever
used," and the "A4" scene size needed a clamp specifically because it
exceeds the documented 2048px maximum. **Caveat found later, live (§7):**
the `image`/`image_b64` part of stable-diffusion-xl's documentation turned
out to be wrong — the model doesn't actually accept either. Trusting a
vendor's own docs without a live test was itself the mistake here, one this
build log's earlier draft made too before catching it.

## 2. Test the currently-deployed Worker before changing it

Before writing any new Worker code, the **already-deployed** Worker (Stage
1's code) was tested directly: a POST with `model:
stable-diffusion-xl-base-1.0, width: 1024, height: 768` against the live
`PROD_CLOUDFLARE_WORKER_URL`.

Result: `200`, but the saved file was `1024x1024` — not `1024x768`. This
confirmed, with a real test rather than by re-reading source, the gap the
Stage 1 PRD had already flagged as unresolved ("the width/height forwarding
itself needs a fresh deploy before it's live"). It had never actually been
redeployed.

## 3. Add `images` and `clampDimensions()` to `src/worker.js`

Two additions, both following the existing pattern (Stage 1's `width`/
`height` handling already established "add fields that some models ignore,
document that they're ignored"):

- `clampDimensions(width, height)`: scales both dimensions together
  (preserving aspect ratio) down to fit 2048px, then up to fit 256px if
  still too small after that. Applied to every request that supplies both
  `width` and `height`, regardless of which model was selected — harmless
  for models that ignore size entirely.
- `images` handling (first attempt, later corrected in §7):
  `Array.isArray(body.images) && typeof body.images[0] === "string"` →
  forward as `params.image_b64`, following stable-diffusion-xl's documented
  schema, with no special-casing per model.

Validated with `wrangler deploy --dry-run` (2.83 KiB / gzip 1.10 KiB,
`env.AI` bound correctly) — confirms the bundle is structurally sound
without needing live Cloudflare auth.

## 4. Convert the slash command into a Skill

[.claude/skills/generate-image/SKILL.md](../../.claude/skills/generate-image/SKILL.md)
was written as a generalized version of the Stage 1 slash command's
instructions: the same `--type`/`--model`/`--size`/`--filename` parsing,
plus new `--image=path` (repeatable) handling — read each file, base64-
encode it, collect into the `images` array in order.

[.claude/commands/generate-image.md](../../.claude/commands/generate-image.md)
was then reduced to a single line delegating to the Skill, rather than
deleted outright — so a person typing `/generate-image` directly still
works exactly as before, without a second copy of the instructions to keep
in sync.

## 5. Write the three Agents

Each Agent's definition was written to make one specific rule impossible to
miss, since that rule — not the mechanics of calling the Skill — is the
actual point of having three Agents instead of one:

- `character-generator.md` states its fixed `--type=jpg --size=300x1200`
  up front, and explicitly tells the caller reference images will be
  ignored (since flux has no image input) rather than silently dropping
  them.
- `item-generator.md` states that missing `--type`/`--size` means *stop and
  ask*, not default.
- `scene-generator.md` enumerates the exact three accepted sizes as a
  table, and calls out the A4-clamping caveat specifically, since that's
  the one case where "the size you asked for" and "the size you get" won't
  exactly match.

## 6. Attempt to deploy and verify live — initially blocked

`wrangler whoami` was run to confirm Cloudflare auth before deploying. It
failed:

```
✘ [ERROR] A request to the Cloudflare API (/user/tokens/verify) failed.
Invalid request headers [code: 6003]
- Invalid format for Authorization header [code: 6111]
```

Existing wrangler log files (from prior sessions, going back to
2026-09-01) show deploys succeeded before — this looked at the time like a
stale/corrupted cached login, not a first-time setup problem. No attempt
was made to work around it (e.g. by hunting for stray credentials in the
shell environment); it needed an interactive `wrangler login`, which that
session couldn't run.

**Resolved (§7):** the real root cause wasn't a stale login at all — it was
an ambient `CLOUDFLARE_API_TOKEN` shell variable (this project's own app-
level bearer secret) colliding with wrangler's own use of that exact name
for Cloudflare account authentication. Renaming this project's local `.env`
variables to `PROD_CLOUDFLARE_WORKER_URL`/`PROD_CLOUDFLARE_API_TOKEN` fixed
it — `wrangler login` then succeeded on the next attempt.

## 7. Live verification, after `wrangler login`/`wrangler deploy` succeeded

With Cloudflare auth working, deployment and live testing proceeded — and
immediately surfaced two things the earlier code-only work had gotten
wrong.

**Size**: the size test from §2 was re-run against the newly-deployed
Worker. `1024x768` came back correctly — but a follow-up test of an
arbitrary non-multiple-of-8 size (`1023x1023`, chosen to probe the edges of
the documented 256–2048 range) returned the *same* opaque `502`/triton
error the unclamped-size bug produced in §2, even though this size was
well within the documented range. Bisecting with a few more requests
(`1000x1000` succeeded, `1004x1004` failed; `1152x896`/`896x1152` — common
SDXL "bucket" resolutions — succeeded) isolated the real constraint:
**width and height must each be a multiple of 8**, the standard diffusion-
model latent-space constraint, undocumented by Cloudflare for this model.
`clampDimensions()` was updated to round to the nearest multiple of 8 after
the range clamp (re-clamping once more in case rounding pushed a value just
outside 256–2048, though 256 and 2048 are themselves multiples of 8 so this
never actually triggers in practice). Re-tested: `widescreen` (1920x1080),
`standard` (1024x768), and A4 (2480x3506 → clamped to 1448x2048) all now
return exactly the expected dimensions.

**Reference images**: sending a request with `images` populated and
`model: stable-diffusion-xl-base-1.0` (the §3 implementation, using
`image_b64`) returned `502: ... input tensor 'image' is not present in the
model`. Switching to the array-of-bytes `image` field (also documented)
produced the identical error. A web search turned up the same exact error
message in Cloudflare community reports, plus a Cloudflare GitHub issue
([cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835))
confirming stable-diffusion-xl-base-1.0 doesn't actually support img2img
despite its own docs — this project's request wasn't malformed; the
platform's documentation was wrong. Switching to the model that's actually
built for this, `@cf/runwayml/stable-diffusion-v1-5-img2img`, produced a
different, much more informative error: `5018: This account is not allowed
to access @cf/runwayml/stable-diffusion-v1-5-img2img`. `src/worker.js` was
updated to only forward `images[0]` (as `image`, a decoded byte array) when
the resolved model is exactly that img2img model — for every other model,
`images` is now silently ignored (confirmed live: a request with `images`
set but `model: stable-diffusion-xl-base-1.0` now returns a normal `200`,
text-only). This is the one Stage 2 goal not actually achieved — see
[05-next-steps.md](05-next-steps.md).
