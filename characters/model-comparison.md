# Model Comparison — bob-004 through bob-011

Same requested size (`--size=300x800`), six different Workers AI
text-to-image models, via the deployed Cloudflare Worker
(`src/worker.js`). Goal: see which models honor `width`/`height`, and what
they actually produce. Two models (`lucid-origin`, `phoenix-1.0`) initially
failed on an NSFW false positive; `bob-010.jpg`/`bob-011.jpg` are the
resolved retries for those two, using the prompt noted in each row below.

Prompt used for every attempt except `bob-011.jpg`:

```
Create a complete anime character: head, torso, arms, legs, and shoes (this is not a portrait, but a complete person): a bald 57-year-old with glasses and a crazy white beard, wearing a black hoodie and jeans. Nothing more; keep the background empty.
```

`bob-011.jpg` (`phoenix-1.0`) needed reworded text to clear the NSFW
filter — see the row below and `bob-011.md` for the exact prompt used.

Models excluded from this run: `@cf/runwayml/stable-diffusion-v1-5-img2img`
and `@cf/runwayml/stable-diffusion-v1-5-inpainting` (require image input,
not applicable to a pure text prompt), and the `flux-2-*` family (require an
unimplemented multipart request shape — see `docs/account-migration.md`).

## Results

| File | Model | HTTP | Width/height honored? | Actual output | Result |
|---|---|---|---|---|---|
| [bob-004.jpg](bob-004.md) | `@cf/black-forest-labs/flux-1-schnell` | 200 (after retry w/o size) | No — rejects `width`/`height` outright (`5006` error) | 1024x1024 JPEG | ✅ Good image, fixed size |
| [bob-005.jpg](bob-005.md) | `@cf/stabilityai/stable-diffusion-xl-base-1.0` | 200 | Yes — 300→304 (rounded to multiple of 8), 800 kept | 304x800 PNG (as `.jpg`) | ⚠️ Solid black — silent failure |
| [bob-006](bob-006.md) → [bob-010.jpg](bob-010.md) | `@cf/leonardo/lucid-origin` | 502 → 200 (retry) | Yes — 300→304, 800 kept | 304x800 JPEG | ✅ Resolved: flaky filter, same prompt succeeded on 5th retry |
| [bob-007](bob-007.md) → [bob-011.jpg](bob-011.md) | `@cf/leonardo/phoenix-1.0` | 502 → 200 (reworded + retry) | Yes — 300→304, 800 kept | 304x800 JPEG | ✅ Resolved: needed softer wording ("cartoon" not "anime", dropped age/"crazy") *and* a retry |
| [bob-008.jpg](bob-008.md) | `@cf/bytedance/stable-diffusion-xl-lightning` | 200 | Yes — 300→304, 800 kept | 304x800 JPEG | ⚠️ Solid black — silent failure |
| [bob-009.jpg](bob-009.md) | `@cf/lykon/dreamshaper-8-lcm` | 200 | Yes — 300→304, 800 kept | 304x800 PNG (as `.jpg`) | ✅ Real content, but glitchy artifact near head |

(For reference, `bob-002.jpg`/`bob-003.jpg` are earlier flux runs at
`--size=300x1200`, same "ignored, fixed 1024x1024" behavior as `bob-004.jpg`
here.)

## Takeaways

- **Only flux (`flux-1-schnell`) refuses `width`/`height` outright** — every
  SDXL-family model (`stable-diffusion-xl-base-1.0`,
  `stable-diffusion-xl-lightning`, `dreamshaper-8-lcm`, which is itself an
  SD1.5/SDXL-style checkpoint) accepted and honored the request, rounding to
  the nearest multiple of 8 as the worker's `clampDimensions` already does.
- **"200 OK" does not mean a usable image.** Two of the three models that
  honored the size (`stable-diffusion-xl-base-1.0` and
  `stable-diffusion-xl-lightning`) returned a perfectly valid, correctly
  sized image that is 100% solid black (verified pixel-by-pixel, not a
  rendering artifact). Only `dreamshaper-8-lcm` returned real (if flawed)
  content at the requested tall aspect ratio.
- **Leonardo's NSFW filter is flaky, not deterministic — but its strictness
  varies sharply by model.** Both `lucid-origin` and `phoenix-1.0` initially
  rejected the identical prompt as NSFW (`3030`). Investigation (see
  `bob-010.md`/`bob-011.md`) found:
  - A control prompt with zero relation to the character description ("a
    red sports car in a parking lot") was *also* blocked on first try, then
    passed 3/3 on immediate, unmodified retries — proving the filter has a
    baseline false-positive rate unrelated to content.
  - `lucid-origin` fit that pattern: the original character prompt,
    retried unmodified, succeeded on the 5th attempt.
  - `phoenix-1.0` did not: the same prompt failed 18/18 straight retries.
    It only passed after softening "anime" → "cartoon" and dropping
    "57-year-old"/"crazy", *and* still took a 2nd attempt — so for this
    model wording mattered, not just luck.
  - **Once past the filter, both Leonardo models honored `width`/`height`**
    (300→304, 800 kept), same as the other SDXL-family models.
- **Practical implication for this project:** for a tall full-body
  character crop, `lucid-origin`, `phoenix-1.0` (with softer wording), and
  `dreamshaper-8-lcm` all honor the aspect ratio and return real pixels —
  though flux's fixed 1024x1024 output remains the highest quality result
  overall if a square crop is acceptable. Any Leonardo-model request should
  budget for a few retries on `3030` before treating it as a hard failure.
