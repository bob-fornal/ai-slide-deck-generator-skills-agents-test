# PRD: AI Slide Deck Image Generation (Skills/Agents Test)

## 1. Summary

This is a small test harness that lets Claude generate an image for a slide deck by
sending a **context statement** (what the image should depict) plus **configuration
information** (style, model, one or more reference images, etc.) to a **Cloudflare
Worker** backed by Workers AI, and getting an image back. It is a proving ground for
an image-generation capability being wrapped as a Claude Skill, driven by three
purpose-specific Agents, inside the broader `ai-slide-deck-generator` project.

This PRD now covers two stages (see `docs/` for the narrative/build-log write-up
of each):

- **Stage 1** — prove the end-to-end path (Claude → Worker → Workers AI → image
  bytes) works at all, as a one-off slash command. Complete.
- **Stage 2** — convert that slash command's logic into a reusable `generate-image`
  Skill, add three Agents (`character-generator`, `item-generator`,
  `scene-generator`) that call it, add reference-image (img2img) support to the
  Worker, and confirm size is actually honored end to end. In progress — see
  §12.

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
- Prove out the request/response contract, then promote it into a formal Skill
  (Stage 2) that multiple purpose-specific Agents can share rather than each
  re-implementing the Worker call.
- Support conditioning generation on one or more local reference images, not just
  a text prompt (Stage 2).
- Confirm, with a real end-to-end call, that requested width/height are actually
  applied to the generated image — not just accepted without error (Stage 2).

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
- True multi-reference-image conditioning (e.g. ControlNet-style blending of
  several images at once). Workers AI's img2img input (`image`, an array of
  the raw file's byte values — confirmed live; `image_b64` is documented but
  not actually wired up, see §12) accepts a single image; when a caller
  supplies more than one reference image, only the first is used, and the
  caller is told so rather than it happening silently.

## 5. Current State

- [wrangler.toml](wrangler.toml) + [src/worker.js](src/worker.js) define and
  implement the deployed Worker: it validates a bearer token against the
  `CLOUDFLARE_API_TOKEN` secret, calls `env.AI.run(model, { prompt })`, and returns the
  image bytes. `wrangler deploy --dry-run` bundles cleanly with `env.AI` bound.
- [.env](.env) holds the real Worker URL and bearer token for the
  already-provisioned Worker (`ai-image-generator.bob-fornal.workers.dev`), as
  `PROD_CLOUDFLARE_WORKER_URL` / `PROD_CLOUDFLARE_API_TOKEN`. These are
  `PROD_`-prefixed deliberately, as of Stage 2: an ambient `CLOUDFLARE_API_TOKEN`
  in the shell environment collides with wrangler's own use of that exact name
  for Cloudflare account auth, and was breaking `wrangler login`/`wrangler
  deploy` until renamed. This is unrelated to the Worker's own secret (also
  named `CLOUDFLARE_API_TOKEN`, unprefixed, set via `wrangler secret put` and
  living on the Worker in Cloudflare, not in this repo) — same name, two
  different things, by coincidence of both being called "the Cloudflare API
  token." `.env.example` is kept in sync with the real `.env`'s naming; `.env`
  itself is gitignored.
- **Verified end-to-end**: with `src/worker.js` deployed and the
  `CLOUDFLARE_API_TOKEN` secret set, a POST with a valid prompt + bearer token
  returns `200 image/jpeg` (a genuine 1024x1024 JPEG from
  `@cf/black-forest-labs/flux-1-schnell`). Missing/incorrect auth returns
  `401`; a missing `prompt` returns `400`.
- [characters/](characters/) holds reference character art (`bob-001.svg`,
  `bob-002.jpg`, `bob-002.md`), presumably intended to keep a recurring character
  visually consistent across generated slide images. Not yet consumed by
  `src/worker.js` as a generation input for the character itself — see §12 for the
  new general-purpose reference-image support this stage adds.
- The project has no Python component. An earlier iteration explored a Python
  client script; it was removed once the Worker itself (`src/worker.js`) became
  the thing that needed building, since Claude can call an HTTP endpoint directly.
