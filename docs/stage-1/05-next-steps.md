# Next Steps (Where the Next Stage Picks Up)

These are deliberately left undone in this stage — either because they're
out of scope (see [PRD.md §4](../../PRD.md#4-non-goals)) or because they're
open questions the current work surfaced but didn't answer
([PRD.md §9](../../PRD.md#9-open-questions--assumptions)).

## Immediate follow-ups from this stage

- **Regenerate `characters/bob-002.jpg` with `--type=png`.** The build log shows
  five rounds of prompt iteration that never fully escaped the square-canvas
  crop. Switching to `--type=png --size=300x900` (stable-diffusion-xl, which
  actually honors size) is the fix that's been identified but not yet
  exercised for this specific asset.
- **Decide how `characters/` art actually conditions generation.** Right
  now it's a reference file sitting in the repo, unused by
  `src/worker.js`. Is it meant for image-to-image conditioning, a style
  reference passed as a second input, or just a placeholder? This has to be
  answered before a formal Skill can promise "consistent character across
  slides."

## Promoting this into a formal Claude Skill

The PRD's definition of done for this stage is a request/response contract
"stable enough to be lifted into a formal Claude Skill." Concretely, that
means:

- Wrapping the current `/generate-image` slash command's logic (flag
  parsing, `.env` credential handling, response-status branching) as a
  reusable Skill definition rather than a one-off command file.
- Deciding the Skill's public interface: does it take a raw context
  statement plus flags (as today), or a more structured shape once it's
  called by an automated slide-deck pipeline rather than a human typing a
  slash command?

## Building the actual slide-deck pipeline (out of scope here)

Everything downstream of "Claude can generate one image on request" is
future work and untouched by this repo:

- Slide layout and text generation.
- Deck assembly (turning N generated images + text into an actual deck).
- Batching/queueing multiple image requests for a full deck in one pass.
- Production hardening of the Worker itself: rate limiting, retries,
  observability, cost caps (flagged as a risk in
  [PRD.md §10](../../PRD.md#10-risks) — repeated test calls with no cap could
  incur unexpected Workers AI usage costs).

## For the workshop format specifically

If this becomes a live or recorded workshop, the natural session breaks are:

1. **Session 1** — this repo as-is: PRD → Worker → slash command → first
   generated image, including the framing dead-ends (great for audience
   participation: "what would you try next?").
2. **Session 2** — resolve the immediate follow-ups above, then formalize
   the Skill.
3. **Session 3** — wire the Skill into an actual slide-deck generation flow.
