---
name: generate-image
description: Generate an image — optionally conditioned on one or more local reference images — from a context statement, via the deployed Cloudflare Worker backed by Workers AI. Use whenever any agent or command needs to produce a character, item, or scene image for this project.
---

Generate an image by calling the deployed Cloudflare Worker (`src/worker.js`),
using the context statement and options given in the invocation's arguments
(`$ARGUMENTS` if invoked as a slash command; the caller's stated arguments if
invoked by another agent).

This skill is the single place that knows how to talk to the Worker. Agents
that need an image (`character-generator`, `item-generator`,
`scene-generator`) should invoke this skill rather than re-implementing the
`curl` call themselves.

## Parsing the arguments

Everything in the arguments is the context statement (the image prompt)
**except** these optional `--flag=value` tokens, which may appear anywhere
and must be stripped out of the prompt text before sending it:

- `--type=jpeg|png` — selects the generation model. `jpeg` (default) uses
  `@cf/black-forest-labs/flux-1-schnell`; `png` uses
  `@cf/stabilityai/stable-diffusion-xl-base-1.0`. Ignored if `--model` is
  also given.
- `--model=<id>` — overrides `--type` with a raw Workers AI model id, for
  anyone who wants a model other than the two above — including
  `@cf/runwayml/stable-diffusion-v1-5-img2img`, the only reachable way to
  even attempt reference-image conditioning (see the `--image` note below
  for why "attempt" is the right word right now).
- `--size=WxH` — e.g. `--size=1024x768`. Splits into `width`/`height`
  integers in the request body. **Only `png`/stable-diffusion-xl honors
  this** — flux ignores width/height and always returns a fixed 1024x1024
  image. If `--size` is passed with `--type=jpeg` (or no type), tell the
  caller it will be ignored by the model, but still send the request.
  The Worker also clamps width/height to stable-diffusion-xl's supported
  256–2048px-per-side range **and rounds both to a multiple of 8**
  (confirmed live — a non-multiple-of-8 size, e.g. `1023x1023`, fails
  upstream with an opaque `502`/triton error), preserving aspect ratio —
  e.g. a print-resolution A4 request (`2480x3506`) comes back scaled to
  `1448x2048` rather than erroring. Mention this to the caller whenever the
  requested size falls outside 256–2048 on either side, or isn't already a
  multiple of 8.
- `--seed=N` — an integer forwarded as-is to the model. **Confirmed live:
  flux rejects this the same way it rejects `--size`** — a hard `5006`
  error (`Additional or unevaluated properties '/seed'`), despite
  Cloudflare's own docs listing `seed` as a flux parameter (same
  docs-vs-reality gap as sdxl's `image`/`image_b64`; see `--image` below).
  If `--seed` is passed with `--type=jpeg`/flux, tell the caller it will be
  rejected, but still send the request. For models that do accept it
  (sdxl, sdxl-lightning, dreamshaper, the Leonardo models), **live testing
  found it does *not* reliably make output deterministic** — the same
  seed, prompt, model, and size produced different images (different
  checksums, different pixel content) across repeated calls for
  `stable-diffusion-xl-base-1.0` and `stable-diffusion-xl-lightning`. It
  had no effect at all (identical solid-black output regardless of seed)
  on `dreamshaper-8-lcm`, and no effect on Leonardo's NSFW prompt filter
  (which runs pre-generation, before any seed/noise is involved). Pass it
  when a caller explicitly wants to try pinning a result, but don't expect
  it to fix the flaky/black-output failure modes documented in
  `characters/model-comparison*.md`. Optional; omit `seed` from the
  request body entirely if not given.
- `--filename=path` — where to save the resulting image locally. If
  omitted, derive one as `generated-<unix-timestamp>.<ext>`, where `<ext>`
  is `jpg` for the jpeg/flux path or `png` for the png/sdxl path. If the
  caller's filename has no extension, append the correct one for the
  chosen type.
