# `test-reference-image.js`

Tests whether a Workers AI text-to-image model genuinely conditions
generation on a reference image, rather than trusting a `200` response or
Cloudflare's documented schema. Calls the deployed Worker twice — once
**with** a reference image, once **without** (same prompt and seed) — and
saves both results locally as real files so you can look at them yourself.

This exists because a `200` response and even a *different* output are not,
by themselves, proof that a reference image was used — see
[../docs/stage-2/06-reference-image-investigation.md](../docs/stage-2/06-reference-image-investigation.md)
for the investigation that found this out the hard way (twice).

## Prerequisites

- `.env` in the project root, with a Worker URL and bearer token variable
  (any name ending in `CLOUDFLARE_WORKER_URL` / `CLOUDFLARE_API_TOKEN` —
  the script searches rather than assumes a specific prefix, since this
  project's own `.env` has used more than one naming convention; see
  [../PRD.md §8](../PRD.md#8-configuration-surface-env)).
- The deployed Worker must include the diagnostic `imageField` support (see
  [../src/worker.js](../src/worker.js) and
  [../docs/stage-2/02-architecture.md](../docs/stage-2/02-architecture.md#the-imagefield-diagnostic-escape-hatch)) —
  redeploy with `wrangler deploy` if the script's "WITH reference" call
  comes back claiming the field is unrecognized in a way that doesn't match
  the model errors documented in the investigation doc.
- Node.js (uses the global `fetch`; no npm install needed — the script has
  no dependencies beyond Node's built-ins).
- A local reference image to test with (this project uses
  `characters/bob-002.jpg`).

## Usage

```bash
node scripts/test-reference-image.js \
  --model=<workers-ai-model-id> \
  --field=image|image_b64 \
  --reference=<path-to-local-image> \
  --prompt="<context statement>" \
  [--seed=<number>] \
  [--width=<px>] [--height=<px>] \
  [--out=<output-dir>] \
  [--no-control]
```

### Flags

| Flag | Required | Meaning |
|---|---|---|
| `--model` | Yes | The Workers AI model id to test, e.g. `@cf/bytedance/stable-diffusion-xl-lightning`. |
| `--field` | Yes | Which field name to send the reference image under: `image` (an array of the file's raw bytes) or `image_b64` (the file base64-encoded). Match whichever the target model's own documented schema uses — if unsure, try both; a wrong field name typically produces a different, informative error rather than silently working. |
| `--reference` | Yes | Path to the local reference image file (any format the model accepts, e.g. `.jpg`/`.png`). |
| `--prompt` | Yes | The context statement, e.g. `"the same character, raising one hand"`. Used identically for both the with- and without-reference calls. |
| `--seed` | No (default `7`) | Fixed seed so the with/without comparison is as apples-to-apples as a hosted model allows. Change it to get a different sample. |
| `--width`, `--height` | No | Only meaningful for models that honor sized output (e.g. sdxl-family models); omit for models like flux that ignore them. |
| `--out` | No (default `test-output`) | Directory to save the two output files into. Created if it doesn't exist. Gitignored by default (`test-output/`). |
| `--no-control` | No | Skip the without-reference control call — useful once you already have a control for that model/prompt/seed and just want to re-test the with-reference call (e.g. after a field-name or model change). |

### Example: testing a specific model

```bash
node scripts/test-reference-image.js \
  --model=@cf/lykon/dreamshaper-8-lcm \
  --field=image \
  --reference=characters/bob-002.jpg \
  --prompt="the same character, raising one hand" \
  --seed=7
```

### Example: testing both possible field names for one model

Some models document both `image` and `image_b64`; if you don't know which
(if either) actually works, test both — skip the control on the second call
since you already have one from the first:

```bash
node scripts/test-reference-image.js --model=<id> --field=image --reference=characters/bob-002.jpg --prompt="..."
node scripts/test-reference-image.js --model=<id> --field=image_b64 --reference=characters/bob-002.jpg --prompt="..." --no-control
```

### Example: sweeping every candidate model in one go

```bash
for model in \
  "@cf/stabilityai/stable-diffusion-xl-base-1.0" \
  "@cf/bytedance/stable-diffusion-xl-lightning" \
  "@cf/lykon/dreamshaper-8-lcm" \
  "@cf/runwayml/stable-diffusion-v1-5-img2img"
do
  echo "=== $model ==="
  node scripts/test-reference-image.js \
    --model="$model" --field=image \
    --reference=characters/bob-002.jpg \
    --prompt="the same character, raising one hand" \
    --seed=7
  echo
done
```

## Output

Two files land in `--out` (default `test-output/`), named
`<model-slug>_<field>_seed<N>_<timestamp>_WITH-reference.<ext>` and
`..._WITHOUT-reference-control.<ext>` — `<ext>` is inferred from the
response's `Content-Type` (`png`, `jpg`, or `bin` for a non-image error
body). The console output also prints, per call: HTTP status, byte size,
and a short SHA1 prefix; and, if a call didn't return `200`, the response
body (the actual error text, not just the status code).

## Interpreting the result

The script prints a `RESULT:` line comparing the two checksums, but **do
not stop there**:

- **Non-200 status on the "WITH reference" call** — the model rejected the
  image outright (missing tensor, wrong shape, access denied, etc.). No
  image was produced; there's nothing to compare visually. Read the error
  body — it's usually specific enough to say exactly why (see the
  investigation doc for three different real examples of this).
- **Identical checksums** — the reference image had no effect (or, less
  likely, both calls failed identically for an unrelated reason — check
  the status codes).
- **Different checksums** — **not proof of conditioning by itself.**
  Hosted inference isn't always perfectly deterministic even with the same
  seed, and supplying an extra field can itself nudge the sampling
  schedule without the image content ever actually being used. Open both
  saved files and the original reference image, and look: does the
  "WITH reference" output actually resemble the reference (same character,
  same distinguishing features), or is it just another unrelated random
  sample? Only that visual comparison is real evidence.

## Adding a new model to test

Nothing needs to change in this script — just point `--model` at the new
model id and pick `--field` from its documented schema. If Workers AI adds
support for images as a proper array (not just a single reference), or a
model needs a request shape this script doesn't support (e.g. `flux-2-dev`'s
`multipart/form-data` requirement — see the investigation doc), that would
need actual script changes, not just new flags.
