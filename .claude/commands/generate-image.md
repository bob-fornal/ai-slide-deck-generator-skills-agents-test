---
description: Generate a slide image from a context statement via the deployed Cloudflare Worker
argument-hint: <context statement> [--type=jpeg|png] [--size=WxH] [--model=<workers-ai-model-id>] [--filename=path]
---

Generate an image by calling the deployed Cloudflare Worker (`src/worker.js`),
using the context statement and options in: $ARGUMENTS

## Parsing $ARGUMENTS

Everything in $ARGUMENTS is the context statement (the image prompt) **except**
these optional `--flag=value` tokens, which may appear anywhere and must be
stripped out of the prompt text before sending it:

- `--type=jpeg|png` — selects the generation model. `jpeg` (default) uses
  `@cf/black-forest-labs/flux-1-schnell`; `png` uses
  `@cf/stabilityai/stable-diffusion-xl-base-1.0`. Ignored if `--model` is also given.
- `--model=<id>` — overrides `--type` with a raw Workers AI model id, for
  anyone who wants a model other than the two above.
- `--size=WxH` — e.g. `--size=1024x768`. Splits into `width`/`height` integers
  in the request body. **Only `png`/stable-diffusion-xl honors this** — flux
  ignores width/height and always returns a fixed-size image. If `--size` is
  passed with `--type=jpeg` (or no type), tell the user it will be ignored by
  the model, but still send the request.
- `--filename=path` — where to save the resulting image locally. If omitted,
  derive one as `generated-<unix-timestamp>.<ext>`, where `<ext>` is `jpg` for
  the jpeg/flux path or `png` for the png/sdxl path. If the user's filename has
  no extension, append the correct one for the chosen type.

If no context statement text remains after stripping flags, stop and ask the
user for one — don't call the API with an empty prompt.

## Calling the Worker

1. Read `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_API_TOKEN` from `.env` in the
   project root (e.g. `source .env` in the same Bash call that does the
   `curl`, or read the file directly) — never print the token's value, and
   don't put it in a message to the user.
2. Build the JSON body: `{ "prompt": ..., "model": ..., "width"?: ..., "height"?: ... }`
   (omit `width`/`height` entirely if no `--size` was given). Build this
   safely (e.g. via a small `node -e` one-liner using `JSON.stringify`, or a
   heredoc) rather than hand-splicing the prompt string into JSON, since the
   prompt may contain quotes.
3. POST it:
   ```
   curl -s -D <headers-tmpfile> -o <output-path> -X POST "$CLOUDFLARE_WORKER_URL" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -d @<payload-tmpfile>
   ```
4. Check the response status from the headers file:
   - `200` — confirm the saved file with `file <output-path>` (should report a
     JPEG or PNG, not text) and report the filename and size to the user.
   - `401` — the bearer token doesn't match the Worker's `CLOUDFLARE_API_TOKEN`
     secret; tell the user to check `.env` against `wrangler secret put CLOUDFLARE_API_TOKEN`.
   - `400`/`502` — report the response body text (it describes the failure)
     without re-attempting silently.
5. Clean up any temp files you created for the headers/payload.

Do not deploy or modify the Worker as part of running this command — it only
calls the already-deployed endpoint.
