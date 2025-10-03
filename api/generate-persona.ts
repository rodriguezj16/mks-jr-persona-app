import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { runtime: "nodejs", api: { bodyParser: true } };

function cors(res: VercelResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-max-age", "86400");
}

const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL || "gpt-4o";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: missing Fuel iX env vars" });
  }

  // Normalize body
  let body: any = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }

  const persona = body?.persona;
  const base    = body?.base;
  if (!persona || !base) {
    return res.status(400).json({ error: "Missing { persona, base }" });
  }

  // 35s server-side timeout (well under Hobby’s hard cap)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);

  try {
    // Keep output small: 1 variant per tone, 3 tones total
    const system = `You write marketing copy. Output ONLY JSON:
{
  "variants": [
    { "tone": "fun/energetic",        "subjects": ["..."], "bodies": ["..."] },
    { "tone": "humorous/cheeky",      "subjects": ["..."], "bodies": ["..."] },
    { "tone": "formal/professional",  "subjects": ["..."], "bodies": ["..."] }
  ]
}
Rules:
- If channel != "email", omit "subjects".
- Exactly ONE body per tone (and one subject if email).
- Strongly tailor to the persona; make versions meaningfully different between personas.`;

    const user = `Persona: ${JSON.stringify(persona)}
Base creative: ${JSON.stringify(base)}`;

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
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "Fuel iX call failed", detail: detail.slice(0, 500) });
    }

    const ct = r.headers.get("content-type") || "";
    let text: string;
    if (ct.includes("application/json")) {
      const data: any = await r.json();
      text = data?.choices?.[0]?.message?.content ?? "";
    } else {
      text = await r.text(); // some providers stream as text
    }

    // Try to parse model output to JSON; otherwise return raw for debugging
    try {
      const parsed = JSON.parse(text);
      // minimal shape guard
      if (!Array.isArray(parsed?.variants)) {
        return res.status(502).json({ error: "Bad model shape", raw: text.slice(0, 1000) });
      }
      return res.status(200).json(parsed);
    } catch {
      return res.status(502).json({ error: "Non-JSON model output", raw: text.slice(0, 1000) });
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "Upstream timeout" });
    }
    return res.status(500).json({ error: "Server error" });
  }
}
