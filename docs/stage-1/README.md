# Stage 1: Prove the End-to-End Path

This folder documents the project's first stage in a larger build, not just
as a finished artifact. The goal is a presentation/workshop that walks an
audience through building a Claude-driven image-generation capability from
nothing — this is where the story started.

Read in order:

1. [01-overview.md](01-overview.md) — what this stage is, and where it sits in
   the bigger arc (test harness → Claude Skill → slide-deck generator).
2. [02-architecture.md](02-architecture.md) — the pieces that exist and how a
   request flows through them.
3. [03-build-log.md](03-build-log.md) — how it was actually built, step by
   step, including the dead ends — good material for a live walkthrough.
4. [04-lessons-learned.md](04-lessons-learned.md) — the non-obvious things
   this stage surfaced (model quirks, response-shape differences, prompt
   iteration). These are the "aha" moments worth pausing on in a workshop.
5. [05-next-steps.md](05-next-steps.md) — what's deliberately left undone,
   and what the next stage of the workshop would build.

For the authoritative requirements doc, see [PRD.md](../../PRD.md). This
folder is the narrative/teaching layer on top of it — the PRD says *what and
why*, these docs say *how it happened and what to show*.

See [../README.md](../README.md) for the index of all workshop stages.
