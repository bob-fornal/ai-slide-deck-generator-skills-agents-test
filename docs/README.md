# Workshop Documentation — Stage Index

This project is being documented one **stage** at a time, on the assumption
it will be built out into a presentation/workshop: each stage folder
captures where the project was at, and how it got there, at that point in
the build — not just the current end state.

## Stages

- [stage-1/](stage-1/) — Prove the end-to-end path: Claude → Cloudflare
  Worker → Workers AI → real image bytes, with the `/generate-image` slash
  command and the first reference character asset. See
  [stage-1/README.md](stage-1/README.md) for the full write-up.
- [stage-2/](stage-2/) — Convert that slash command into a reusable
  `generate-image` Skill, add three Agents (`character-generator`,
  `item-generator`, `scene-generator`) that call it, and add reference-image
  (img2img) support plus confirmed size-clamping to the Worker. Deployed and
  verified live: size handling genuinely works; reference-image conditioning
  is correctly implemented but blocked by an external Cloudflare platform/
  account limitation, not by anything in this project — see
  [stage-2/05-next-steps.md](stage-2/05-next-steps.md). Full write-up:
  [stage-2/README.md](stage-2/README.md).

Future stages get their own `stage-N/` folder alongside this one, each with
its own `README.md` as the entry point. Add a line above per new stage as
it's written.

## Operational guides

Not every doc here is a stage write-up — some are runbooks for things that
need doing regardless of which stage the project is in:

- [account-migration.md](account-migration.md) — moving the deployed Worker
  (and everything that depends on it) to a different Cloudflare account.

For the authoritative, stage-agnostic requirements doc, see
[../PRD.md](../PRD.md).
