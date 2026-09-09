# Seed Determinism Test

Prior rounds (`model-comparison.md`, `model-comparison-304x608.md`) found
that identical requests — same prompt, model, and size — produce wildly
different results from call to call: some succeed, some get blocked as
NSFW, some come back solid black. The hypothesis was that this is caused
by never setting a `seed`: each call would draw fresh random noise, so
"the same request" is actually a different generation every time.

**This test added `seed` support to the Worker and checked whether it
actually makes output deterministic.**

## Change made

`src/worker.js`: an optional `body.seed` (integer) is now forwarded as
`params.seed` to whatever model is resolved, the same pattern already used
for `width`/`height`. Deployed live (Version ID
`be938b9d-80cb-40b3-a9e1-b3440ad6b3f4`). `.claude/skills/generate-image/SKILL.md`
documents the new `--seed=N` flag.

## Method

Same prompt every time:

```
Create a complete anime character: head, torso, arms, legs, and shoes (this is not a portrait, but a complete person): a bald 57-year-old with glasses and a crazy white beard, wearing a black hoodie and jeans. Nothing more; keep the background empty.
```

For each model: send the identical request (same `seed`, `width=304`,
`height=608`) 2-3 times in a row, then one more with a *different* seed as
a control. Compare SHA-256 checksums and pixel content across the
same-seed runs — true determinism means byte-identical output.

## Results

| Model | Same-seed runs | Outcome |
|---|---|---|
| `@cf/black-forest-labs/flux-1-schnell` | 3x seed=42, 1x seed=99 | **Rejects `seed` outright** — `5006: Additional or unevaluated properties '/seed'`, on every attempt. Cloudflare's docs list `seed` as a flux parameter; this account's deployed model disagrees, live. |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | 3x seed=42 (1 of 3 hit an unrelated internal error, see below), 1x seed=99 | **Not deterministic.** The two successful seed=42 runs produced two different SHA-256 checksums and different pixel content (67,329 vs 57,427 unique colors) — same seed, same everything else, different image. |
| `@cf/bytedance/stable-diffusion-xl-lightning` | 3x seed=42 | **Not deterministic.** All 3 succeeded but produced 3 different checksums and different pixel content (2,882 / 31,845 / 20,973 unique colors). |
| `@cf/lykon/dreamshaper-8-lcm` | 3x seed=42, 1x seed=99 | **Seed had zero effect.** All 4 runs (including the different-seed control) returned byte-identical output — a solid black image, same checksum every time. The seed value isn't influencing this model's output at all; whatever produces the black frame is unrelated to noise seeding. |
| `@cf/leonardo/lucid-origin` | 5x seed=42 | **Seed had zero effect.** All 5 failed identically with `3030: Input prompt contains NSFW content` — expected, since this is a pre-generation text-prompt filter that runs before any image noise/seed comes into play. |

One incidental finding along the way: one of the `stable-diffusion-xl-base-1.0`
attempts failed with a distinct, previously-unseen error —
`3005: triton error running inference ... Expected an 'InferenceResponse'
object ... found type 'list'` — an internal inference-server fault, a third
failure mode alongside the NSFW block and the black-output blanking already
documented.

## Conclusion

**The fixed-seed hypothesis is disproven, not confirmed.** Setting a seed
did not make any tested model's output reproducible:

- flux won't even accept the parameter.
- The two models that clearly do honor `width`/`height` and returned real
  content across multiple calls (`stable-diffusion-xl-base-1.0`,
  `stable-diffusion-xl-lightning`) still produced different images on
  every call despite an identical seed — meaning the non-determinism lives
  somewhere in Cloudflare's hosted inference path itself (e.g.
  non-deterministic GPU kernels, or multiple backend replicas/versions
  behind the same model name), not in "we forgot to pin randomness."
- `dreamshaper-8-lcm`'s solid-black result turned out to be completely
  unaffected by seed at all — a flag that this particular failure mode
  isn't about randomness varying the generation, but something else
  entirely (a consistent block/blank for this request shape at this
  point in time, not diagnosable further from the client side).
- Leonardo's NSFW block is unaffected by seed, as expected, since it's a
  pre-generation text classifier.

**Practical upshot:** retrying remains the only lever available from this
project's side for the flaky failure modes — a fixed seed does not turn
"retry until it works" into "get it right the first time." The `--seed`
flag is still useful if a caller wants to *attempt* to pin a specific
result for reproducibility, but it should not be relied on for stability,
and this finding is now documented in `SKILL.md` so future work doesn't
re-attempt the same fix expecting a different outcome.
