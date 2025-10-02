// api/generate.ts — Fuel iX via OpenAI-compatible /v1/chat/completions
export const runtime = "nodejs";

const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4o-mini"; // replace with your Fuel iX model if different

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) return json({ error: "Server misconfigured" }, 500);

  const { personas, base } = await req.json();

  const system = `You are a veteran marketing manager in charge of personalized messaging copy. Output ONLY JSON with this shape:
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

  try {
    const r = await fetch(`${FUELIX_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${FUELIX_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: FUELIX_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.7,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Fuel iX error", r.status, detail);
      return json({ error: "Fuel iX call failed", detail }, 500);
    }

    // OpenAI-compatible response: { choices: [{ message: { content } }] }
    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content ?? "";

    try {
      const parsed = JSON.parse(text);
      return json(parsed, 200);
    } catch {
      // If provider returns plain text, still return it
      return json({ raw: text }, 200);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Fuel iX call error" }, 500);
  }
}