- `src/worker.js` forwards optional `width`/`height` from the request body to
  `env.AI.run`, clamped to stable-diffusion-xl's 256–2048px-per-side range and
  rounded to a multiple of 8 (added in Stage 2 — see §12). **Confirmed live**:
  deployed and re-tested after Stage 1's own gap was rediscovered (a direct
  test against the pre-Stage-2 deployed Worker showed a requested `1024x768`
  still coming back as `1024x1024`, confirming the width/height-forwarding
  code had existed in source since Stage 1 but was never actually redeployed).
  After deploying this stage's code, `widescreen` (`1920x1080`), `standard`
  (`1024x768`), and A4 (`2480x3506`, clamped to `1448x2048`) all now return
  the correct dimensions (§13).
- [.claude/commands/generate-image.md](.claude/commands/generate-image.md)
  originally implemented a `/generate-image` slash command directly; as of
  Stage 2 it's a thin wrapper that delegates to the
  [.claude/skills/generate-image/SKILL.md](.claude/skills/generate-image/SKILL.md)
  Skill, which now owns the parsing/calling logic so Agents can share it too.

## 6. Proposed Flow

This is the Worker-level contract; §12 describes how Stage 2's Skill and three
Agents sit on top of it.

1. **Input**: Claude receives (from the user or from the slide-deck pipeline) a
   *context statement* — e.g. "Bob explaining a database migration, whiteboard
   background" — and optional *configuration*: model name, size, and/or one or
   more reference images to condition on.
2. **Prompt assembly**: Claude merges the context statement with configuration
   defaults into the JSON payload the Worker expects:
   `{ prompt, model?, width?, height?, images? }`.
3. **Dispatch**: Claude POSTs that payload to `PROD_CLOUDFLARE_WORKER_URL`
   (from `.env`), with `PROD_CLOUDFLARE_API_TOKEN`'s value sent as a bearer
   credential. Credentials and the endpoint URL are read only from `.env`,
   never hard-coded or echoed into chat.
4. **Generation**: `src/worker.js` (edge-side) receives the request and calls
   `env.AI.run(model, params)` using the Workers AI binding, selecting from
   the available image models (e.g. Flux/Stable-Diffusion-class models hosted
   by Workers AI). `params` includes `prompt` always, `width`/`height` when the
   model honors them (clamped to 256–2048px and a multiple of 8), and `image`
   (the first entry of `images`, if any, as a raw byte array) only when the
   resolved model is `@cf/runwayml/stable-diffusion-v1-5-img2img` — currently
   the only model that actually implements image input, and one this account
   can't yet reach (§12, §13).
5. **Response**: The Worker returns image bytes (PNG/JPEG) in the HTTP response.
   The caller (Claude, or `curl --output`) writes them to disk.
6. **Handback**: Claude confirms the image was generated and surfaces the file to
   the user (or hands it to the next stage of the slide-deck pipeline).

## 7. Functional Requirements

