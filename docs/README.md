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

Future stages get their own `stage-N/` folder alongside this one (e.g.
`stage-2/` for promoting the current logic into a formal Claude Skill), each
with its own `README.md` as the entry point. Add a line above per new stage
as it's written.

For the authoritative, stage-agnostic requirements doc, see
[../PRD.md](../PRD.md).
