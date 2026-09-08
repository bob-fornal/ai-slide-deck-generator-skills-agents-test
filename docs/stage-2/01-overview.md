# Overview: What Stage 2 Adds

## Picking up where Stage 1 left off

[Stage 1's overview](../stage-1/01-overview.md) named one thing "done"
required: *"the request/response contract is stable enough to be lifted into
a formal Claude Skill."* Stage 2 is that lift, plus two capabilities Stage 1
deliberately deferred:

| Stage 1 said | Stage 2 does |
|---|---|
| One slash command calls the Worker directly. | The calling logic moves into a `generate-image` Skill; the slash command becomes a one-line delegator; three Agents call the Skill too. |
| "The image request should eventually support an optional reference image... Not yet implemented." (PRD §7.4, Stage 1) | `src/worker.js` now accepts an `images` array and correctly forwards the first entry — but only to the one model confirmed to actually implement image input, which this account can't yet reach. Implemented per the API contract; not yet functional (see [03-build-log.md](03-build-log.md)). |
| Width/height forwarding existed in source but "needs a fresh deploy before it's live." (PRD §5, Stage 1) | Re-tested directly against the live Worker: confirmed **still not live** at first (see [03-build-log.md](03-build-log.md)) — then deployed and **confirmed genuinely working**, after also discovering and fixing an undocumented multiple-of-8 size requirement. |

## The three Agents, and why three

A single Agent with optional flags could have covered all of this. Three
were built instead because the *actual requirement* was that different
callers should have different rules about where size/type come from:

- **`character-generator`** — size and type are fixed, matching what this
  project already used to produce `characters/bob-002.jpg`. A caller
  shouldn't be able to accidentally generate an off-brand character by
  passing a different size.
- **`item-generator`** — the opposite: nothing is fixed. Size and type must
  always come from the caller, because an item's ideal format varies too
  much to default sensibly.
- **`scene-generator`** — a middle ground: size is constrained to exactly
  three named options (widescreen/standard/A4), but type is still required
  from the caller, not defaulted.

That's a genuine design axis (fixed vs. required vs. constrained-list), not
just three copies of the same Agent — worth calling out explicitly in a
workshop, since "just add a flag" is the tempting shortcut that would have
missed the point.

## What's still open at the end of this stage

Size is confirmed live and working. Reference-image conditioning is not —
not because of anything left to fix in this project's own code, but because
of two external facts confirmed live: the model Cloudflare documents as
supporting it (stable-diffusion-xl) doesn't actually implement it, and the
model that does (`stable-diffusion-v1-5-img2img`) isn't accessible on this
Cloudflare account. See [05-next-steps.md](05-next-steps.md) for what would
actually unblock it.
