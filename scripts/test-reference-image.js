#!/usr/bin/env node
// Tests whether a Workers AI model genuinely conditions generation on a
// reference image, by calling the deployed Worker's diagnostic `imageField`
// escape hatch (see src/worker.js) twice with the SAME prompt and seed:
// once WITH the reference image, once WITHOUT (the control). Saves both
// images locally so the result can be inspected by eye, since a 200
// response or even a different checksum is not, by itself, proof that the
// image was used (see docs/stage-2/06-reference-image-investigation.md).
//
// Usage:
//   node scripts/test-reference-image.js \
//     --model=@cf/bytedance/stable-diffusion-xl-lightning \
//     --field=image_b64 \
//     --reference=characters/bob-002.jpg \
//     --prompt="the same character, raising one hand" \
//     [--seed=7] [--out=test-output] [--width=1024] [--height=1024]
//
// `--field` must be "image" or "image_b64" — matching the field name the
// target model's own documented schema uses. `--seed` defaults to a fixed
// value so repeated runs are comparable; pass a different one to vary it.
// `--no-control` skips the no-image control call (e.g. if you already have
// one to compare against).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    const [, key, value] = match;
    args[key] = value === undefined ? true : value;
  }
  return args;
}

function loadEnv(envPath) {
  const env = {};
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function findWorkerCreds(env) {
  // This project's .env has used more than one naming convention over
  // time (see PRD.md §8) — search rather than assume.
  const urlKey = Object.keys(env).find((k) => /CLOUDFLARE_WORKER_URL$/.test(k));
  const tokenKey = Object.keys(env).find((k) => /CLOUDFLARE_API_TOKEN$/.test(k));
  if (!urlKey || !tokenKey) {
    throw new Error(
      "Could not find a *_CLOUDFLARE_WORKER_URL and *_CLOUDFLARE_API_TOKEN in .env"
    );
  }
  return { url: env[urlKey], token: env[tokenKey] };
}

async function callWorker(workerUrl, token, body) {
  const res = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: res.headers.get("content-type"), buf };
}

function extForContentType(contentType) {
  if (contentType && contentType.includes("png")) return "png";
  if (contentType && contentType.includes("jpeg")) return "jpg";
  return "bin";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["model", "field", "reference", "prompt"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.map((m) => `--${m}`).join(", ")}`);
    console.error("See the header comment in this file for usage.");
    process.exit(1);
  }
  if (!["image", "image_b64"].includes(args.field)) {
    console.error(`--field must be "image" or "image_b64", got: ${args.field}`);
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const env = loadEnv(path.join(projectRoot, ".env"));
  const { url: workerUrl, token } = findWorkerCreds(env);

  const referencePath = path.resolve(args.reference);
  const imageB64 = fs.readFileSync(referencePath).toString("base64");

  const seed = args.seed !== undefined ? Number(args.seed) : 7;
  const outDir = path.resolve(args.out || "test-output");
  fs.mkdirSync(outDir, { recursive: true });

  const modelSlug = args.model.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPrefix = `${modelSlug}_${args.field}_seed${seed}_${stamp}`;

  const baseBody = { prompt: args.prompt, model: args.model, seed };
  if (args.width) baseBody.width = Number(args.width);
  if (args.height) baseBody.height = Number(args.height);

  const withImageBody = { ...baseBody, images: [imageB64], imageField: args.field };

  console.log(`Reference: ${referencePath}`);
  console.log(`Model: ${args.model}   Field: ${args.field}   Seed: ${seed}`);
  console.log("");

  console.log("-> Calling WITH reference image...");
  const withResult = await callWorker(workerUrl, token, withImageBody);
  const withSha = crypto.createHash("sha1").update(withResult.buf).digest("hex");
  const withExt = extForContentType(withResult.contentType);
  const withPath = path.join(outDir, `${runPrefix}_WITH-reference.${withExt}`);
  fs.writeFileSync(withPath, withResult.buf);
  console.log(
    `   status=${withResult.status} bytes=${withResult.buf.length} sha1=${withSha.slice(0, 12)} -> ${withPath}`
  );
  if (withResult.status !== 200) {
    console.log(`   body: ${withResult.buf.toString("utf8").slice(0, 500)}`);
  }

  let withoutSha = null;
  if (!args["no-control"]) {
    console.log("-> Calling WITHOUT reference image (control, same prompt+seed)...");
    const withoutResult = await callWorker(workerUrl, token, baseBody);
    withoutSha = crypto.createHash("sha1").update(withoutResult.buf).digest("hex");
    const withoutExt = extForContentType(withoutResult.contentType);
    const withoutPath = path.join(outDir, `${runPrefix}_WITHOUT-reference-control.${withoutExt}`);
    fs.writeFileSync(withoutPath, withoutResult.buf);
    console.log(
      `   status=${withoutResult.status} bytes=${withoutResult.buf.length} sha1=${withoutSha.slice(0, 12)} -> ${withoutPath}`
    );
    if (withoutResult.status !== 200) {
      console.log(`   body: ${withoutResult.buf.toString("utf8").slice(0, 500)}`);
    }
  }

  console.log("");
  if (withoutSha) {
    console.log(
      withSha === withoutSha
        ? "RESULT: identical checksums — the reference image had NO detectable effect (or both calls failed identically)."
        : "RESULT: checksums differ — this is NOT proof of real conditioning by itself (models can be non-deterministic). Open both saved images and compare them against the reference by eye."
    );
  }
  console.log(`Reference image for comparison: ${referencePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