| # | Requirement |
|---|---|
| 1 | `.env` must define a Worker URL and bearer-token variable (currently `PROD_CLOUDFLARE_WORKER_URL` / `PROD_CLOUDFLARE_API_TOKEN` — see §5 for why they're `PROD_`-prefixed); both are required before a request is attempted. |
| 2 | The Worker must reject requests with a missing/incorrect bearer token (401) and a missing prompt (400), rather than silently generating a default image. |
| 3 | The image request must support at minimum: prompt text, an optional model identifier (defaulting to `@cf/black-forest-labs/flux-1-schnell`), and optional width/height for models that support sized output. |
| 4 | The image request must support an optional array of reference images (`images`) for models/endpoints that accept image-conditioned generation. Implemented in Stage 2: the first entry is forwarded as `image` (a raw byte array) only when the resolved model is `@cf/runwayml/stable-diffusion-v1-5-img2img`, the sole model confirmed to actually implement image input; every other model, including stable-diffusion-xl despite its docs, ignores it. This account currently can't reach that model at all (`5018` access error) — see §12/§13. |
| 5 | Non-200 responses from the Worker must carry a body describing the failure (auth, validation, or upstream AI error), not just a bare status code. |
| 6 | No secret values (bearer token) are ever included in logs, filenames, or returned to Claude's context beyond confirmation that a call succeeded/failed. |
| 7 | Requested width/height must be clamped (preserving aspect ratio) to whatever range the target model actually supports, rather than passed through unchecked and left to fail upstream. Implemented in Stage 2 for stable-diffusion-xl's documented 256–2048px-per-side range. |
| 8 | The request/response contract must be reusable by more than one caller without duplicating the parsing/calling logic. Implemented in Stage 2 as the `generate-image` Skill, called by the `/generate-image` slash command and by all three Agents. |
| 9 | Each Agent that generates images must be explicit, in its own definition, about which of `--type`/`--size` are fixed defaults versus required caller inputs — no Agent should silently guess a default the way `character-generator` intentionally does. |

## 8. Configuration Surface (`.env`)

| Variable | Required | Purpose |
|---|---|---|
| `PROD_CLOUDFLARE_WORKER_URL` | Yes | The deployed Worker's HTTPS endpoint. |
| `PROD_CLOUDFLARE_API_TOKEN` | Yes | Bearer token sent as `Authorization: Bearer <token>`; must match the Worker's `CLOUDFLARE_API_TOKEN` secret (see below — different name, same underlying idea, deliberately not the same name). |
| `CLOUDFLARE_ACCOUNT_ID` | No | Only needed if something calls the Cloudflare REST API directly instead of the deployed Worker route. Currently unused. |

**Why `PROD_`-prefixed, not just `CLOUDFLARE_WORKER_URL`/`CLOUDFLARE_API_TOKEN`
as Stage 1 originally used**: `wrangler` (the Cloudflare CLI) itself reads an
ambient `CLOUDFLARE_API_TOKEN` environment variable for its own Cloudflare
account authentication. When this project's `.env` also defined a
`CLOUDFLARE_API_TOKEN` (this project's own bearer secret, unrelated to
wrangler's account-level token) and that got exported into the shell,
`wrangler login`/`wrangler deploy` failed with an invalid-Authorization-header
error. Renaming this project's local `.env` variables to `PROD_`-prefixed
removes the collision. The Worker's own secret — set via `wrangler secret put
CLOUDFLARE_API_TOKEN` and read in `src/worker.js` as `env.CLOUDFLARE_API_TOKEN`
— is a separate thing entirely and keeps its original unprefixed name; only
the local `.env` variable names changed.

## 9. Open Questions / Assumptions

- **Model selection**: which Workers AI image model(s) should be supported
  (e.g. `@cf/black-forest-labs/flux-1-schnell`, `@cf/stabilityai/stable-diffusion-xl-base-1.0`)?
  `src/worker.js` currently defaults to flux-1-schnell and handles both known
  response shapes (base64 JSON vs. raw binary stream), but the model catalog
  should be revisited periodically.
- **Character reference usage — now mostly answered, negatively**:
  `character-generator` (Stage 2) is fixed to the jpeg/flux path, which has no
  image-input capability at all — but this turns out not to matter today,
  since *no* model this account can reach actually implements image input
  (confirmed live; see §12). Switching character-generation to sdxl wouldn't
  unlock anything. Whether `characters/` art should condition generation at
  all is now entirely contingent on the img2img account-access question below.
- **Wrangler auth — resolved**: `wrangler whoami` initially failed with an
  invalid Authorization header. Root cause turned out to be an ambient
  `CLOUDFLARE_API_TOKEN` shell variable colliding with wrangler's own use of
  that exact name for Cloudflare account auth (see §8) — not a stale cached
  login. Renaming this project's `.env` variables to `PROD_`-prefixed and
  re-running `wrangler login` fixed it; Stage 2's Worker changes are now
  deployed and confirmed live (§13).
- **A4 fidelity**: is a same-aspect-ratio downscale (`1448x2048` instead of true
  `2480x3506`) an acceptable stand-in for "A4," or does a later stage need actual
  print-resolution output (which would require a different model/service
  entirely, since stable-diffusion-xl caps at 2048px per side)?
- **img2img — three possible unblocks, one actionable now**: a follow-up
  investigation (see
  [docs/stage-2/06-reference-image-investigation.md](docs/stage-2/06-reference-image-investigation.md))
  tested every accessible Workers AI Text-to-Image model against a real
  reference image and a same-seed control, and found that
  `stable-diffusion-xl-lightning` and `dreamshaper-8-lcm` also fail to
  condition on a reference image despite returning `200` — visually
  confirmed, not just status-code-confirmed. Three paths forward, not two:
  (1) implement multipart request support for `@cf/black-forest-labs/flux-2-dev`,
  which explicitly advertises multi-reference support and *is* accessible on
  this account — the only one of the three that's actionable without waiting
  on Cloudflare; (2) request account access to `stable-diffusion-v1-5-img2img`;
  (3) wait for Cloudflare to fix the stable-diffusion-xl documented-vs-actual
  gap. (1) is the recommended next step.

## 10. Risks

- Without rate limiting/cost caps, repeated test calls could incur unexpected
  Workers AI usage costs.
- Secret names must stay in sync between the Worker source (`env.CLOUDFLARE_API_TOKEN`
  in `src/worker.js`) and whatever's actually set via `wrangler secret put` on
  the live Worker — a mismatch fails closed (500), which is safe but easy to
  overlook after a rename like this one.
- Source and live-deployed code can silently drift: Stage 1's width/height
  forwarding sat in `src/worker.js` for a full stage without ever being
  redeployed, so "confirmed in code" was mistaken for "confirmed live" until
  Stage 2 re-tested the actual deployed endpoint and found it still returning
  1024x1024 regardless of the request. Any future "confirmed" claim in this PRD
  should mean tested against the live Worker, not just read from source.
- Local tooling env vars can collide with unrelated, same-named vars a CLI
  reads for its own purposes: this project's own `CLOUDFLARE_API_TOKEN` (a
  bearer secret with no connection to any Cloudflare account) broke `wrangler
  login`/`wrangler deploy`, which read the identically-named env var for
  actual Cloudflare account authentication. Fixed by renaming this project's
  local `.env` variables to `PROD_`-prefixed (§8) — but the underlying lesson
  (don't assume a plausible-sounding env var name is safe to reuse) applies
  beyond just this one variable.
- A vendor's own documentation can be wrong about what its API actually does:
  stable-diffusion-xl-base-1.0's Cloudflare docs list `image`/`image_b64` as
  supported img2img inputs; live testing shows the deployed model rejects
  both. Any future integration against a third-party API documented but not
  yet exercised live should be treated as unconfirmed until tested.

## 11. Success Criteria

### Stage 1 (complete)

- ✅ Claude can take a plain-language context statement, POST it to the deployed
  Worker, and receive back real image bytes — end to end, using the real
  credentials in `.env` and the real secret configured on the Worker.
- ✅ Failure modes (missing/incorrect auth, missing prompt) return the right
  status codes (401/400) with a body describing the failure.
- ✅ The request/response contract is stable enough to be lifted into a formal
  Claude Skill for the slide-deck generator.

### Stage 2 (see §12, §13)

- ✅ The `/generate-image` slash command's logic is lifted into a reusable
  `generate-image` Skill, called by the slash command and by three Agents.
- ✅ `character-generator`, `item-generator`, and `scene-generator` exist as
  distinct Agents with the size/type behavior specified in this stage.
- ✅ `src/worker.js` clamps requested width/height to the target model's actual
  supported range (256–2048px) and to a valid multiple of 8, instead of
  passing them through unchecked.
- ✅ **Confirmed live**: requested size is genuinely applied to the returned
  image for stable-diffusion-xl (`widescreen`/`standard`/A4 all verified
  against the deployed Worker — §13).
- ❌ **Not met, and not currently achievable on this account**: a reference
  image changing the generated output. `src/worker.js` correctly implements
  the one API contract that could do this (`image` on
  `@cf/runwayml/stable-diffusion-v1-5-img2img`), but that model returns a
  `5018` account-access error live, and the model this project originally
  assumed would work (stable-diffusion-xl, per its own Cloudflare docs)
  doesn't actually accept image input at all. This is an external platform/
  account limitation, not an implementation gap — see §12, §13, and the
  open question in §9.

## 12. Stage 2: Skill + Three Agents + Reference Images

### Why convert the slash command into a Skill

Stage 1's `/generate-image` slash command worked, but it was the only caller of
the Worker, with its parsing/calling logic written once for that one entry
point. Stage 2 needs three different callers (see below) that each want
slightly different size/type rules layered on top of the same underlying
"call the Worker" logic. Duplicating that logic three times would mean any
future Worker contract change (a new field, a changed error format) has to be
hunted down and fixed in three places instead of one.

[.claude/skills/generate-image/SKILL.md](.claude/skills/generate-image/SKILL.md)
is now that one place: it owns argument parsing (`--type`/`--model`/`--size`/
`--filename`/`--image`), `.env` credential handling, the JSON body shape, the
`curl` call, and response-status handling. The slash command
([.claude/commands/generate-image.md](.claude/commands/generate-image.md)) is
now a one-line delegator to it, preserved so a person can still type
`/generate-image ...` directly without going through an Agent.

### The three Agents

Each Agent has a distinct, deliberate stance on where `--type`/`--size` come
from — this is the actual design requirement for this stage, not an
implementation detail:

| Agent | `--type` | `--size` |
|---|---|---|
| [character-generator](.claude/agents/character-generator.md) | Fixed: `jpg` (flux) | Fixed: `300x1200` (matches how `characters/bob-002.jpg` was generated; ignored by flux regardless — kept for reproducibility) |
| [item-generator](.claude/agents/item-generator.md) | Required from caller — never defaulted | Required from caller — never defaulted |
| [scene-generator](.claude/agents/scene-generator.md) | Required from caller — never defaulted | Chosen from a fixed list: `widescreen` (`1920x1080`), `standard` (`1024x768`), `A4` (`2480x3506`) — no other value accepted |

All three call the same `generate-image` Skill; none of them talk to the
Worker directly.

### Reference images (`images`) — implemented per the API contract, blocked by the platform

`src/worker.js` accepts an optional `images` array of base64-encoded strings
in the request body. The design intent (Functional Requirement #4, §7): if
present, forward the **first** entry as an img2img reference image, so
generation can be conditioned on a local reference image rather than prompt
text alone.

The first implementation attempt followed Cloudflare's own documentation for
`stable-diffusion-xl-base-1.0`, which lists both `image` (a byte array) and
`image_b64` (a base64 string) as supported img2img inputs. **Both failed
live**, with `502: ... input tensor 'image' is not present in the model` —
a known, confirmed Cloudflare docs/platform gap, not a mistake in this
project's request shape
([cloudflare/cloudflare-docs#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835);
community reports of the identical error corroborate it).

The actual dedicated img2img model, `@cf/runwayml/stable-diffusion-v1-5-img2img`,
does document the same `image`/`image_b64` inputs — but this Cloudflare
account gets `5018: This account is not allowed to access
@cf/runwayml/stable-diffusion-v1-5-img2img` when it's targeted directly.

**Current, confirmed-live implementation**: `src/worker.js` forwards
`images[0]` as `image` (a raw byte array, decoded from the base64 string
the caller sent) *only* when the resolved model is exactly
`@cf/runwayml/stable-diffusion-v1-5-img2img`. For every other model —
including flux (no image input at all) and sdxl (documented but broken) —
`images` is silently ignored, the same way an unsupported `width`/`height`
already was. This means, today, supplying `--image` produces a working
text-only generation regardless of `--type`, and only an explicit
`--model=@cf/runwayml/stable-diffusion-v1-5-img2img` override actually
attempts image conditioning — which then surfaces the real `5018` error
rather than a confusing tensor error. Every layer that surfaces this to a
caller (Skill, `item-generator`, `scene-generator`, `character-generator`)
says so explicitly rather than implying reference images currently work.

If access is ever granted (or Cloudflare fixes the sdxl gap), the "only the
first image is used" constraint documented for Functional Requirement #4
still applies — Workers AI's img2img input takes one image, not several,
confirmed from both models' documented schemas.

### Size clamping

`src/worker.js` clamps any requested `width`/`height` to stable-diffusion-xl's
documented 256–2048px-per-side range, **and rounds both to a multiple of 8**,
before forwarding to `env.AI.run`, scaling both dimensions together to
preserve the requested aspect ratio.

The multiple-of-8 rounding was not part of the original design — it was
discovered through live testing partway through this stage. The initial
clamp (range-only) passed `1024x768`, `1920x1080` fine, but a direct test of
an arbitrary non-multiple-of-8 size (`1023x1023`) returned the same opaque
`502`/triton error as the unclamped-size bug this stage set out to fix in
the first place. Bisecting confirmed the real constraint is exactly
"multiple of 8" (`1000x1000` succeeds, `1004x1004` fails) — the standard
diffusion-model latent-space constraint, undocumented by Cloudflare for this
model. `scene-generator`'s "A4" option (`2480x3506`, true print resolution)
now clamps to `1448x2048` (both range- and step-corrected) instead of either
erroring outright or clamping to an in-range-but-invalid `1449x2048`.
`widescreen` (`1920x1080`) and `standard` (`1024x768`) were already valid on
both counts and pass through unchanged.

## 13. Verification Status (Stage 2)

- ✅ **Bundling**: `wrangler deploy --dry-run` bundles the final
  `src/worker.js` cleanly with `env.AI` bound (3.54 KiB / gzip 1.25 KiB).
- ⚠️ **Model schemas initially taken from Cloudflare's own docs, then
  corrected by live testing**: stable-diffusion-xl-base-1.0's docs list
  `width`/`height` (256–2048) and `image`/`image_b64` (single image, img2img)
  as supported. `width`/`height` turned out to be accurate (once the
  undocumented multiple-of-8 requirement was also accounted for); `image`/
  `image_b64` turned out to be **wrong** — see below. flux-1-schnell's docs
  (only `prompt`, `steps`, `seed` — no size, no image input) held up
  unchanged.
- ✅ **Wrangler auth fixed and Stage 2's Worker deployed**: root cause was an
  ambient `CLOUDFLARE_API_TOKEN` shell variable colliding with wrangler's own
  use of that name (§8, §9) — fixed by renaming this project's `.env`
  variables to `PROD_`-prefixed. `wrangler login` then `wrangler deploy`
  succeeded; the live Worker now runs this stage's code.
- ✅ **Size, confirmed live against the deployed Worker**: `widescreen`
  (`1920x1080`) and `standard` (`1024x768`) both come back at exactly the
  requested dimensions; A4 (`2480x3506`) comes back clamped to `1448x2048`.
  This directly resolves the Stage 1 PRD's unresolved note and the "not yet
  met" item this PRD carried earlier in Stage 2 (the pre-fix deployed Worker
  was re-tested first and confirmed still returning `1024x1024` regardless
  of request, matching that original note, before the fix was deployed).
- ❌ **Reference images do not work, live, on any model this account can
  reach** — this is the one Stage 2 goal not achieved, and it's an external
  limitation rather than a bug in this project:
  - `stable-diffusion-xl-base-1.0` + `image`/`image_b64` → `502: ... input
    tensor 'image' is not present in the model` (documented-vs-actual gap,
    see §12).
  - `@cf/runwayml/stable-diffusion-v1-5-img2img` (the model that actually
    implements it) → `502: 5018: This account is not allowed to access
    @cf/runwayml/stable-diffusion-v1-5-img2img`.
  - `src/worker.js`'s handling is nonetheless correct per the documented API
    contract (forward `images[0]` as `image` only for the img2img model);
    nothing here is a code defect to fix, only a platform/account gate to
    resolve (§9).
- ✅ **Broader model survey completed**: every accessible model in the
  [Workers AI Text-to-Image catalog](https://developers.cloudflare.com/workers-ai/models/?tasks=Text-to-Image)
  (11 models as of this writing) was tested live for access and, where
  relevant, for genuine reference-image conditioning (not just a non-error
  response — see the visual same-seed comparisons in
  [docs/stage-2/06-reference-image-investigation.md](docs/stage-2/06-reference-image-investigation.md)).
  Two more models (`stable-diffusion-xl-lightning`, `dreamshaper-8-lcm`)
  were found to accept an `image`/`image_b64` field without erroring while
  not actually conditioning on it. `@cf/black-forest-labs/flux-2-dev`
  emerged as the strongest lead for real reference-image support (see §9),
  and `@cf/leonardo/lucid-origin` as a worthwhile sdxl alternative for
  general sized text-to-image generation (§9, next-steps doc).
