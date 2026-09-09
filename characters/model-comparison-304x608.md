# Model Comparison — 304x608, single prompt, bob-012 through bob-017

Round 2 of the model comparison (round 1, at `300x800`/`304x800`, is
archived in `testing/model-comparison.md` along with its images,
`bob-001.jpg` through `bob-011.jpg`).

This round uses **one unmodified prompt** for every model — no rewording,
even for the model (`phoenix-1.0`) previously found to need it — and
requests `304x608` (already a multiple of 8 on both sides, so no worker
rounding applies):

```
Create a complete anime character: head, torso, arms, legs, and shoes (this is not a portrait, but a complete person): a bald 57-year-old with glasses and a crazy white beard, wearing a black hoodie and jeans. Nothing more; keep the background empty.
```

**Retry policy:** only retry a model if this exact prompt has previously
been observed to succeed on it (even after some failures). That applied to
`lucid-origin` only (`testing/bob-010.md`: succeeded on attempt 5/5 at a
different size). Every other model got a single attempt.

## Results

| File | Model | Attempts | Width/height honored? | Actual output | Result |
|---|---|---|---|---|---|
| [bob-012.jpg](bob-012.md) | `@cf/black-forest-labs/flux-1-schnell` | 1 (+ 1 fallback w/o size) | No — rejects outright (`5006`) | 1024x1024 JPEG | ✅ Good full-body image, fixed size |
| [bob-013.jpg](bob-013.md) | `@cf/stabilityai/stable-diffusion-xl-base-1.0` | 1 | Yes — exact 304x608 | 304x608 PNG (as `.jpg`) | ⚠️ Real content, but busy red/white grid background (not empty) and sunglasses instead of glasses |
| [bob-014](bob-014.md) | `@cf/leonardo/lucid-origin` | 16 | N/A — never generated | none | ❌ NSFW block (`3030`) on all 16 attempts, despite this exact prompt succeeding before |
| [bob-015](bob-015.md) | `@cf/leonardo/phoenix-1.0` | 1 (by design) | N/A — never generated | none | ❌ NSFW block (`3030`), consistent with this prompt's 18/18 failure rate from round 1 |
| [bob-016.jpg](bob-016.md) | `@cf/bytedance/stable-diffusion-xl-lightning` | 1 | Yes — exact 304x608 | 304x608 JPEG | ⚠️ Real content, but letterboxed head/torso crop only — no legs or shoes |
| [bob-017.jpg](bob-017.md) | `@cf/lykon/dreamshaper-8-lcm` | 1 | Yes — exact 304x608 | 304x608 PNG (as `.jpg`) | ❌ Solid black — silent failure |

## Takeaways

- **Every failure mode from round 1 turned out to be flaky, not
  model-specific.** Comparing round 1 → round 2 for the same model:
  - `stable-diffusion-xl-base-1.0`: solid black → real (bad) content
  - `stable-diffusion-xl-lightning`: solid black → real (partial) content
  - `dreamshaper-8-lcm`: real (glitchy) content → solid black
  - `lucid-origin`: NSFW-blocked then succeeded on retry (round 1) → NSFW-blocked on all 16 retries (round 2)

  None of these are deterministic per-model behaviors — they're
  per-request variance on whatever's on the other side of this Worker
  (Cloudflare Workers AI infra and/or the underlying model's own
  variance/safety-checker).
- **A documented past success is not a reliable predictor of a future
  retry succeeding.** `lucid-origin`'s round-1 success (5th of 5 attempts)
  did not reproduce at all in round 2, even across 16 attempts. Retry
  budgets should be treated as improving odds, not guaranteeing a result.
- **Only flux remains fully consistent** across both rounds: hard rejection
  of `width`/`height`, and a correct, good-quality image once the size
  parameters are dropped.
- **None of the SDXL-family "successes" in this round actually satisfy the
  brief.** Even where real pixels came back, none matched "complete
  person, head to shoes, empty background" — `bob-013.jpg` has a filled
  background, `bob-016.jpg` is cropped to a portrait. Across both rounds,
  flux is the only model that has reliably produced a correct result for
  this specific prompt.
