// api/generate.ts — Fuel iX via OpenAI-compatible /v1/chat/completions (non-streaming)
export const runtime = "nodejs";

const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4"; // set your Fuel iX model id if different

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) return json({ error: "Server misconfigured" }, 500);

  // Optional: small request timeout
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25_000);

  try {
    const { personas, base } = await req.json();

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
        stream: false, // <-- force non-streaming so r.json() resolves
      }),
      signal: controller.signal,
    });

    clearTimeout(t);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Fuel iX error", r.status, detail);
      return json({ error: "Fuel iX call failed", detail }, 500);
    }

    const ct = r.headers.get("content-type") || "";
    // If the provider still streams, treat it as text
    if (!ct.startsWith("application/json")) {
      const text = await r.text();
      try {
        const parsed = JSON.parse(text);
        return json(parsed, 200);
      } catch {
        return json({ raw: text }, 200);
      }
    }

    // OpenAI-compatible JSON
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content ?? "";

    try {
      const parsed = JSON.parse(text);
      return json(parsed, 200);
    } catch {
      return json({ raw: text }, 200);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error("Fuel iX call timed out");
      return json({ error: "Fuel iX call timed out" }, 504);
    }
    console.error(err);
    return json({ error: "Fuel iX call error" }, 500);
  }
}
