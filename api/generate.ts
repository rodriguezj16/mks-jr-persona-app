// api/generate.ts
// Vercel Node runtime, non-streaming request to Fuel iX (OpenAI-compatible)

export const runtime = "nodejs";
export const maxDuration = 10; // keep under Hobby limit

// ---- Env ----
const FUELIX_API_BASE =
  (process.env.FUELIX_API_BASE || "").replace(/\/+$/, "") || "https://api.fuelix.ai";
const FUELIX_API_KEY = process.env.FUELIX_API_KEY || "";
const FUELIX_MODEL = process.env.FUELIX_MODEL || "gpt-4"; // change if your account requires a different id

// Small helper to reply JSON consistently
function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // Guard non-POST quickly (fast-fail)
  if (req.method !== "POST") {
    return json({ error: "Use POST" }, 405);
  }

  // Validate env
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    console.error("[generate] missing env", {
      FUELIX_API_BASE: Boolean(FUELIX_API_BASE),
      FUELIX_API_KEY: Boolean(FUELIX_API_KEY),
    });
    return json({ error: "Server misconfigured: missing Fuel iX env vars" }, 500);
  }

  // Abort upstream a little before Vercel’s 10s limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9_000);

  try {
    // Expecting: { personas: [...], base: {...}, temperature?: number }
    const { personas, base, temperature } = await req.json();

    // Build prompt
    const system = `You are a marketing copy assistant. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic",        "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky",      "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional",  "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit "subjects". Keep each string concise.`;

    const user = `Personas: ${JSON.stringify(personas)}
Base: ${JSON.stringify(base)}`;

    // Call Fuel iX (OpenAI-compatible) without streaming
    const r = await fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${FUELIX_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FUELIX_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: typeof temperature === "number" ? temperature : 0.6,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[generate] Fuel iX error", r.status, detail.slice(0, 800));
      return json({ error: "upstream_error", status: r.status, detail }, 502);
    }

    const ct = r.headers.get("content-type") || "";

    // Some providers still send text; try to parse if so
    if (!ct.toLowerCase().startsWith("application/json")) {
      const text = await r.text();
      try {
        return json(JSON.parse(text), 200);
      } catch {
        return json({ raw: text }, 200);
      }
    }

    // OpenAI-compatible JSON: extract message content
    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data?.choices?.[0]?.message?.content ?? "";

    // The model might return JSON-as-text. Try to parse.
    try {
      return json(JSON.parse(content), 200);
    } catch {
      return json({ raw: content }, 200);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.warn("[generate] upstream timed out (9s)");
      return json({ error: "upstream_timeout" }, 504);
    }
    console.error("[generate] unexpected error", err);
    return json({ error: "server_error" }, 500);
  }
}
