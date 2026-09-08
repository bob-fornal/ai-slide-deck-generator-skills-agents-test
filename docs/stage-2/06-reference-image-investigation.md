# Reference-Image Conditioning: What's Broken, What to Watch For, What to Use Instead

This documents, with actual test images rather than just error text, why
reference-image conditioning doesn't work on this project today, and which
of the currently-accessible Workers AI text-to-image models are worth using
going forward. Everything below was tested live against this account, not
inferred from Cloudflare's documentation — see
[04-lessons-learned.md](04-lessons-learned.md) for why that distinction
matters here specifically.

> **Correction (re-tested with proper tooling):** the first version of this
> document's §3 concluded `stable-diffusion-xl-lightning` and
> `dreamshaper-8-lcm` "silently ignore" a reference image. That conclusion
> was wrong — not about the models, but because the ad-hoc test script used
> at the time sent `image_b64`/`image` as top-level request fields that
> `src/worker.js` never actually read for those models (it only forwarded
> `images[]` when the target model was the one gated img2img model). The
> reference image never left the test script. [scripts/test-reference-image.js](../../scripts/test-reference-image.js)
> and a diagnostic `imageField` escape hatch in `src/worker.js` (see
> [02-architecture.md](02-architecture.md)) now forward the image properly
> to any requested model, and §3 below reflects the corrected, real results.

## Reproducing every result in this document

```bash
node scripts/test-reference-image.js \
  --model=<model-id> --field=image|image_b64 \
  --reference=characters/bob-002.jpg \
  --prompt="the same character, raising one hand" \
  --seed=7 --out=test-output
```

Saves a `_WITH-reference.*` and `_WITHOUT-reference-control.*` file locally
(the latter skippable with `--no-control`) so results can be inspected by
eye, not just by status code. Full flag reference, more examples (including
sweeping every candidate model in one loop), and how to interpret the
output: [scripts/README.md](../../scripts/README.md).

## The reference image used for every test below

![Reference image: bob-002.jpg — a bald, bearded anime character in a black hoodie and jeans](../../characters/bob-002.jpg)

`characters/bob-002.jpg` — bald, glasses, white beard, black hoodie, jeans,
empty background. Every test in this document uses this single reference
image and asks a model to generate a variation of this same character
("raising one hand") while passing it in as a reference, and compares that
against the same prompt and seed with no reference image at all.

## What's actually broken

### 1. `stable-diffusion-xl-base-1.0` — documented to accept an image, doesn't

Cloudflare's docs list `image` (byte array) and `image_b64` (base64 string)
as supported img2img inputs. Both fail outright:

```
502: AI generation failed: 3030: Model input is not valid: input tensor
`image` is not present in the model
```

This is a confirmed Cloudflare docs/platform gap
([cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835)),
not a mistake in how this project called it — community reports show the
identical error.

### 2. `stable-diffusion-v1-5-img2img` — the dedicated model, account-gated

This is the model Cloudflare's own catalog names as the img2img specialist.
It returns:

```
502: AI generation failed: 5018: This account is not allowed to access
@cf/runwayml/stable-diffusion-v1-5-img2img
```

Not a code problem — an account/plan permission this Cloudflare account
doesn't currently have.

### 3. `stable-diffusion-xl-lightning` — same failure as sdxl-base

Properly forwarded this time (via `scripts/test-reference-image.js`), both
`--field=image` and `--field=image_b64` fail with the exact same error as
`stable-diffusion-xl-base-1.0`:

```
502: AI generation failed: 3030: Model input is not valid: input tensor
`image` is not present in the model
```

No image is ever produced — the call fails before generation starts. Not
surprising given "Lightning" is itself an SDXL derivative and likely shares
the same serving code path that doesn't wire up image input.

### 4. `dreamshaper-8-lcm` — the one genuinely interesting case: a real tensor, wrong shape

This is the only model tested that has an actual `image` input tensor
recognized by the runtime — but rejects the shape this project sends:

```
502: AI generation failed: 3010: Invalid or incomplete input for the model:
model returned: unexpected shape for input 'image' for model
'dreamshaper-8-lcm'. Expected [1], got [1,217768]
```

`217768` is exactly the byte length of `characters/bob-002.jpg`'s raw file
bytes — confirming the request really did carry the reference image this
time (unlike the flawed original test). The runtime expected some other
shape entirely (`[1]`, which doesn't read like a real image tensor shape —
possibly the model wants a pre-decoded, fixed-resolution pixel array rather
than the raw compressed file bytes Cloudflare's own generic schema
description implies). This wasn't reverse-engineered further here — it's a
real, narrower lead worth revisiting specifically if `dreamshaper-8-lcm`
becomes a priority, rather than the flat "doesn't work" verdict that applies
to every other model tested.

**No test in this investigation produced a single successful
reference-conditioned image** — every model, with every field name tried,
either lacked the tensor entirely, rejected its shape, or was account-gated,
and failed before generating anything. The only real generated images that
exist from this investigation are the same-seed, no-reference *controls* —
proof the pipeline itself works, not that reference conditioning does.

## What to watch for, going forward

