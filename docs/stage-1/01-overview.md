# Overview: What Stage Is This?

## The bigger arc

This repo is one proving-ground stage inside a larger idea: an
`ai-slide-deck-generator` that produces slide-specific imagery (a consistent
narrator character, diagrams, thematic backgrounds) without a human manually
sourcing or generating each one. That larger generator is **not** built here.

The arc, as currently understood, looks like:

```
Stage 1 (this repo)        Stage 2 (future)              Stage 3 (future)
------------------          ------------------             ------------------
Prove the simplest    -->   Wrap the request/response  --> Slide-deck pipeline
path works end to end       contract as a formal            calls the Skill for
Claude -> Worker ->          Claude Skill/Agent              every slide that
Workers AI -> image                                          needs art
```

## Why start here

Before investing in a formal Skill, agent definitions, or a slide-deck
pipeline, this stage answers one narrow question: **can Claude turn a
plain-language description into a real generated image, over HTTP, using
only a deployed Cloudflare Worker and Workers AI — with credentials never
touching source control or chat context?**

Everything in this repo exists in service of that one question. Deliberately
excluded (see [PRD.md §4](../../PRD.md#4-non-goals)):

- The slide-deck pipeline itself (layout, text generation, deck assembly).
- Multi-turn image editing, batching, or a job queue.
- Production hardening (rate limiting, retries, observability).
- Any UI — this is invoked programmatically, by Claude or `curl`.
- A client SDK — Claude calls the deployed Worker directly.

## What "done" looks like for this stage

From [PRD.md §11](../../PRD.md#11-success-criteria-for-this-test-phase):

- Claude can take a plain-language context statement, POST it to the deployed
  Worker, and get back real image bytes — verified end to end.
- Failure modes (bad/missing auth, missing prompt) return the right status
  codes with a body describing the failure.
- The request/response contract is stable enough to lift into a formal Skill.

As of this snapshot, the first two are checked off. The third — "stable
enough to lift into a Skill" — is the open question the next stage answers.
