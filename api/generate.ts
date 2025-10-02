// /api/generate.ts
export const runtime = "nodejs";
// (Optional) avoid very long functions if your model can be slow
// export const maxDuration = 25; // seconds

const FUELIX_API_BASE = process.env.FUELIX_API_BASE || "https://api.fuelix.ai";
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4"; // change to your Fuel iX model

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // Preflight / sanity
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "access-control-allow-methods": "POST,OPTIONS" },
    });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!FUELIX_API_KEY) return json({ error: "Server misconfigured: missing FUELIX_API_KEY" }, 500);

  // Parse body early
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { personas, base } = body ?? {};
  if (!Array.isArray(personas) || !base?.channel) {
    return json({ error: "Bad request: expected { personas: Persona[], base: { channel, ... } }" }, 400);
  }

  // 25s client-side timeout for the upstream call
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 25_000);

  try {
    const system = `You are a marketing copy assistant. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit "subjects". Keep each string concise.`;

    const user = `Personas: ${JSON.stringify(personas)}
Base: ${JSON.stringify(base)}`;

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
        temperature: 0.7,
        stream: false, // non-streaming - so we can r.json()
      }),
      signal: controller.signal,
    });
    clearTimeout(to);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[/api/generate] Fuel iX error", r.status, detail.slice(0, 2_000));
      return json({ error: "Fuel iX call failed", status: r.status, detail }, 502);
    }

    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      // Some proxies return text/plain. Try to parse, otherwise return raw.
      const text = await r.text();
      try {
        return json(JSON.parse(text), 200);
      } catch {
        return json({ raw: text }, 200);
      }
    }

    // OpenAI-compatible shape
    const data: any = await r.json();
    const msg = data?.choices?.[0]?.message;

    // Some providers can return an array of content parts; handle both
    let content = "";
    if (typeof msg?.content === "string") content = msg.content;
    else if (Array.isArray(msg?.content)) {
      content = msg.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim();
    }

    if (!content) {
      // If we got nothing, return the whole upstream payload to inspect
      return json({ upstream: data }, 200);
    }

    try {
      const parsed = JSON.parse(content);
      return json(parsed, 200);
    } catch {
      return json({ raw: content }, 200);
    }
  } catch (err: any) {
    clearTimeout(to);
    if (err?.name === "AbortError") {
      console.error("[/api/generate] Fuel iX call timed out");
      return json({ error: "Fuel iX call timed out" }, 504);
    }
    console.error("[/api/generate] Unexpected error", err);
    return json({ error: "Fuel iX call error", message: String(err) }, 500);
  }
}