- **Cloudflare fixing [#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835).**
  If `stable-diffusion-xl-base-1.0` (or `stable-diffusion-xl-lightning`)
  ever actually implements `image`/`image_b64`, re-run
  `scripts/test-reference-image.js` before trusting it — a `200` response
  alone is not sufficient evidence (see the recurring rule below).
- **This account being granted access to `stable-diffusion-v1-5-img2img`.**
  Test with the same script the moment access changes — a `5018` error
  becoming a `200` is not the same as confirming real conditioning either.
- **`dreamshaper-8-lcm`'s shape mismatch getting resolved.** Of everything
  tested, this is the one case with a genuine `image` tensor already
  present — only the input shape is wrong. Worth a focused follow-up (what
  shape does it actually want?) if this model becomes a priority.
- **`flux-2-dev`'s "multi-reference support" — the most promising lead, not yet usable.**
  See below: it needs a different request shape this project doesn't send yet.
- **New models appearing in the [Workers AI Text-to-Image catalog](https://developers.cloudflare.com/workers-ai/models/?tasks=Text-to-Image).**
  It listed 11 models as of this writing; re-check it periodically, since this
  is an actively growing catalog (three FLUX.2 models and two Leonardo
  models all appeared on this list without needing any code change here to
  discover them).
- **Never trust a documented schema field until it's been exercised live
  with a same-seed, with/without comparison** — the recurring, hard-learned
  rule of this entire investigation.

## `flux-2-dev`: the real path forward, blocked on a request-shape gap (not access)

`flux-2-dev` (`@cf/black-forest-labs/flux-2-dev`) is the only model in the
current catalog that explicitly advertises **"multi-reference support"** —
exactly what this project originally set out to build, and potentially
better (multiple references, not just one). Testing it with the same simple
JSON body this project's Worker already sends to every other model failed
differently from everything else:

```
502: AI generation failed: 5006: Error: required properties at '/' are 'multipart'
```

This isn't an access restriction (no `5018`) and isn't a broken-docs
situation (no tensor error) — its raw input schema really is
`{"multipart": {"body": ..., "contentType": ...}}`, meaning this model
expects an actual `multipart/form-data` request, not the flat JSON object
`{ prompt, width, height, images }` that works for every SDXL-family model.
`flux-2-klein-9b` and `flux-2-klein-4b` (same family, image *editing* rather
than pure generation) hit the identical error. Making these work means
teaching `src/worker.js` to construct a real multipart body for this one
model family — a genuine implementation task, not a blocked wait for
Cloudflare or for account access. This is the strongest candidate for
Stage 3 if reference-image conditioning is still wanted.

## Model recommendations, given what's accessible right now

All of the below were tested live against this account (not assumed from
docs). None of them do reference-image conditioning today — that capability
depends on the `flux-2-dev` multipart work or one of the other two unblocks
above.

| Model | Access | Size handling | Recommendation |
|---|---|---|---|
| `@cf/black-forest-labs/flux-1-schnell` | ✅ (current default) | Fixed 1024x1024, ignores width/height | Keep as the fast default for `character-generator` and anywhere exact size doesn't matter. |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | ✅ (current `--type=png`) | Honors width/height, 256–2048px, must be a multiple of 8 (undocumented, confirmed live) | Keep as the sized-output default. No image input despite docs — confirmed `502`, tensor not present. |
| `@cf/leonardo/lucid-origin` | ✅ | Honors width/height; auto-clamps out-of-range values instead of erroring (tested: a requested 2480x2480 quietly came back 2048x2048, no 502) | **Worth adopting.** Friendlier failure mode than sdxl for oversized requests — worth it alone. No image input. |
| `@cf/leonardo/phoenix-1.0` | ✅ | Similar range to sdxl (untested at the edges) | Marketed for strong prompt adherence and legible in-image text — worth testing if a slide ever needs generated text baked into the image itself. |
| `@cf/bytedance/stable-diffusion-xl-lightning` | ✅ | Same 256–2048 style range as sdxl-base | A faster sdxl alternative if generation latency matters; confirmed (properly, via the test script) it has the identical missing-image-tensor error as sdxl-base — don't reach for it expecting img2img. |
| `@cf/lykon/dreamshaper-8-lcm` | ✅ | Defaults to 512x512 if no size given; honors width/height when supplied | Lower default resolution than the others. The one model with a genuine `image` tensor, but it rejects the shape sent — see §4 above. Worth a follow-up specifically for this model if it becomes a priority; not yet functional. |
| `@cf/runwayml/stable-diffusion-v1-5-inpainting` | ✅ (notably, *not* account-gated like its img2img sibling) | Requires a separate `mask_image` input, untested further | Different use case (masked editing of an existing image, not reference-based generation) — a possible Stage 3+ avenue for editing a generated scene, not for character consistency. |
| `@cf/runwayml/stable-diffusion-v1-5-img2img` | ❌ `5018` account-gated | — | Re-test if access is ever granted. |
| `@cf/black-forest-labs/flux-2-dev` | ⚠️ Accessible, but wrong request shape (`multipart` required) | Unknown — schema not published beyond the multipart wrapper | **Top candidate for actual reference-image support** — needs Worker-side multipart implementation, not a blocked external dependency. |
| `@cf/black-forest-labs/flux-2-klein-9b` / `flux-2-klein-4b` | ⚠️ Same multipart gap | Unknown | Image *editing* models (unify generation + editing) — same integration work as flux-2-dev would unlock these too. |
