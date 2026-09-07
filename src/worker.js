const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(
        "Method Not Allowed. POST a JSON body: { prompt, model?, width?, height? }",
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
    if (Number.isFinite(body.width)) params.width = body.width;
    if (Number.isFinite(body.height)) params.height = body.height;

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
