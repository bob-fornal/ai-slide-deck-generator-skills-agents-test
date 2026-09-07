# PRD: AI Slide Deck Image Generation (Skills/Agents Test)

## 1. Summary

This is a small test harness that lets Claude generate an image for a slide deck by
sending a **context statement** (what the image should depict) plus **configuration
information** (style, model, character reference, etc.) to a **Cloudflare Worker**
backed by Workers AI, and getting an image back. It is a proving ground for an
image-generation capability that will later be wrapped as a Claude Skill/Agent
inside the broader `ai-slide-deck-generator` project.

## 2. Problem / Motivation

The slide deck generator needs slide-specific imagery (e.g., a consistent narrator
character, diagrams, thematic backgrounds) without a human manually sourcing or
generating each image. Cloudflare Workers AI exposes hosted image models
(via the `AI` binding) cheaply and at low latency. This project validates the
simplest possible path: Claude → Worker endpoint → Workers AI model → image bytes.

## 3. Goals

- Let Claude turn a plain-language context statement into a generated image without
  the user leaving the conversation.
- Support basic configuration per request: target model and (optionally) a
  reference character image for visual consistency.
- Keep credentials (Cloudflare API token) out of source and out of Claude's prompt
  context, loaded only from `.env` at runtime.
- Prove out the request/response contract before it's promoted into a formal Skill.

## 4. Non-Goals

- Building the full slide-deck-generator pipeline (slide layout, text generation,
  deck assembly) — out of scope here.
- Multi-turn image editing/refinement, batching, or a queue/job system.
- A production-grade Worker deployment (rate limiting, retries, observability) —
  this is a test project, not the shipped service.
- A UI. This is invoked programmatically (by Claude, or `curl`), not by an end
  user through a web form.
- A dedicated client script/SDK. Claude (or any HTTP client) calls the deployed
  Worker directly; there is deliberately no intermediary process to maintain.

## 5. Current State

- [wrangler.toml](wrangler.toml) + [src/worker.js](src/worker.js) define and
  implement the deployed Worker: it validates a bearer token against the
  `CLOUDFLARE_API_TOKEN` secret, calls `env.AI.run(model, { prompt })`, and returns the
  image bytes. `wrangler deploy --dry-run` bundles cleanly with `env.AI` bound.
- [.env](.env) holds the real `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_API_TOKEN`
  for the already-provisioned Worker (`ai-image-generator.bob-fornal.workers.dev`);
  the matching secret is set on the Worker in Cloudflare, not in this repo.
  `.env.example` documents the required shape without real values; `.env` itself
  is gitignored.
- **Verified end-to-end**: with `src/worker.js` deployed and the
  `CLOUDFLARE_API_TOKEN` secret set, a POST with a valid prompt + bearer token
  returns `200 image/jpeg` (a genuine 1024x1024 JPEG from
  `@cf/black-forest-labs/flux-1-schnell`). Missing/incorrect auth returns
  `401`; a missing `prompt` returns `400`.
- [characters/bob-bald-001.jpg](characters/bob-bald-001.jpg) is a reference image,
  presumably intended to keep a recurring character visually consistent across
  generated slide images. Not yet consumed by `src/worker.js`.
- The project has no Python component. An earlier iteration explored a Python
  client script; it was removed once the Worker itself (`src/worker.js`) became
  the thing that needed building, since Claude can call an HTTP endpoint directly.
- `src/worker.js` also forwards optional `width`/`height` from the request body
  to `env.AI.run`. Confirmed `@cf/stabilityai/stable-diffusion-xl-base-1.0`
  works via the `model` override (real 200 `image/png`); the `width`/`height`
  forwarding itself needs a fresh deploy before it's live.
- [.claude/commands/generate-image.md](.claude/commands/generate-image.md)
  adds a `/generate-image` slash command so a context statement plus
  `--type`/`--size`/`--filename` options can be turned into a saved image
  without hand-writing a `curl` call each time.

## 6. Proposed Flow

