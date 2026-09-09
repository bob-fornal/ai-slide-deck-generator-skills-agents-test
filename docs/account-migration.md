# Migrating to a Separate Cloudflare Account

This is an operational runbook, not a stage write-up — unlike `stage-1/` and
`stage-2/`, which document what was built and when, this documents how to
move what already exists to a different Cloudflare account while keeping
the Worker's identity (`ai-image-generator`) intact.

**Scope check first**: "moved to a separate account" almost certainly means
a different *Cloudflare* account — the Worker, its `AI` binding, and its
`CLOUDFLARE_API_TOKEN` secret all live inside a specific Cloudflare account
(currently the one logged in as `bob@code-squid.com`, subdomain
`bob-fornal`, per `wrangler whoami`). If "account" instead (or also) means
the GitHub/git hosting account for this repo, that's a separate, much
simpler action (transfer or re-push the repo) and isn't covered here — ask
if that's actually what's needed.

None of the steps below were run as part of writing this doc — they require
destination-account credentials this session doesn't have. This is a plan
to follow, not a report of migration already done.

## What has to move

| Thing | Currently | Lives in |
|---|---|---|
| The Worker itself | `ai-image-generator` (name from `wrangler.toml` / `package.json`) | Cloudflare account (`bob@code-squid.com`) |
| Its public URL | `https://ai-image-generator.bob-fornal.workers.dev` | Same account — subdomain is per-account, so this URL **will change** in the new account unless it happens to already use the same `workers.dev` subdomain |
| The `AI` binding | `env.AI` in `src/worker.js`, declared in `wrangler.toml` | Provisioned automatically per-account by Cloudflare when Workers AI is enabled |
| The Worker's bearer secret | `CLOUDFLARE_API_TOKEN`, set via `wrangler secret put` | Stored on the Worker in Cloudflare — **not** in this repo, and not something `wrangler deploy` carries over on its own |
| Local `.env` | `PROD_CLOUDFLARE_WORKER_URL` / `PROD_CLOUDFLARE_API_TOKEN` (see [PRD.md §8](../PRD.md#8-configuration-surface-env) for why they're named that way) | Your machine, gitignored |
| **Workers AI model access itself** | This account currently has access to 9 of the 11 cataloged Text-to-Image models but is denied `stable-diffusion-v1-5-img2img` (`5018` error — see [stage-2/06-reference-image-investigation.md](stage-2/06-reference-image-investigation.md)) | Per-account, not something that transfers — **the new account may have different access entirely, better or worse** |

That last row is the one easiest to overlook: model access has already been
proven, in this exact project, to be account-specific and to not match
Cloudflare's own documentation. Re-verify it after migrating rather than
assuming it (see Step 7).

## Step 1 — Confirm access to the destination account

You (not this session) need either:
- Login credentials for the destination Cloudflare account, or
- To be added as a member of that account if it's a team/org account, with
  permissions covering Workers Scripts (write), Workers AI (write), and
  secrets.

Run `wrangler whoami` once logged in as the destination account and confirm
the **Account Name / Account ID** table shows the right one — if your login
has access to multiple accounts (unlike this session's login, which
currently shows only one: `bob@code-squid.com: primary`), `wrangler` will
otherwise have to guess or prompt.

## Step 2 — Point wrangler at the destination account

```bash
wrangler logout   # only if currently logged in as the OLD account
wrangler login    # log in as the destination account
wrangler whoami   # confirm the Account Name / Account ID is the destination
```

If the destination login has access to **more than one** Cloudflare account,
don't rely on wrangler picking the right one implicitly. Pin it explicitly
in `wrangler.toml`:

```toml
account_id = "<destination-account-id>"
```

(There's no `account_id` line in `wrangler.toml` today — this project has
only ever been deployed to one account, so it's never needed one. Add it
for the migration and keep it afterward; it costs nothing and removes a
whole class of "deployed to the wrong account" mistakes.)

## Step 3 — Confirm Workers AI is enabled on the destination account

Workers AI needs to be enabled at least once per account (accepting terms
in the dashboard, if it's a fresh account that's never used it). Check via:

```bash
wrangler ai models list
```

If this errors or returns nothing, enable Workers AI for the destination
account in the Cloudflare dashboard first, then retry.

## Step 4 — Deploy the Worker

```bash
npm install          # if node_modules isn't already present
wrangler deploy --dry-run   # sanity-check the bundle before touching the destination account
wrangler deploy
```

`wrangler.toml`'s `name = "ai-image-generator"` means the Worker keeps this
same name in the new account — this is what makes it "moved to the
ai-image-generator [Worker], not renamed to something else." The **URL**
will still change, because the `<subdomain>` half of
`ai-image-generator.<subdomain>.workers.dev` is the destination account's
own `workers.dev` subdomain, not something this project controls. Note the
new URL from the `wrangler deploy` output — you'll need it in Step 6.

If the destination account has never set a `workers.dev` subdomain before,
`wrangler deploy` will prompt you to choose one.

## Step 5 — Recreate the Worker's bearer secret

The `CLOUDFLARE_API_TOKEN` secret lives on the Worker in Cloudflare and is
**not** copied by `wrangler deploy` — it must be set explicitly on the new
deployment:

```bash
wrangler secret put CLOUDFLARE_API_TOKEN
```

You can reuse the exact same token value as the old deployment (simplest —
nothing else needs to change) or generate a new one (then update local
`.env` to match — see Step 6 either way). Either is fine; this token is
purely this project's own bearer credential, unrelated to any Cloudflare
account token.

## Step 6 — Update local `.env`

```bash
PROD_CLOUDFLARE_WORKER_URL=https://ai-image-generator.<new-subdomain>.workers.dev
PROD_CLOUDFLARE_API_TOKEN=<value set in Step 5>
```

(Variable names per this project's actual `.env` convention — see
[PRD.md §8](../PRD.md#8-configuration-surface-env) if these ever get
renamed again. `.env.example` documents the shape; `.env` itself is
gitignored and never committed, so this step is manual on every machine
that talks to the Worker.)

## Step 7 — Re-verify everything, don't assume it carried over

This project's own history is full of "the docs/prior result said X, live
testing said otherwise" (see [stage-2/04-lessons-learned.md](stage-2/04-lessons-learned.md)).
A Cloudflare account is exactly the kind of thing that can silently change
model access, so re-run the verification this project already has tooling
for, rather than trusting the old account's results:

1. **Basic auth/validation** (matches [PRD.md §11](../PRD.md#11-success-criteria)):
   a valid prompt + correct bearer token → `200`; missing/incorrect auth →
   `401`; missing prompt → `400`.
2. **Size handling**: a sized request against
   `@cf/stabilityai/stable-diffusion-xl-base-1.0` (e.g. `1024x768`) comes
   back at exactly that size, and an oversized one (e.g. A4's `2480x3506`)
   comes back clamped to `1448x2048`, not erroring.
3. **Model access survey**: re-run the same probes as
   [stage-2/06-reference-image-investigation.md](stage-2/06-reference-image-investigation.md)
   across the [Workers AI Text-to-Image catalog](https://developers.cloudflare.com/workers-ai/models/?tasks=Text-to-Image)
   — this account's access may differ from the old one's (`5018` on
   `stable-diffusion-v1-5-img2img` might not even apply here; that would
   actually be good news worth acting on).
4. **Reference-image behavior**: `node scripts/test-reference-image.js
   --model=<id> --field=image --reference=characters/bob-002.jpg
   --prompt="the same character, raising one hand"` (see
   [scripts/README.md](../scripts/README.md)) — re-run for at least
   `stable-diffusion-xl-base-1.0` and `stable-diffusion-v1-5-img2img` to
   check whether the new account's behavior matches what's documented, or
   whether the docs need updating for the new account.

## Step 8 — Update project docs to point at the new deployment

Once the new deployment is verified:

- [README.md](../README.md) and [PRD.md](../PRD.md) both hard-code the old
  Worker's URL (`ai-image-generator.bob-fornal.workers.dev`) and the old
  account's login (`bob@code-squid.com`) in a few places — update those to
  the new subdomain/account.
- If Step 7's re-verification found the new account's model access differs
  from what [stage-2/06-reference-image-investigation.md](stage-2/06-reference-image-investigation.md)
  documents, update that doc rather than leaving it describing an account
  this project no longer runs on.

## Step 9 — Decommission the old Worker (optional, do this last, needs your explicit go-ahead)

Only after the new deployment is verified and everyone/everything that
calls it has switched to the new URL:

```bash
wrangler delete   # run while authenticated as the OLD account
```

This is a destructive, hard-to-reverse action — don't run it as part of
migrating; run it, deliberately, once you're confident the old deployment
is no longer needed. Keeping both Workers running in parallel for a while
first (old one idle, new one live) costs nothing but a moment of extra
caution.

## If something goes wrong

The old Worker, its secret, and its URL are untouched by any of Steps 1–8 —
nothing here modifies or deletes the original deployment. If the new
account's verification (Step 7) turns up a problem (missing Workers AI
access, a model behaving differently, anything else), the old deployment is
still there and still working; there's no rollback to perform because
nothing on the old side was ever changed.
