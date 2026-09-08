# Stage 2: Skill, Three Agents, Reference Images

Stage 1 ([../stage-1/](../stage-1/)) proved that Claude could POST a plain
prompt to a Cloudflare Worker and get a real generated image back. Stage 2
turns that one-off proof into something reusable: the calling logic becomes
a Skill, three purpose-specific Agents call it, and the Worker itself grows
two capabilities Stage 1 explicitly left as open questions — reference-image
conditioning and confirmed size handling. **Outcome, confirmed live:** size
handling now genuinely works (after finding and fixing an undocumented
multiple-of-8 requirement); reference-image conditioning is correctly
implemented but currently non-functional, blocked by an external Cloudflare
platform/account limitation rather than anything in this project's code.

Read in order:

1. [01-overview.md](01-overview.md) — what this stage adds and why, and how
   it answers Stage 1's open questions.
2. [02-architecture.md](02-architecture.md) — the Skill, the three Agents,
   and the Worker's new `images`/clamping behavior.
3. [03-build-log.md](03-build-log.md) — how it was actually built, including
   the Workers AI model-schema research, the live tests that caught a real
   Stage 1 gap, an undocumented model constraint, and a wrong assumption
   from Cloudflare's own docs.
4. [04-lessons-learned.md](04-lessons-learned.md) — the non-obvious findings
   worth pausing on in a workshop: an env-var collision that looked exactly
   like a broken credential, "confirmed in code" vs. "confirmed live" (twice,
   for two different things), and a vendor's docs turning out to be wrong.
5. [05-next-steps.md](05-next-steps.md) — what's still blocked (and why
   that's now Cloudflare's move, not this project's), and what Stage 3 would
   pick up.
6. [06-reference-image-investigation.md](06-reference-image-investigation.md) —
   the full reference-image investigation with actual test images embedded:
   which models silently ignore a reference image despite returning `200`,
   what to watch for if that changes, and which of the current Workers AI
   Text-to-Image models are worth using now.

For the authoritative requirements, see
[PRD.md §12–§13](../../PRD.md#12-stage-2-skill--three-agents--reference-images).
See [../README.md](../README.md) for the index of all workshop stages.
