// api/generate.ts
export const runtime = "nodejs";
export const maxDuration = 10; // keep under Hobby limit

const FUELIX_API_BASE = process.env.FUELIX_API_BASE; // e.g. https://api.fuelix.ai
const FUELIX_API_KEY  = process.env.FUELIX_API_KEY;   // Bearer token
const FUELIX_MODEL    = process.env.FUELIX_MODEL ?? "gpt-4";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") return send({ error: "Use POST" }, 405);

    if (!FUELIX_API_BASE || !FUELIX_API_KEY) {
      console.error("[generate] Missing envs", {
        hasBase: !!FUELIX_API_BASE,
        hasKey: !!FUELIX_API_KEY,
      });
      return send({ error: "Server misconfigured" }, 500);
    }

    // Parse body safely (bad JSON would otherwise crash the function)
    let body: any = null;
    try {
      body = await req.json();
    } catch (e: any) {
      console.error("[generate] Bad JSON body", e?.message);
      return send({ error: "Bad JSON body" }, 400);
    }

    const { personas = [], base = {} } = body ?? {};
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

    // 20s client-side budget
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

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
        stream: false, // force non-streaming
      }),
      signal: controller.signal,
    }).catch((e) => {
      // Network-level error (DNS, TLS, abort, etc.)
      throw Object.assign(new Error("fetch_failed"), { cause: e });
    });

    clearTimeout(timeout);

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[generate] Fuel iX non-200", r.status, detail?.slice?.(0, 600));
      return send({ error: "FuelIX call failed", status: r.status, detail: detail?.slice?.(0, 200) }, 502);
    }

    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const txt = await r.text();
      // Som
