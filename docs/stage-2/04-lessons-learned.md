# Lessons Learned (the "aha" moments worth pausing on)

## 1. "It's in the code" is not the same claim as "it's live"

Stage 1's own PRD noted that width/height forwarding existed in
`src/worker.js` but "needs a fresh deploy before it's live" — and then
Stage 2 began by testing the live Worker anyway, rather than trusting that
note or re-reading the source. The result: still `1024x1024` for a
`1024x768` request, a full stage after the code was written. The gap
between "the logic exists" and "the logic is running where callers
actually hit it" is exactly the kind of thing that's invisible from source
alone — worth a live demo: read the code, predict the output, then run the
actual request and compare.

## 2. A vendor's own docs can be flatly wrong, not just imprecise

The original plan was cautious by design: read Cloudflare's documented
schema for stable-diffusion-xl-base-1.0 before writing any code, rather
than guess. That schema listed `image` and `image_b64` as supported img2img
inputs. Neither worked — the live model returns `"input tensor 'image' is
not present in the model"` for both, and a Cloudflare GitHub issue
([#11835](https://github.com/cloudflare/cloudflare-docs/issues/11835))
confirms this is a known gap between what's documented and what's actually
implemented. "Read the docs first" is good practice, but it's not the same
guarantee as "test it live" — this project had already learned that lesson
once, about its *own* code (#1 above), and then re-learned a sharper
version of it about a *third party's* code. The fix wasn't cleverer
parameter names; it was accepting that this particular capability doesn't
exist yet on the model everyone assumed it would.

## 3. A named, human-friendly size ("A4") can silently mean several different resolutions

"A4" colloquially means print resolution (2480x3506 at 300dpi) — but the
image model behind `scene-generator` caps out at 2048px per side, *and*
(discovered only through live testing, not documented anywhere) requires
both dimensions to be a multiple of 8. Getting from "2480x3506" to a
working request took two separate corrections, not one: first clamp to the
2048 ceiling, then round to a valid multiple of 8 — a naive single-step
clamp produces `1449x2048`, which still 502s, because 1449 isn't a
multiple of 8. The final answer, `1448x2048`, is "A4-shaped," not
"A4-resolution" — a distinction worth stating out loud to anyone using
`scene-generator`, rather than letting them discover it by measuring the
output file.

## 4. An environment-variable name collision can look exactly like a broken credential

The initial diagnosis of the `wrangler login` failure was "a stale cached
Cloudflare session" — a reasonable guess, since `wrangler deploy
--dry-run` proved the Worker code itself was sound, and the error
("invalid Authorization header") is exactly what a corrupted token looks
like. The real cause was different and more interesting: this project's
own `.env` defined `CLOUDFLARE_API_TOKEN` as its own app-level bearer
secret, and wrangler *also* reads an environment variable of that exact
name for real Cloudflare account authentication. Once that name leaked
into the shell environment, wrangler tried to authenticate with a value
that was never meant to be a Cloudflare account token at all. The fix
(renaming this project's local variables to `PROD_`-prefixed) had nothing
to do with logging in again — it was a naming collision, not a stale
credential. Two very different diagnoses can produce an identical-looking
symptom; the wrong one just happens to also have a plausible-sounding fix
("log in again") that doesn't address the actual cause.

## 5. Clearing one blocker can reveal a second, unrelated one behind it

Fixing the `wrangler login` collision (#4) felt like it should unblock
everything — deploy, then re-test size and reference images, done. Instead
it unblocked exactly one of those two: size clamping now works end to end,
but reference images hit an entirely separate wall (`5018`, an account-
access restriction on the one model that actually implements img2img).
Neither this project's code nor the earlier environment-variable fix had
anything to do with that second wall. Worth naming explicitly: "the thing
that was blocking me is fixed" is not the same claim as "the feature now
works," and a workshop audience watching this unfold live gets a genuine,
unscripted example of exactly that gap.

## 6. Three Agents can share one Skill without three copies of the same logic

The temptation, given "three agents that use the skill," is to write the
Skill once and then let each Agent duplicate a slightly-modified copy of
its instructions "just to be safe." Here, each Agent file is short
specifically because it says nothing about *how* to parse flags or call
the Worker — only *which* flags it fixes, requires, or constrains. That
division (Skill owns mechanics, Agent owns policy) is the reusable pattern
worth naming explicitly in a workshop, since it's what makes adding a
fourth Agent later cheap.