- `--image=path` (repeatable) — a local reference image to condition
  generation on. Collect every `--image=` occurrence, in the order given,
  read each file, and base64-encode it (e.g. `base64 -i <path>` on macOS,
  or a small `node -e` snippet — avoid loading huge files into a shell
  argument). Put the encoded strings into the JSON body's `images` array,
  in the same order.

  **Confirmed live: neither `--type=jpeg` nor `--type=png` can actually use
  a reference image right now.** flux has no image input at all. sdxl is
  *documented* by Cloudflare to accept one via `image`/`image_b64`, but that
  documentation is wrong in practice — it errors with `"input tensor
  'image' is not present in the model"`
  ([cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835)).
  The Worker therefore silently ignores `images` for both `--type` values,
  the same way flux already ignores `--size`.

  The only model that actually implements image input is
  `@cf/runwayml/stable-diffusion-v1-5-img2img` — reachable only via
  `--model=@cf/runwayml/stable-diffusion-v1-5-img2img` (there's no `--type`
  shortcut for it), and only the first `--image` given is ever used even
  then (Workers AI's img2img input takes one image, not several). As of
  this writing, **this Cloudflare account doesn't have access to that
  model** — Workers AI returns `5018: This account is not allowed to
  access @cf/runwayml/stable-diffusion-v1-5-img2img`. So: if the caller
  supplies `--image` without an explicit `--model=...img2img`, tell them
  plainly it will be ignored. If they do supply that `--model`, send the
  request anyway (access could be granted later, or Cloudflare could fix
  the sdxl gap) but expect and clearly relay a `5018` account-access error
  rather than treating it as a bug in this project's code.

If no context statement text remains after stripping flags, stop and ask
the user for one — don't call the API with an empty prompt.

## Calling the Worker

1. Read `PROD_CLOUDFLARE_WORKER_URL` and `PROD_CLOUDFLARE_API_TOKEN` from
   `.env` in the project root (e.g. `source .env` in the same Bash call
   that does the `curl`, or read the file directly) — never print the
   token's value, and don't put it in a message to the user. These are
   `PROD_`-prefixed deliberately (see `.env.example`'s header comment): an
   ambient `CLOUDFLARE_API_TOKEN` collides with wrangler's own use of that
   name for Cloudflare account auth, which is what broke `wrangler
   login`/`wrangler deploy` before the rename. This is unrelated to the
   Worker's own secret, `CLOUDFLARE_API_TOKEN` (unprefixed, set via
   `wrangler secret put` — see step 4).
2. Build the JSON body: `{ "prompt": ..., "model": ..., "width"?: ...,
   "height"?: ..., "seed"?: ..., "images"?: [...] }` (omit `width`/`height`
   entirely if no `--size` was given; omit `seed` entirely if no `--seed`
   was given; omit `images` entirely if no `--image` was given). Build this
   safely (e.g. via a small `node -e` one-liner using `JSON.stringify`, or
   a heredoc) rather than hand-splicing the prompt string or base64 blobs
   into JSON.
3. POST it:
   ```
   curl -s -D <headers-tmpfile> -o <output-path> -X POST "$PROD_CLOUDFLARE_WORKER_URL" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $PROD_CLOUDFLARE_API_TOKEN" \
     -d @<payload-tmpfile>
   ```
4. Check the response status from the headers file:
   - `200` — confirm the saved file with `file <output-path>` (should
     report a JPEG or PNG, not text) and report the filename and size to
     the caller.
   - `401` — `PROD_CLOUDFLARE_API_TOKEN`'s value doesn't match the Worker's
     `CLOUDFLARE_API_TOKEN` secret (two different names for two different
     things — see step 1); tell the caller to check `.env`'s token value
     against `wrangler secret put CLOUDFLARE_API_TOKEN`.
   - `400`/`502` — report the response body text (it describes the
     failure) without re-attempting silently.
5. Clean up any temp files you created for the headers/payload/base64
   encodings.

Do not deploy or modify the Worker as part of running this skill.
