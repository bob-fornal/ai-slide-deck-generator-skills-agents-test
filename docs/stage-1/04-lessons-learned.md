# Lessons Learned (the "aha" moments worth pausing on)

These are the non-obvious things this stage surfaced. In a workshop, each of
these is a good place to stop and let the audience predict the outcome
before revealing it.

## 1. "Fast" and "sized" are different models, not different flags

It's tempting to assume `--size` is a universal option. It isn't:
`@cf/black-forest-labs/flux-1-schnell` (the default, fast model) **silently
ignores `width`/`height`** and always returns a fixed 1024x1024 image.
Only `@cf/stabilityai/stable-diffusion-xl-base-1.0` honors requested
dimensions. This is why the slash command's own spec
([.claude/commands/generate-image.md](../../.claude/commands/generate-image.md))
calls this out explicitly rather than letting it fail silently — the Worker
still returns `200` either way, so nothing *errors*; the output is just not
what was asked for. That gap between "succeeded" and "did what I asked" is
worth demonstrating live.

## 2. Prompt wording can't fix a canvas-shape problem

Across the `bob.jpg` iterations (see
[03-build-log.md](03-build-log.md#4-generate-the-reference-character--and-hit-the-models-real-limits)),
five rounds of increasingly explicit prompt language — "show the full body,"
"do not cut off the legs," "from head to toe," "this is not a portrait" —
each improved the composition somewhat but never solved the underlying
issue: a **square** output canvas fighting a **tall** subject. The fix isn't
better wording, it's a different model/size combination. A good exercise:
ask a workshop audience to predict how many prompt tweaks it'll take before
someone suggests changing the model instead.

## 3. The same Worker endpoint has to normalize two different response shapes

`env.AI.run(...)` doesn't return one consistent shape across models:

- `flux-1-schnell` → `{ image: "<base64 string>" }` (JPEG)
- `stable-diffusion-xl-base-1.0` → a raw binary stream (PNG)

`src/worker.js` branches on `typeof result.image === "string"` to tell them
apart. Anyone adding a third model needs to check its actual response shape
rather than assuming it matches either existing case.

## 4. Credentials-out-of-context is a design constraint, not an afterthought

The slash command spec explicitly instructs: read `CLOUDFLARE_WORKER_URL`
and `CLOUDFLARE_API_TOKEN` from `.env`, **never print the token's value, and
don't put it in a message to the user**. This was designed in from the start
(PRD §3, §7.6) rather than bolted on — worth calling out as a pattern for
any workshop attendee building their own Claude-callable endpoints.

## 5. Verifying failure modes mattered as much as verifying success

"Done" for this stage wasn't just a `200` with real image bytes — it
included confirming `401` for bad/missing auth and `400` for a missing
prompt, each with a body describing the failure (not a bare status code).
That's a deliberate, checked requirement (PRD §7.5), not an incidental test.
