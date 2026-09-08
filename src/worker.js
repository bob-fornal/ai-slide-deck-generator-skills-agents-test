const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

// The only Workers AI model that actually implements image input (for
// img2img reference-image conditioning), confirmed live. Cloudflare's docs
// list `image`/`image_b64` on stable-diffusion-xl-base-1.0 too, but that's
// wrong in practice - it errors with "input tensor `image` is not present
// in the model" (see https://github.com/cloudflare/cloudflare-docs/issues/11835).
// As of this writing this account additionally gets a 5018 "not allowed to
// access" error for this model - access-gated, not a code problem.
const IMG2IMG_MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

// stable-diffusion-xl-base-1.0 is the only currently-supported model that
// honors width/height at all; its documented range is 256-2048px per side.
// flux-1-schnell has no width/height (or image) input and ignores both.
const SDXL_MIN_DIMENSION = 256;
const SDXL_MAX_DIMENSION = 2048;

// Confirmed live (not documented): stable-diffusion-xl-base-1.0 requires
// width/height to each be a multiple of 8 (the usual diffusion-model
// latent-space constraint) - a non-multiple (e.g. 1023, or 1449 from a
// naive aspect-ratio scale) fails upstream with an opaque triton/inference
// 502, not a clean 400. 256 and 2048 are themselves multiples of 8, so
// clamping to them after rounding never breaks this invariant.
const SDXL_DIMENSION_STEP = 8;

// Scales width/height down (preserving aspect ratio) to fit within
// SDXL_MAX_DIMENSION, then up to SDXL_MIN_DIMENSION if still too small,
// then rounds both to the nearest valid multiple of 8. A caller asking for
// print-resolution A4 (2480x3506) gets back a same-aspect-ratio image
// (1448x2048) instead of an upstream rejection.
function clampDimensions(width, height) {
  let w = width;
  let h = height;

  const largest = Math.max(w, h);
  if (largest > SDXL_MAX_DIMENSION) {
    const scale = SDXL_MAX_DIMENSION / largest;
    w = w * scale;
    h = h * scale;
  }

  const smallest = Math.min(w, h);
  if (smallest < SDXL_MIN_DIMENSION) {
    const scale = SDXL_MIN_DIMENSION / smallest;
    w = w * scale;
    h = h * scale;
  }

  w = Math.round(w / SDXL_DIMENSION_STEP) * SDXL_DIMENSION_STEP;
  h = Math.round(h / SDXL_DIMENSION_STEP) * SDXL_DIMENSION_STEP;

  // Rounding to a multiple of 8 can nudge a dimension just outside
  // 256-2048; re-clamp (256/2048 are themselves multiples of 8, so this
  // can't undo the rounding above).
  w = Math.min(Math.max(w, SDXL_MIN_DIMENSION), SDXL_MAX_DIMENSION);
  h = Math.min(Math.max(h, SDXL_MIN_DIMENSION), SDXL_MAX_DIMENSION);

  return { width: w, height: h };
}

// Same range/step rules as clampDimensions, for a caller that supplies
// only one of width/height (the generate-image Skill always sends both,
// but the Worker's own contract allows either alone).
function clampSingleDimension(value) {
  const clamped = Math.min(Math.max(value, SDXL_MIN_DIMENSION), SDXL_MAX_DIMENSION);
  return Math.round(clamped / SDXL_DIMENSION_STEP) * SDXL_DIMENSION_STEP;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(
        "Method Not Allowed. POST a JSON body: { prompt, model?, width?, height?, images? }",
        { status: 405 }
      );
    }

    if (!env.CLOUDFLARE_API_TOKEN) {
      return new Response("Worker misconfigured: CLOUDFLARE_API_TOKEN secret is not set.", {
        status: 500,
      });
    }

    const authHeader = request.headers.get("Authorization") || "";
    if (authHeader !== `Bearer ${env.CLOUDFLARE_API_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const prompt = body.prompt;
    if (!prompt || typeof prompt !== "string") {
      return new Response("Missing required field: prompt", { status: 400 });
    }

    const model = body.model || DEFAULT_MODEL;

    // width/height are only honored by models that accept them (e.g.
    // stable-diffusion-xl-base-1.0); flux-1-schnell ignores extra fields.
    const params = { prompt };
    if (Number.isFinite(body.width) && Number.isFinite(body.height)) {
      const { width, height } = clampDimensions(body.width, body.height);
      params.width = width;
      params.height = height;
    } else if (Number.isFinite(body.width)) {
      params.width = clampSingleDimension(body.width);
    } else if (Number.isFinite(body.height)) {
      params.height = clampSingleDimension(body.height);
    }

    // images: optional array of base64-encoded reference images, for
    // img2img conditioning. Only forwarded when the resolved model is
    // IMG2IMG_MODEL — the only model that actually implements image input
    // (see the comment on IMG2IMG_MODEL above). For every other model
    // (including stable-diffusion-xl-base-1.0, despite what its docs
    // claim), `images` is silently ignored, same as an unsupported
    // width/height. Only the first images[] entry is ever used.
    if (Array.isArray(body.images) && typeof body.images[0] === "string" && model === IMG2IMG_MODEL) {
      const binary = Uint8Array.from(atob(body.images[0]), (c) => c.charCodeAt(0));
      params.image = Array.from(binary);
    }

    let result;
    try {
      result = await env.AI.run(model, params);
    } catch (err) {
      return new Response(`AI generation failed: ${err.message}`, { status: 502 });
    }

    // Workers AI models differ in response shape:
    // - flux-1-schnell returns { image: "<base64 string>" } (JPEG)
    // - stable-diffusion-xl-base-1.0 returns a raw binary stream (PNG)
    if (result && typeof result === "object" && typeof result.image === "string") {
      const binary = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
      return new Response(binary, { headers: { "Content-Type": "image/jpeg" } });
    }

    return new Response(result, { headers: { "Content-Type": "image/png" } });
  },
};