1. **Input**: Claude receives (from the user or from the slide-deck pipeline) a
   *context statement* — e.g. "Bob explaining a database migration, whiteboard
   background" — and optional *configuration*: model name, and/or a character
   reference image to condition on.
2. **Prompt assembly**: Claude merges the context statement with configuration
   defaults into the JSON payload the Worker expects: `{ prompt, model? }`.
3. **Dispatch**: Claude POSTs that payload to `CLOUDFLARE_WORKER_URL` (from
   `.env`), with `CLOUDFLARE_API_TOKEN` sent as a bearer credential. Credentials
   and the endpoint URL are read only from `.env`, never hard-coded or echoed
   into chat.
4. **Generation**: `src/worker.js` (edge-side) receives the request and calls
   `env.AI.run(model, { prompt })` using the Workers AI binding, selecting from
   the available image models (e.g. Flux/Stable-Diffusion-class models hosted
   by Workers AI).
5. **Response**: The Worker returns image bytes (PNG/JPEG) in the HTTP response.
   The caller (Claude, or `curl --output`) writes them to disk.
6. **Handback**: Claude confirms the image was generated and surfaces the file to
   the user (or hands it to the next stage of the slide-deck pipeline).

## 7. Functional Requirements

| # | Requirement |
|---|---|
| 1 | `.env` must define `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_API_TOKEN`; both are required before a request is attempted. |
| 2 | The Worker must reject requests with a missing/incorrect bearer token (401) and a missing prompt (400), rather than silently generating a default image. |
| 3 | The image request must support at minimum: prompt text, an optional model identifier (defaulting to `@cf/black-forest-labs/flux-1-schnell`), and optional width/height for models that support sized output. |
| 4 | The image request should eventually support an optional reference image (from `characters/`) for models/endpoints that accept image-conditioned generation. Not yet implemented. |
| 5 | Non-200 responses from the Worker must carry a body describing the failure (auth, validation, or upstream AI error), not just a bare status code. |
| 6 | No secret values (bearer token) are ever included in logs, filenames, or returned to Claude's context beyond confirmation that a call succeeded/failed. |

## 8. Configuration Surface (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `CLOUDFLARE_WORKER_URL` | Yes | The deployed Worker's HTTPS endpoint. |
| `CLOUDFLARE_API_TOKEN` | Yes | Bearer token sent as `Authorization: Bearer <token>`; must match the Worker's `CLOUDFLARE_API_TOKEN` secret. |
| `CLOUDFLARE_ACCOUNT_ID` | No | Only needed if something calls the Cloudflare REST API directly instead of the deployed Worker route. Currently unused. |

## 9. Open Questions / Assumptions

- **Model selection**: which Workers AI image model(s) should be supported
  (e.g. `@cf/black-forest-labs/flux-1-schnell`, `@cf/stabilityai/stable-diffusion-xl-base-1.0`)?
  `src/worker.js` currently defaults to flux-1-schnell and handles both known
  response shapes (base64 JSON vs. raw binary stream), but the model catalog
  should be revisited periodically.
- **Character reference usage**: is `characters/bob-bald-001.jpg` meant for
  image-to-image conditioning, a style/likeness reference passed as a second
  input, or just a placeholder asset for now?

## 10. Risks

- Without rate limiting/cost caps, repeated test calls could incur unexpected
  Workers AI usage costs.
- Secret names must stay in sync between the Worker source (`env.CLOUDFLARE_API_TOKEN`
  in `src/worker.js`) and whatever's actually set via `wrangler secret put` on
  the live Worker — a mismatch fails closed (500), which is safe but easy to
  overlook after a rename like this one.

## 11. Success Criteria (for this test phase)

- ✅ Claude can take a plain-language context statement, POST it to the deployed
  Worker, and receive back real image bytes — end to end, using the real
  credentials in `.env` and the real secret configured on the Worker.
- ✅ Failure modes (missing/incorrect auth, missing prompt) return the right
  status codes (401/400) with a body describing the failure.
- The request/response contract is stable enough to be lifted into a formal
  Claude Skill for the slide-deck generator.
