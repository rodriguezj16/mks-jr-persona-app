// api/generate-persona.ts — single-persona fan-out endpoint
export const runtime = "nodejs";          // Vercel Serverless
export const maxDuration = 20;             // 

const FUELIX_API_BASE = process.env.FUELIX_API_BASE!;
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY!;
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4o";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Channel = "email" | "sms" | "inapp";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
    return json({ error: "Server misconfigured" }, 500);
  }

  // Abort a bit before Vercel does
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8_500);

  try {
    const { idx, persona, base } = await req.json() as {
      idx: number;
      persona: { name: string; description: string };
      base: { brief: string; channel: Channel; subject?: string; message: string };
    };

    // <<< SHORT prompt: 3 tones, 1 variant per tone >>>
    const system = `You are a marketing copy assistant. Output ONLY JSON with this shape:
{
  "variants": [
    { "tone": "fun/energetic",        "subjects": ["..."], "bodies": ["..."] },
    { "tone": "humorous/cheeky",      "subjects": ["..."], "bodies": ["..."] },
    { "tone": "formal/professional",  "subjects": ["..."], "bodies": ["..."] }
  ]
}
If channel != "email", omit "subjects". Keep strings concise (<= 200 chars).`;

    // Keep persona-specific guidance tight so it’s fast but differentiated
    const user = [
      `Persona name: ${persona?.name ?? ""}`,
      `Persona traits: ${persona?.description ?? ""}`,
      `Channel: ${base?.channel}`,
      base?.subject ? `Subject seed: ${base.subject}` : undefined,
      `Message seed: ${base?.message ?? ""}`,
      base?.brief ? `Brief: ${base.brief}` : undefined,
      `Return exactly 3 tones (above) with ONE short variant each.`
    ].filter(Boolean).join("\n");

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
        temperature: 0.6,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(t);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[generate-persona] upstream", r.status, detail?.slice?.(0, 500));
      return json({ idx, error: "upstream_failed", status: r.status }, 502);
    }

    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(text);
      // Ensure we always return the persona index alongside its variants
      return json({ idx, variants: parsed?.variants ?? [] }, 200);
    } catch {
      return json({ idx, raw: text }, 200);
    }
  } catch (err: any) {
    clearTimeout(t);
    if (err?.name === "AbortError") {
      console.warn("[generate-persona] timed out");
      return json({ idx: undefined, error: "timeout" }, 504);
    }
    console.error("[generate-persona] error", err);
    return json({ idx: undefined, error: "server_error" }, 500);
  }
}
