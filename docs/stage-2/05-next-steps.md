# Next Steps (Where the Next Stage Picks Up)

## Live verification — done, except one item outside this project's control

`wrangler login`/`wrangler deploy` were run (after fixing the env-var
collision — see [04-lessons-learned.md](04-lessons-learned.md#4-an-environment-variable-name-collision-can-look-exactly-like-a-broken-credential)),
and the deployed Worker was re-tested directly:

1. ✅ Size is genuinely honored: `widescreen` (1920x1080), `standard`
   (1024x768), and A4 (2480x3506, clamped to 1448x2048) all come back at
   exactly the expected dimensions.
2. ❌ **Reference images still don't work** — not because of anything left
   to fix in this project, but because of two external platform/account
   facts confirmed live:
   - `stable-diffusion-xl-base-1.0` is documented by Cloudflare to accept
     an `image`/`image_b64` img2img input; the deployed model rejects both.
   - `@cf/runwayml/stable-diffusion-v1-5-img2img`, the model that actually
     implements it, returns `5018: This account is not allowed to access`
     it.
3. ⬜ **Still worth doing**: try each of the three Agents at least once,
   end to end, to confirm their fixed/required/constrained size-and-type
   rules actually produce the right Worker call in practice, not just in
   the Agent definition text. Not done this stage — the verification effort
   went into the Worker-level size/image behavior directly.

## Unblocking reference images (see PRD §9 and [06-reference-image-investigation.md](06-reference-image-investigation.md))

A full live investigation — including two models that looked promising but
turned out not to actually condition on the reference image, with visual
proof — is in
[06-reference-image-investigation.md](06-reference-image-investigation.md).
Three independent paths could unblock this, one of which is actionable now
without waiting on anyone external:

- **Implement multipart request support for `flux-2-dev`** (and the
  `flux-2-klein` models) — this is a real Worker-side implementation task,
  not a blocked external dependency. `flux-2-dev` explicitly advertises
  multi-reference support (better than the single-image conditioning this
  project originally scoped) and this account already has access to it; the
  only gap is that its input schema is `{"multipart": {...}}`, not the flat
  JSON object `src/worker.js` currently sends. This is the strongest Stage 3
  candidate.
- Request Cloudflare account access to `@cf/runwayml/stable-diffusion-v1-5-img2img`
  (unclear whether this needs a plan upgrade, an allowlist request, or
  something else — worth checking directly with Cloudflare).
- Wait for Cloudflare to fix the documented-vs-actual gap on
  stable-diffusion-xl-base-1.0 (tracked publicly:
  [cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835)).

Until one of those happens, no Agent in this project can actually condition
generation on a reference image, regardless of `--type`/`--model` — and this
now includes `stable-diffusion-xl-lightning` and `dreamshaper-8-lcm`, both
tested and confirmed to accept an `image_b64` field without erroring while
quietly ignoring it (see the investigation doc for the visual proof).

## Model recommendations (see [06-reference-image-investigation.md](06-reference-image-investigation.md))

`@cf/leonardo/lucid-origin` is worth adopting as a `--type=png`-style
alternative to sdxl: it's accessible on this account, honors width/height,
and — unlike sdxl — auto-clamps an out-of-range request instead of
returning an opaque `502` (tested: `2480x2480` quietly came back as
`2048x2048`). `@cf/leonardo/phoenix-1.0` is worth trying if a slide ever
needs legible in-image text. Neither adds reference-image support.

## Other open questions carried forward (see PRD §9)

- Is the A4 downscale (`1448x2048` instead of true `2480x3506`) an
  acceptable long-term answer, or does a later stage need actual print-
  resolution output (which would need a different model/service entirely)?
- Now that reference-image conditioning doesn't work on *any* reachable
  model, the earlier question of "should `character-generator` switch from
  flux to sdxl to unlock it" is moot — sdxl can't do it either. That
  question only becomes live again if one of the three unblocking paths above
  happens.

## Beyond this stage

- Wire one of these three Agents into an actual slide (the first real
  consumer of generated art inside a deck, rather than a standalone test
  image).
- Once reference-image conditioning is actually unblocked (see above),
  decide concretely how `characters/` reference art should feed into
  generation.
- Production hardening flagged as out of scope since Stage 1 (rate
  limiting, retries, cost caps) — still nobody's problem until real usage
  volume shows up.
