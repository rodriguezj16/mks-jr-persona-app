// api/generate.ts — Node runtime Vercel Function (non-streaming)
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  // --- parse body (Vercel parses JSON automatically when content-type is application/json) ---
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body ?? {};
  const personas = (body as any)?.personas as Persona[] | undefined;
  const base = (body as any)?.base as BaseCreative | undefined;

  if (!Array.isArray(personas) || !base) {
    return res.status(400).json({ error: "Bad request: expected { personas: Persona[], base: BaseCreative }" });
  }

  // --- server-side timeout (< maxDuration) ---
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9_000);

  try {
    const system = `You are a veteran marketing manager genius. You create personalized messaging copy that is nuanced to individual customer personas. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "humorous/cheeky", "subjects": ["...","...","..."], "bodies": ["...","...","..."] },
    { "tone": "formal/professional", "subjects": ["...","...","..."], "bodies": ["...","...","..."] }
  ]
}
If channel != "email", omit "subjects". Keep each string concise.
Ensure copy reflects EACH persona’s description.`.trim();

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
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Fuel iX error", r.status, detail.slice(0, 500));
      return res.status(502).json({ error: "Fuel iX call failed", status: r.status });
    }

    const ct = r.headers.get("content-type") || "";
    if (!ct.startsWith("application/json")) {
      const text = await r.text();
      try {
        return res.status(200).json(JSON.parse(text));
      } catch {
        return res.status(200).json({ raw: text });
      }
    }

    const data = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content ?? "";

    try {
      return res.status(200).json(JSON.parse(content));
    } catch {
      return res.status(200).json({ raw: content });
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      console.warn("Fuel iX call timed out");
      return res.status(504).json({ raw: "Timed out calling model — using local variants." });
    }
    console.error(err);
    return res.status(500).json({ error: "Fuel iX call error" });
  }
}

// tiny helper
function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}
