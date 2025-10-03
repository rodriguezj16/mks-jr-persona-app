// api/generate.ts — Fuel iX via OpenAI-compatible /v1/chat/completions (non-streaming)
export const runtime = "nodejs";
export const maxDuration = 10; // keep under Hobby limits

// ---- env ----
const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4o";

// ---- minimal shared types (server-side only) ----
type Channel = "email" | "sms" | "inapp";
interface Persona { name: string; description: string }
interface BaseCreative { brief: string; channel: Channel; subject?: string; message: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) return json({ error: "Server misconfigured" }, 500);

  // Server-side timeout (must be < maxDuration)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9_000);

  try {
    // ---- parse & validate body ----
    const body = (await req.json().catch(() => null)) as
      | { personas?: Persona[]; base?: BaseCreative }
      | null;

    if (!body || !Array.isArray(body.personas) || !body.base) {
      return json({ error: "Bad request: expected { personas: Persona[], base: BaseCreative }" }, 400);
    }

    const { personas, base } = body;

    const system = `You are a veteran marketing manager genius. You create personalized messaging copy that is nuanced to individual customer personas. nOutput ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit "subjects". Keep each string concise.
Ensure copy reflects the persona’s description.`.trim();

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
        stream: false, // non-streaming so we can r.json()
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Fuel iX error", r.status, detail.slice(0, 500));
      return json({ error: "Fuel iX call failed", status: r.status }, 502);
    }

    const ct = r.headers.get("content-type") || "";
    // Some providers send text; try to parse; otherwise return {raw}
    if (!ct.startsWith("application/json")) {
      const text = await r.text();
      try {
        return json(JSON.parse(text), 200);
      } catch {
        return json({ raw: text }, 200);
      }
    }

    // OpenAI-compatible JSON
    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data?.choices?.[0]?.message?.content ?? "";
    try {
      // Prefer structured JSON from the model
      const parsed = JSON.parse(content);
      return json(parsed, 200);
    } catch {
      // Fallback: just pass through the raw text to the client
      return json({ raw: content }, 200);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      console.warn("Fuel iX call timed out");
      return json({ raw: "Timed out calling model — using local variants." }, 200);
    }
    console.error(err);
    return json({ error: "Fuel iX call error" }, 500);
  }
}
